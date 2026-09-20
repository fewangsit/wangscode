import { Pool } from "pg";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { App } from "./tui/App.tsx";
import { ChatStore } from "./tui/chat-store.ts";
import { InputRouter } from "./tui/input-router.ts";
import { SessionStatusStore } from "./tui/session-status.ts";
import { AsyncInputQueue } from "./input-queue.ts";
import { makeCanUseTool } from "./permission-prompt.ts";
import { createMessageRenderer } from "./render.ts";
import { buildSessionOptions, DEFAULT_MODEL, DEFAULT_PERMISSION_MODE } from "./session-options.ts";
import { FeatureBuildController } from "./slash-commands.ts";
import { PostgresSessionStore } from "./postgres-session-store.ts";
import { handleSlashCommand } from "./command-registry.ts";
import type { CommandContext } from "./command-registry.ts";

export interface ReplParams {
  cwd: string;
}

// Postgres session mirroring is opt-in, not a new hard requirement — omitted entirely (both the
// Pool and the SDK's `sessionStore` option) when the env var is unset, so anyone who just wants to
// chat is unaffected. `ensureSchema()` runs once here, not per-query.
async function createOptionalSessionStore(): Promise<{ store: PostgresSessionStore; pool: Pool } | null> {
  const url = process.env.WANGS_AGENT_POSTGRES_URL;
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
  const inputQueue = new AsyncInputQueue();
  const sessionStoreHandle = await createOptionalSessionStore();

  chatStore.pushWelcome();
  if (sessionStoreHandle) chatStore.pushFooter("[wangs-agent] session mirroring to Postgres enabled");

  // `resume` (an SDK `Options` field) is only consumable at `query()` call time — there's no
  // "resume this live session" method — so /resume can't just call something on `currentSession`.
  // It stashes the target session id here and interrupts the current session; the outer `for(;;)`
  // loop below notices the stash once its `for await` unwinds and re-enters `query()` with
  // `resume` set. `currentSession` itself is read by /usage and /model, which ARE live methods.
  let currentSession: Query | undefined;
  let pendingResumeId: string | undefined;
  let closing = false;

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
  const canUseTool = makeCanUseTool(inputRouter);

  const renderer = await createCliRenderer();
  const root = createRoot(renderer);

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    chatStore.flushAll();
    await currentSession?.interrupt().catch(() => undefined);
    inputQueue.close();
    if (sessionStoreHandle) await sessionStoreHandle.pool.end().catch(() => undefined);
    root.unmount();
    renderer.destroy();
    process.exit(0);
  };

  root.render(
    <App
      chatStore={chatStore}
      sessionStatus={sessionStatus}
      inputRouter={inputRouter}
      onExit={() => void shutdown()}
      cwd={params.cwd}
      getSession={() => currentSession}
    />,
  );

  // The renderer/root/chatStore/inputRouter/inputQueue are created once above and live across
  // restarts — only `query()`/`session` gets recreated on /resume, so the terminal doesn't flicker
  // or reset; `AsyncInputQueue` has no notion of "belonging" to one session, it's just the
  // AsyncIterable `prompt` reads from, so reusing it across `query()` calls is safe.
  for (;;) {
    const resume = pendingResumeId;
    pendingResumeId = undefined;

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
      // A resume-triggered interrupt() legitimately unwinds this loop — only a genuine error
      // (no resume pending) is worth surfacing.
      if (pendingResumeId === undefined) {
        chatStore.pushFooter(`[wangs-agent] session error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (closing) break;
    if (pendingResumeId === undefined) break;
    chatStore.pushHost(`Resumed session ${pendingResumeId}.`);
  }
}
