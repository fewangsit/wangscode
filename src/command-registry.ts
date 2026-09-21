import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SessionStore } from "@anthropic-ai/claude-agent-sdk";

import type { ChatStore } from "./tui/chat-store.ts";
import type { SessionStatusStore } from "./tui/session-status.ts";

export interface CommandContext {
  chatStore: ChatStore;
  sessionStatus: SessionStatusStore;
  askLine: (prompt: string) => Promise<string>;
  getSession: () => Query;
  cwd: string;
  sessionStore?: SessionStore;
  /** `resume` is only consumable at `query()` call time (see repl.tsx's restart loop) — this doesn't restart anything itself, just records the request. */
  requestResume: (sessionId: string) => void;
}

export type CommandHandler = (ctx: CommandContext, arg?: string) => Promise<void>;

// "/model", "/usage", and interactive "/resume" are intercepted directly in App.tsx
// (before the line ever reaches InputRouter) to open their interactive overlays.
// They stay listed in HOST_COMMANDS below for "/"-mention autocomplete's benefit.
const COMMANDS: Record<string, CommandHandler> = {
  "/resume": handleResume,
};

export interface CommandDescriptor {
  name: string; // includes the leading "/"
  description: string;
}

/** Commands dispatched entirely on the host side — never reach the model. Doubles as the "/"-mention autocomplete source (see tui/autocomplete.ts) alongside whatever `session.supportedCommands()` reports. */
export const HOST_COMMANDS: CommandDescriptor[] = [
  { name: "/usage", description: "Token and cost totals for this session" },
  { name: "/model", description: "Switch the active model" },
  { name: "/resume", description: "Pick a previous session to resume" },
  { name: "/create-feature", description: "Run the deterministic feature-build pipeline" },
  { name: "/exit", description: "Quit Wangs Code" },
];

/** Merges HOST_COMMANDS with `session.supportedCommands()` (skill/plugin commands included) for autocomplete display — a name already in HOST_COMMANDS wins dispatch, so it's not duplicated here even if the SDK also reports one under the same name. */
export async function listAvailableCommands(session: Query | undefined): Promise<CommandDescriptor[]> {
  if (!session) return HOST_COMMANDS;
  try {
    const supported = await session.supportedCommands();
    const existing = new Set(HOST_COMMANDS.map((c) => c.name));
    const pluginCommands: CommandDescriptor[] = supported
      .map((c) => ({ name: c.name.startsWith("/") ? c.name : `/${c.name}`, description: c.description }))
      .filter((c) => !existing.has(c.name));
    return [...HOST_COMMANDS, ...pluginCommands];
  } catch {
    return HOST_COMMANDS;
  }
}

/** Host-defined slash commands beyond /create-feature (see slash-commands.ts) and /exit,/quit (see repl.tsx). Returns true if `line` matched and was handled. */
export async function handleSlashCommand(line: string, ctx: CommandContext): Promise<boolean> {
  const trimmed = line.trim();
  const [cmd, ...rest] = trimmed.split(/\s+/);
  if (!cmd) return false;
  const handler = COMMANDS[cmd];
  if (!handler) return false;
  await handler(ctx, rest.join(" "));
  return true;
}

export async function handleResume(ctx: CommandContext, arg?: string): Promise<void> {
  if (arg && arg.trim().length > 0) {
    const target = arg.trim();
    ctx.chatStore.pushHost(`Resuming session ${target}...`);
    ctx.requestResume(target);
    return;
  }

  const sessions = await listSessions({
    dir: ctx.cwd,
    ...(ctx.sessionStore ? { sessionStore: ctx.sessionStore } : {}),
  });

  if (sessions.length === 0) {
    ctx.chatStore.pushHost("No previous sessions found for this project.");
    return;
  }

  const listing = sessions.map((s, i) => `${i + 1}. ${s.summary || s.firstPrompt || "(no summary)"} — ${new Date(s.lastModified).toLocaleString()}`);
  ctx.chatStore.pushHost(["## Previous sessions", "", ...listing].join("\n"));

  const answer = await ctx.askLine("Resume which session (number): ");
  const picked = sessions[Number.parseInt(answer.trim(), 10) - 1];
  if (!picked) {
    ctx.chatStore.pushHost(`No session at "${answer}" — staying on the current session.`);
    return;
  }

  ctx.chatStore.pushHost(`Resuming session ${picked.sessionId}...`);
  ctx.requestResume(picked.sessionId);
}
