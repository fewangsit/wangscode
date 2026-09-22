import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import type { ScrollBoxRenderable } from "@opentui/core";

import { BG, CARD_BORDER, GOLD } from "./theme.ts";

import type { McpTool } from "../mcp-tools.ts";

export type { McpTool };

// ── View state (managed externally in App.tsx) ────────────────────────────────

/** Four-level navigation. App.tsx holds a `McpPanelView` value in state and
 *  mutates it in `useKeyboard` — McpPanel is purely presentational. */
export type McpPanelView =
  | { kind: "servers"; selectedIdx: number }
  | { kind: "actions"; serverIdx: number; selectedIdx: number }
  | { kind: "tools"; serverIdx: number; selectedIdx: number }
  | { kind: "tool-detail"; serverIdx: number; toolIdx: number };

/** The actions available for any server in the actions sub-view — the same generic set for every
 *  server (including wangs-ui, spawned automatically at the version the project has installed —
 *  see mcp-sync.ts's resolveWangsUiMcpServer — so there's nothing left to install/update/sync
 *  manually here). */
export type McpServerAction = "Show Tools" | "Reconnect" | "Toggle" | string;

export const MCP_SERVER_ACTIONS: McpServerAction[] = ["Show Tools", "Reconnect", "Toggle"];

/** Derives the contextual action list for a given server. */
export function getServerActions(server: McpServerStatus): McpServerAction[] {
  const actions: McpServerAction[] = [];

  // Show Tools if tools are present or server is connected
  if ((server.tools && server.tools.length > 0) || server.status === "connected") {
    actions.push("Show Tools");
  }

  actions.push("Reconnect", "Toggle");

  return actions;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const MAX_VISIBLE = 6;

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

function statusColor(status: McpServerStatus["status"]): string {
  switch (status) {
    case "connected":
      return "#9ece6a";
    case "failed":
      return "#f7768e";
    case "pending":
      return "#e0af68";
    case "disabled":
      return "#565f89";
    case "needs-auth":
      return "#ff9e64";
  }
}

// ── View 1: Server list ───────────────────────────────────────────────────────

function ServerListView({
  servers,
  selectedIdx,
  loading,
  onClose,
  onSelect,
}: {
  servers: McpServerStatus[];
  selectedIdx: number;
  loading: boolean;
  onClose?: () => void;
  onSelect?: (idx: number) => void;
}): React.ReactNode {
  const windowStart = Math.max(0, Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), Math.max(0, servers.length - MAX_VISIBLE)));
  const visible = servers.slice(windowStart, windowStart + MAX_VISIBLE);

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 0, paddingY: 0 }}>
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <text content="MCP Servers" style={{ fg: GOLD }} />
        <text content="Esc to close" style={{ fg: "#565f89" }} onMouseDown={onClose} />
      </box>
      {loading ? (
        <box style={{ paddingX: 1 }}>
          <text content="Loading MCP servers…" style={{ fg: "#565f89" }} />
        </box>
      ) : servers.length === 0 ? (
        <box style={{ paddingX: 1 }}>
          <text content="No MCP servers configured for this session." style={{ fg: "#565f89" }} />
        </box>
      ) : (
        visible.map((s, idx) => {
          const actualIdx = windowStart + idx;
          const isSelected = actualIdx === selectedIdx;
          const glyph = statusGlyph(s.status);
          const color = statusColor(s.status);
          const toolCount = s.tools?.length ?? 0;
          const toolNote = s.status === "connected" ? ` · ${toolCount} tool${toolCount !== 1 ? "s" : ""}` : "";
          return (
            <box
              key={s.name}
              style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, backgroundColor: isSelected ? GOLD : undefined }}
              onMouseDown={() => onSelect?.(actualIdx)}
            >
              <box style={{ flexDirection: "row", marginRight: 2 }}>
                <text content={`${glyph} `} style={{ fg: isSelected ? BG : color }} />
                <text content={s.name} wrapMode="none" truncate style={{ fg: isSelected ? BG : GOLD }} />
              </box>
              <text content={`${s.status}${toolNote}`} wrapMode="none" truncate flexShrink={1} style={{ fg: isSelected ? "#343b58" : "#94a3b8" }} />
            </box>
          );
        })
      )}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text
          content={
            servers.length > MAX_VISIBLE
              ? `Server ${selectedIdx + 1} of ${servers.length} — ↑/↓ to navigate · Enter to select · Esc to cancel`
              : "↑/↓ to navigate · Enter to select · Esc to cancel"
          }
          style={{ fg: "#565f89" }}
        />
      </box>
    </box>
  );
}

// ── View 2: Server actions ────────────────────────────────────────────────────

