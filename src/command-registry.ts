import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerStatus, Query, SessionStore } from "@anthropic-ai/claude-agent-sdk";

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
  "/mcp": handleMcp,
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
  { name: "/mcp", description: "List MCP servers and tools · /mcp <name> · /mcp reconnect <name>" },
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

// ── /mcp helpers ──────────────────────────────────────────────────────────────────────────────────

function statusGlyph(status: McpServerStatus["status"]): string {
  switch (status) {
    case "connected":
      return "✓";
    case "failed":
      return "✗";
    case "pending":
      return "◌";
    case "disabled":
      return "—";
    case "needs-auth":
      return "🔒";
  }
}

function formatMcpList(servers: McpServerStatus[]): string {
  if (servers.length === 0) {
    return "## MCP Servers\n\nNo MCP servers configured for this session.";
  }

  const rows = servers.map((s) => {
    const glyph = statusGlyph(s.status);
    const toolCount = s.tools?.length ?? 0;
    const toolNote = s.status === "connected" ? ` · ${toolCount} tool${toolCount !== 1 ? "s" : ""}` : "";
    const errorNote = s.error ? `  \n  _${s.error}_` : "";
    return `**${glyph} ${s.name}** — ${s.status}${toolNote}${errorNote}`;
  });

  const lines = [`## MCP Servers (${servers.length})`, "", ...rows, "", "_/mcp \\<name\\> — show tools · /mcp reconnect \\<name\\> — reconnect_"];
  return lines.join("\n");
}

function formatMcpServer(server: McpServerStatus): string {
  const glyph = statusGlyph(server.status);
  const tools = server.tools ?? [];
  const header = `## ${glyph} ${server.name} — ${server.status}`;

  if (server.error) {
    return [header, "", `**Error:** ${server.error}`, "", "_/mcp reconnect \\<name\\> to retry the connection._"].join("\n");
  }

  if (tools.length === 0) {
    return [header, "", "_No tools reported by this server._"].join("\n");
  }

  const toolLines = tools.map((t) => {
    const annotations: string[] = [];
    if (t.annotations?.readOnly) annotations.push("read-only");
    if (t.annotations?.destructive) annotations.push("destructive");
    if (t.annotations?.openWorld) annotations.push("open-world");
    const annotNote = annotations.length > 0 ? ` _(${annotations.join(", ")})_` : "";
    const desc = t.description ? ` — ${t.description}` : "";
    return `- **${t.name}**${desc}${annotNote}`;
  });

  return [header, `_${tools.length} tool${tools.length !== 1 ? "s" : ""}_`, "", ...toolLines].join("\n");
}

/** `/mcp [subcommand] [arg]`
 *
 *  - `/mcp`              — list all configured MCP servers with status
 *  - `/mcp <name>`       — show the tool list for a specific server
 *  - `/mcp reconnect <name>` — reconnect a failed/pending server
 */
export async function handleMcp(ctx: CommandContext, arg?: string): Promise<void> {
  const session = ctx.getSession();
  const trimmed = arg?.trim() ?? "";

  // /mcp reconnect <name>
  if (trimmed.startsWith("reconnect ")) {
    const serverName = trimmed.slice("reconnect ".length).trim();
    if (!serverName) {
      ctx.chatStore.pushHost("Usage: `/mcp reconnect <server-name>`");
      return;
    }
    ctx.chatStore.pushHost(`Reconnecting **${serverName}**…`);
    try {
      await session.reconnectMcpServer(serverName);
      const updated = await session.mcpServerStatus();
      const server = updated.find((s) => s.name === serverName);
      if (server) {
        ctx.chatStore.pushHost(formatMcpServer(server));
      } else {
        ctx.chatStore.pushHost(`Reconnected **${serverName}** — server no longer in status list.`);
      }
    } catch (err) {
      ctx.chatStore.pushHost(`Failed to reconnect **${serverName}**: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // Fetch server list for both remaining subcommands.
  let servers: McpServerStatus[];
  try {
    servers = await session.mcpServerStatus();
  } catch (err) {
    ctx.chatStore.pushHost(`Could not fetch MCP status: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // /mcp <name> — drill into one server
  if (trimmed.length > 0) {
    const server = servers.find((s) => s.name === trimmed);
    if (!server) {
      const names = servers.map((s) => `\`${s.name}\``).join(", ");
      ctx.chatStore.pushHost(`No MCP server named **${trimmed}**.${names.length > 0 ? ` Known servers: ${names}` : ""}`);
      return;
    }
    ctx.chatStore.pushHost(formatMcpServer(server));
    return;
  }

  // /mcp — list all
  ctx.chatStore.pushHost(formatMcpList(servers));
}
