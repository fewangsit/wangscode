import { readFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { getSessionInfo, getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { App } from "./tui/App.tsx";
import { ChatStore } from "./tui/chat-store.ts";
import { InputRouter } from "./tui/input-router.ts";
import { SessionStatusStore } from "./tui/session-status.ts";
import { AsyncInputQueue } from "./input-queue.ts";
import { makeCanUseTool, PermissionRequestStore } from "./permission-prompt.ts";
import { printExitBanner } from "./ExitBanner.tsx";
import { convertSessionMessagesToBlocks, createMessageRenderer } from "./render.ts";
import { buildSessionOptions, DEFAULT_MODEL, DEFAULT_PERMISSION_MODE } from "./session-options.ts";
import { FeatureBuildController } from "./slash-commands.ts";
import { PostgresSessionStore } from "./postgres-session-store.ts";
import { handleSlashCommand } from "./command-registry.ts";
import type { CommandContext } from "./command-registry.ts";
import { PACKAGE_ROOT } from "./package-root.ts";

export interface ReplParams {
  cwd: string;
  /** From cli.ts's `--resume <session-id>` flag — resumes straight into that session at startup instead of a fresh one. */
  resumeSessionId?: string;
}

// Same file cli.ts's own readPackageJson() reads (see that file's comment on why PACKAGE_ROOT,
// not a static import) — read once here too: `version` for the welcome banner's badge, `name` for
// the exit banner's copy-pasteable `<name> --resume <id>` line (so it stays correct even if the
// package is ever renamed again, rather than hardcoding "wangs-code" a second time).
function getPackageInfo(): { name: string; version: string } {
  try {
    const raw = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    return JSON.parse(raw) as { name: string; version: string };
  } catch {
    return { name: "wangs-code", version: "0.0.0" };
  }
}

// Postgres session mirroring is opt-in, not a new hard requirement — omitted entirely (both the
// Pool and the SDK's `sessionStore` option) when the env var is unset, so anyone who just wants to
// chat is unaffected. `ensureSchema()` runs once here, not per-query.
async function createOptionalSessionStore(): Promise<{ store: PostgresSessionStore; pool: Pool } | null> {
  const url = process.env.WANGS_CODE_POSTGRES_URL;
  if (!url) return null;

  const pool = new Pool({ connectionString: url });
  const store = new PostgresSessionStore({ pool });
  await store.ensureSchema();
  return { store, pool };
}

export async function runRepl(params: ReplParams): Promise<void> {
  const chatStore = new ChatStore();
  const sessionStatus = new SessionStatusStore();
  sessionStatus.seedKnownConfig({ cwd: params.cwd, model: DEFAULT_MODEL, permissionMode: DEFAULT_PERMISSION_MODE });
  const renderMessage = createMessageRenderer(chatStore, sessionStatus);
  // Not `const` — /resume recreates this (see requestResume below). Confirmed via a real SDK call
  // that `session.interrupt()` alone does NOT end the query()'s generator (the same session keeps
  // running, ready for the next pushed message) — so ending the current `for await` iteration for
  // /resume's sake takes closing the input queue itself, and a closed AsyncInputQueue is
  // permanently inert (`push()` silently no-ops once `closed`), so continuing to chat after a
  // resume needs a fresh queue instance, not the same one reopened.
  let inputQueue = new AsyncInputQueue();
  const sessionStoreHandle = await createOptionalSessionStore();

  chatStore.pushWelcome();
  if (sessionStoreHandle) chatStore.pushFooter("[Wangs Code] session mirroring to Postgres enabled");

  // `resume` (an SDK `Options` field) is only consumable at `query()` call time — there's no
  // "resume this live session" method — so /resume can't just call something on `currentSession`.
  // It stashes the target session id here and interrupts the current session; the outer `for(;;)`
  // loop below notices the stash once its `for await` unwinds and re-enters `query()` with
  // `resume` set. `currentSession` itself is read by /usage and /model, which ARE live methods.
  let currentSession: Query | undefined;
  // Seeded from cli.ts's `--resume <id>` flag, if given — the first pass through the `for(;;)`
  // loop below resumes straight into that session instead of starting fresh.
  let pendingResumeId: string | undefined = params.resumeSessionId;
  let closing = false;
  const packageInfo = getPackageInfo();

  const commandCtx: CommandContext = {
    chatStore,
    sessionStatus,
    askLine: (prompt) => inputRouter.askLine(prompt),
    getSession: () => {
      if (!currentSession) throw new Error("session not ready yet");
      return currentSession;
    },
    cwd: params.cwd,
    sessionStore: sessionStoreHandle?.store,
    requestResume: (sessionId) => {
      pendingResumeId = sessionId;
      // Closing the queue is what actually ends the current `for await` loop (see the `let
      // inputQueue` comment above) — interrupt() alone would leave this iteration running
      // indefinitely, waiting on a queue nothing will ever push to again. interrupt() is still
      // called too, so an in-flight turn aborts immediately instead of finishing out first.
      inputQueue.close();
      void currentSession?.interrupt().catch(() => undefined);
    },
  };

  // The default line handler (nothing else is actively waiting via askLine):
  // host-intercepted /create-feature (and any answer to a pending needs_input
  // question) first — see slash-commands.ts — then /usage, /model, /resume —
  // see command-registry.ts — neither ever reaches the model; a regular chat
  // message is echoed into the scrollback and pushed to the SDK.
  const inputRouter = new InputRouter((line) => {
    void (async () => {
      if (line === "/exit" || line === "/quit") {
        await shutdown();
        return;
      }

      chatStore.pushUser(line);

      const handledByFeatureBuild = await featureBuildController.handleLine(line, (text) => chatStore.pushHost(text));
      if (handledByFeatureBuild) return;

      const handledByCommand = await handleSlashCommand(line, commandCtx);
      if (handledByCommand) return;

      inputQueue.push(line);
    })();
  });

  const featureBuildController = new FeatureBuildController((prompt) => inputRouter.askLine(prompt), params.cwd);
  const permissionRequestStore = new PermissionRequestStore();
  const canUseTool = makeCanUseTool(permissionRequestStore);

  const renderer = await createCliRenderer();
  const root = createRoot(renderer);

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    chatStore.flushAll();
    const sessionId = sessionStatus.store.get().sessionId;
    await currentSession?.interrupt().catch(() => undefined);
    inputQueue.close();
    if (sessionStoreHandle) await sessionStoreHandle.pool.end().catch(() => undefined);
    root.unmount();
    renderer.destroy();
    // Printed after renderer.destroy() (back on the normal terminal, not the TUI's alt-screen) so
    // it's the last thing visible, not something the TUI clears away on its own exit.
    if (sessionId) printExitBanner(sessionId, packageInfo.name);
    process.exit(0);
  };

  // Escape in the TUI — just stops the current turn, confirmed via the same real-SDK finding
  // above: interrupt() alone doesn't end the session, so nothing else needs doing here. The
  // for-await loop keeps running and picks the next pushed message up normally.
  const onInterrupt = (): void => {
    void currentSession?.interrupt().catch(() => undefined);
  };

  root.render(
    <App
      chatStore={chatStore}
      sessionStatus={sessionStatus}
      inputRouter={inputRouter}
      onExit={() => void shutdown()}
      onInterrupt={onInterrupt}
      cwd={params.cwd}
      version={packageInfo.version}
      sessionStoreActive={sessionStoreHandle !== null}
      getSession={() => currentSession}
      permissionRequestStore={permissionRequestStore}
      requestResume={commandCtx.requestResume}
      sessionStore={sessionStoreHandle?.store}
    />,
  );

  // The renderer/root/chatStore/inputRouter are created once above and live across restarts —
  // only `query()`/`session` (and, on /resume, `inputQueue` — see its own comment above) get
  // recreated, so the terminal doesn't flicker or reset.
  for (;;) {
    const resume = pendingResumeId;
    pendingResumeId = undefined;

    if (resume) {
      try {
        const [info, history] = await Promise.all([
          getSessionInfo(resume, {
            dir: params.cwd,
            ...(sessionStoreHandle?.store ? { sessionStore: sessionStoreHandle.store } : {}),
          }).catch(() => undefined),
          getSessionMessages(resume, {
            dir: params.cwd,
            ...(sessionStoreHandle?.store ? { sessionStore: sessionStoreHandle.store } : {}),
          }),
        ]);

        const blocks = convertSessionMessagesToBlocks(history);
        chatStore.replaceBlocks(blocks);
        const title = info?.summary || info?.customTitle || info?.firstPrompt || resume;
        chatStore.pushHost(`Resumed session **${title}**.`);
        sessionStatus.applyInit({
          session_id: resume,
          model: DEFAULT_MODEL,
          permissionMode: DEFAULT_PERMISSION_MODE,
          cwd: params.cwd,
        });
      } catch (err) {
        chatStore.pushHost(`Could not load session history: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const options = buildSessionOptions(params.cwd, canUseTool, featureBuildController, {
      sessionStore: sessionStoreHandle?.store,
      resume,
    });

    const session = query({ prompt: inputQueue, options });
    currentSession = session;

    try {
      for await (const message of session) {
        renderMessage(message);
      }
    } catch (err) {
      // A resume-triggered queue close() legitimately unwinds this loop — only a genuine error
      // (no resume pending) is worth surfacing.
      if (pendingResumeId === undefined) {
        chatStore.pushFooter(`[Wangs Code] session error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (closing) break;
    if (pendingResumeId === undefined) break;
    inputQueue = new AsyncInputQueue(); // the old one is closed and permanently inert — see its own comment above
  }
}