function ServerActionsView({
  server,
  selectedIdx,
  loading,
  cwd,
  onBack,
  onSelect,
}: {
  server: McpServerStatus;
  selectedIdx: number;
  loading: boolean;
  cwd?: string;
  onBack?: () => void;
  onSelect?: (action: McpServerAction) => void;
}): React.ReactNode {
  const glyph = statusGlyph(server.status);
  const color = statusColor(server.status);
  const toolCount = server.tools?.length ?? 0;

  const config = server.config;
  const isStdio = config && "command" in config;
  const isHttp = config && "url" in config;

  const commandStr = isStdio ? (config.command as string) : undefined;
  const argsStr = isStdio && config.args && config.args.length > 0 ? config.args.join(" ") : undefined;
  const urlStr = isHttp ? (config.url as string) : undefined;

  let configLocation: string | undefined;
  if (server.scope === "project") {
    configLocation = cwd ? `${cwd}/.mcp.json` : ".mcp.json";
  } else if (server.scope === "user") {
    configLocation = "~/.claude.json";
  } else if (server.scope) {
    configLocation = server.scope;
  } else if (isStdio && (config as { cwd?: string }).cwd) {
    configLocation = `${(config as { cwd?: string }).cwd}/.mcp.json`;
  }

  // Derive capabilities dynamically from runtime server object or available tools/resources
  const rawCaps = (server as { capabilities?: string[] | Record<string, unknown> }).capabilities;
  let capabilitiesStr: string | undefined;
  if (Array.isArray(rawCaps)) {
    capabilitiesStr = rawCaps.join(" · ");
  } else if (rawCaps && typeof rawCaps === "object") {
    capabilitiesStr = Object.keys(rawCaps).join(" · ");
  } else if (toolCount > 0) {
    capabilitiesStr = "tools";
  }

  const actions = getServerActions(server);
  const toggleLabel = server.status === "disabled" ? "Enable server" : "Disable server";

  const formatActionLabel = (action: McpServerAction): string => {
    if (action === "Toggle") return toggleLabel;
    if (action === "Show Tools") return "Show Tools";
    if (action === "Reconnect") return "Reconnect";
    return `⚡ ${action}`;
  };

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 0, paddingY: 0 }}>
      {/* Header */}
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <text content={`${glyph} `} style={{ fg: color }} />
          <text content={server.name} style={{ fg: GOLD }} />
        </box>
        <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBack} />
      </box>

      {/* Rich server metadata block */}
      <box style={{ flexDirection: "column", paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <box style={{ minWidth: 18 }}>
            <text content="Status: " style={{ fg: "#94a3b8" }} />
          </box>
          <text content={`${glyph} ${server.status}`} style={{ fg: color }} />
        </box>

        {commandStr ? (
          <box style={{ flexDirection: "row" }}>
            <box style={{ minWidth: 18 }}>
              <text content="Command: " style={{ fg: "#94a3b8" }} />
            </box>
            <text content={commandStr} style={{ fg: "#c0caf5" }} />
          </box>
        ) : null}

        {argsStr ? (
          <box style={{ flexDirection: "row" }}>
            <box style={{ minWidth: 18 }}>
              <text content="Args: " style={{ fg: "#94a3b8" }} />
            </box>
            <text content={argsStr} wrapMode="none" truncate style={{ fg: "#c0caf5" }} />
          </box>
        ) : null}

        {urlStr ? (
          <box style={{ flexDirection: "row" }}>
            <box style={{ minWidth: 18 }}>
              <text content="URL: " style={{ fg: "#94a3b8" }} />
            </box>
            <text content={urlStr} wrapMode="none" truncate style={{ fg: "#38bdf8" }} />
          </box>
        ) : null}

        {configLocation ? (
          <box style={{ flexDirection: "row" }}>
            <box style={{ minWidth: 18 }}>
              <text content="Config location: " style={{ fg: "#94a3b8" }} />
            </box>
            <text content={configLocation} wrapMode="none" truncate style={{ fg: "#c0caf5" }} />
          </box>
        ) : null}

        {capabilitiesStr ? (
          <box style={{ flexDirection: "row" }}>
            <box style={{ minWidth: 18 }}>
              <text content="Capabilities: " style={{ fg: "#94a3b8" }} />
            </box>
            <text content={capabilitiesStr} style={{ fg: "#c0caf5" }} />
          </box>
        ) : null}

        <box style={{ flexDirection: "row" }}>
          <box style={{ minWidth: 18 }}>
            <text content="Tools: " style={{ fg: "#94a3b8" }} />
          </box>
          <text content={`${toolCount} tool${toolCount !== 1 ? "s" : ""}`} style={{ fg: "#c0caf5" }} />
        </box>

        {server.serverInfo?.version ? (
          <box style={{ flexDirection: "row" }}>
            <box style={{ minWidth: 18 }}>
              <text content="Version: " style={{ fg: "#94a3b8" }} />
            </box>
            <text content={server.serverInfo.version} style={{ fg: "#c0caf5" }} />
          </box>
        ) : null}

        {server.error ? (
          <box style={{ flexDirection: "row", marginTop: 1 }}>
            <box style={{ minWidth: 18 }}>
              <text content="Error: " style={{ fg: "#f7768e" }} />
            </box>
            <text content={server.error} style={{ fg: "#f7768e" }} />
          </box>
        ) : null}
      </box>

      {/* Action rows */}
      {loading ? (
        <box style={{ paddingX: 1 }}>
          <text content={`Connecting to ${server.name}…`} style={{ fg: GOLD }} />
        </box>
      ) : (
        actions.map((action, idx) => {
          const isSelected = idx === selectedIdx;
          return (
            <box key={action} style={{ paddingX: 1, backgroundColor: isSelected ? GOLD : undefined }} onMouseDown={() => onSelect?.(action)}>
              <text content={`  ${formatActionLabel(action)}`} style={{ fg: isSelected ? BG : "#c0caf5" }} />
            </box>
          );
        })
      )}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text content="↑/↓ to navigate · Enter to select · Esc to back" style={{ fg: "#565f89" }} />
      </box>
    </box>
  );
}

// ── View 3: Tool list ─────────────────────────────────────────────────────────

function ToolListView({
  server,
  selectedIdx,
  onBack,
  onSelect,
}: {
  server: McpServerStatus;
  selectedIdx: number;
  onBack?: () => void;
  onSelect?: (idx: number) => void;
}): React.ReactNode {
  const tools = (server.tools ?? []) as McpTool[];
  const windowStart = Math.max(0, Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), Math.max(0, tools.length - MAX_VISIBLE)));
  const visible = tools.slice(windowStart, windowStart + MAX_VISIBLE);

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 0, paddingY: 0 }}>
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <text content={server.name} style={{ fg: GOLD }} />
          <text content=" / tools" style={{ fg: "#565f89" }} />
        </box>
        <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBack} />
      </box>
      {tools.length === 0 ? (
        <box style={{ paddingX: 1 }}>
          <text content="No tools reported by this server." style={{ fg: "#565f89" }} />
        </box>
      ) : (
        visible.map((t, idx) => {
          const actualIdx = windowStart + idx;
          const isSelected = actualIdx === selectedIdx;
          return (
            <box
              key={t.name}
              style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, backgroundColor: isSelected ? GOLD : undefined }}
              onMouseDown={() => onSelect?.(actualIdx)}
            >
              <box style={{ minWidth: 24, marginRight: 2, flexShrink: 0 }}>
                <text content={`  ${t.name}`} wrapMode="none" truncate style={{ fg: isSelected ? BG : GOLD }} />
              </box>
              <text content={t.description ?? ""} wrapMode="none" truncate flexShrink={1} style={{ fg: isSelected ? "#343b58" : "#94a3b8" }} />
            </box>
          );
        })
      )}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text
          content={
            tools.length > MAX_VISIBLE
              ? `Tool ${selectedIdx + 1} of ${tools.length} — ↑/↓ to navigate · Enter to select · Esc to back`
              : "↑/↓ to navigate · Enter to select · Esc to back"
          }
          style={{ fg: "#565f89" }}
        />
      </box>
    </box>
  );
}

// ── View 4: Tool detail ───────────────────────────────────────────────────────

function ToolDetailView({
  server,
  tool,
  onBack,
  scrollRef,
}: {
  server: McpServerStatus;
  tool: McpTool;
  onBack?: () => void;
  scrollRef?: React.RefObject<ScrollBoxRenderable | null>;
}): React.ReactNode {
  const fullName = `mcp__${server.name}__${tool.name}`;
  const schema = tool.inputSchema;
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const paramEntries = Object.entries(properties);

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 0, paddingY: 0 }}>
      {/* Header */}
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <text content={tool.name} style={{ fg: GOLD }} />
          <text content={` · ${server.name}`} style={{ fg: "#565f89" }} />
        </box>
        <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBack} />
      </box>
      {/* Bounded scrollable content — height: 14 provides ample space to read full documentation & parameters */}
      <scrollbox ref={scrollRef} style={{ height: 14 }} focused={false}>
        <box style={{ flexDirection: "column", paddingX: 1 }}>
          {/* Tool name + full MCP name */}
          <box style={{ flexDirection: "row" }}>
            <text content="Tool name: " style={{ fg: "#94a3b8" }} />
            <text content={tool.name} style={{ fg: GOLD }} />
          </box>
          <box style={{ flexDirection: "row" }}>
            <text content="Full name: " style={{ fg: "#94a3b8" }} />
            <text content={fullName} wrapMode="none" truncate style={{ fg: "#565f89" }} />
          </box>
          {/* Annotations */}
          {tool.annotations && Object.values(tool.annotations).some(Boolean) ? (
            <box style={{ flexDirection: "row" }}>
              <text content="Flags:     " style={{ fg: "#94a3b8" }} />
              <text
                content={[
                  tool.annotations.readOnly && "read-only",
                  tool.annotations.destructive && "destructive",
                  tool.annotations.openWorld && "open-world",
                ]
                  .filter(Boolean)
                  .join(", ")}
                style={{ fg: "#ff9e64" }}
              />
            </box>
          ) : null}
          {/* Description */}
          {tool.description ? (
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text content="Description:" style={{ fg: "#94a3b8" }} />
              <box style={{ paddingLeft: 3 }}>
                <text content={tool.description} style={{ fg: "#c0caf5" }} />
              </box>
            </box>
          ) : !tool.inputSchema ? (
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text content="Description:" style={{ fg: "#94a3b8" }} />
              <box style={{ paddingLeft: 3 }}>
                <text content="Loading details…" style={{ fg: "#565f89" }} />
              </box>
            </box>
          ) : null}
          {/* Parameters from inputSchema */}
          {paramEntries.length > 0 ? (
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text content="Parameters:" style={{ fg: "#94a3b8" }} />
              {paramEntries.map(([paramName, paramDef]) => {
                const isRequired = required.has(paramName);
                const typeStr = paramDef.type ?? "any";
                const reqStr = isRequired ? " (required)" : "";
                const descStr = paramDef.description ? ` - ${paramDef.description}` : "";
                return (
                  <box key={paramName} style={{ flexDirection: "column", paddingLeft: 5, marginTop: 1 }}>
                    <text content={`● ${paramName}: ${typeStr}${reqStr}${descStr}`} style={{ fg: "#c0caf5" }} />
                  </box>
                );
              })}
            </box>
          ) : schema !== undefined ? (
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text content="Parameters:" style={{ fg: "#94a3b8" }} />
              <box style={{ paddingLeft: 5, marginTop: 1 }}>
                <text content="(no parameters)" style={{ fg: "#565f89" }} />
              </box>
            </box>
          ) : null}
        </box>
      </scrollbox>
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text content="↑/↓ to scroll · Esc to back" style={{ fg: "#565f89" }} />
      </box>
    </box>
  );
}

// ── McpPanel (root export) ────────────────────────────────────────────────────

export interface McpPanelProps {
  view: McpPanelView;
  servers: McpServerStatus[];
  loading: boolean;
  cwd?: string;
  toolDetailScrollRef?: React.RefObject<ScrollBoxRenderable | null>;
  onClose?: () => void;
  onBack?: () => void;
  onSelectServer?: (idx: number) => void;
  /** serverIdx is passed back so App.tsx doesn't need to re-derive it from `view`. */
  onSelectAction?: (serverIdx: number, action: McpServerAction) => void;
  onSelectTool?: (toolIdx: number) => void;
}

export function McpPanel({
  view,
  servers,
  loading,
  cwd,
  toolDetailScrollRef,
  onClose,
  onBack,
  onSelectServer,
  onSelectAction,
  onSelectTool,
}: McpPanelProps): React.ReactNode {
  switch (view.kind) {
    case "servers":
      return <ServerListView servers={servers} selectedIdx={view.selectedIdx} loading={loading} onClose={onClose} onSelect={onSelectServer} />;

    case "actions": {
      const server = servers[view.serverIdx];
      if (!server) return null;
      return (
        <ServerActionsView
          server={server}
          selectedIdx={view.selectedIdx}
          loading={loading}
          cwd={cwd}
          onBack={onBack}
          onSelect={(action) => onSelectAction?.(view.serverIdx, action)}
        />
      );
    }

    case "tools": {
      const server = servers[view.serverIdx];
      if (!server) return null;
      return <ToolListView server={server} selectedIdx={view.selectedIdx} onBack={onBack} onSelect={onSelectTool} />;
    }

    case "tool-detail": {
      const server = servers[view.serverIdx];
      const tools = (server?.tools ?? []) as McpTool[];
      const tool = tools[view.toolIdx];
      if (!server || !tool) return null;
      return <ToolDetailView server={server} tool={tool} onBack={onBack} scrollRef={toolDetailScrollRef} />;
    }
  }
}
