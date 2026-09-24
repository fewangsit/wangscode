import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";

import { detectProjectWangsUiVersion, getMcpTargetRegistry } from "./mcp-sync.ts";

export interface McpToolInputSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
}

export interface McpToolInputSchema {
  type?: string;
  properties?: Record<string, McpToolInputSchemaProperty>;
  required?: string[];
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: McpToolInputSchema;
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    openWorld?: boolean;
  };
}

// Built-in tool definition for wangs-feature-build SDK MCP server
const WANGS_FEATURE_BUILD_TOOLS: McpTool[] = [
  {
    name: "create_feature",
    description:
      "Build a Wangs Foundation feature end-to-end (requirements -> data-layer -> test-contract -> ui-slice -> connect -> e2e-run -> lint -> review) via the real, gated feature-build pipeline. Call this ONLY when the user has confirmed a feature slug and has all three source document sets (the single-file PRD, test-case file(s), API spec/LLD file(s)) ready as absolute file paths. Never attempt to build the feature yourself — writing the files or judging a phase 'done' yourself defeats the entire point of this tool. After calling it, relay the result's pendingQuestion/status to the user verbatim; do not paraphrase or second-guess it.",
    inputSchema: {
      type: "object",
      properties: {
        featureSlug: { type: "string", description: "kebab-case feature slug, e.g. audit-tag" },
        prd: { type: "string", description: "absolute path to the feature's single-file PRD (PRD/<feature-name>.md, prd-single-file-convention.md)" },
        testCase: {
          type: "array",
          description: "absolute path(s) to the Test Case file(s) — main file plus FE/BE variants if the module splits them",
        },
        openapi: {
          type: "array",
          description:
            "absolute path(s) to API spec/LLD file(s) — real modules pair a .yaml (OpenAPI) with a .md (RBAC/SQL/derived-field logic) per endpoint group",
        },
        mode: { type: "string", description: "interactive or auto", enum: ["interactive", "auto"] },
      },
      required: ["featureSlug", "prd", "testCase", "openapi"],
    },
  },
];

const toolCache = new Map<string, McpTool[]>();

export function clearMcpToolCache(serverName?: string): void {
  if (serverName) {
    for (const key of toolCache.keys()) {
      if (key.startsWith(`${serverName}:`)) {
        toolCache.delete(key);
      }
    }
  } else {
    toolCache.clear();
  }
}

/**
 * Spawns a stdio MCP server process, initiates the handshake,
 * and requests the tools list via JSON-RPC `tools/list`.
 */
export async function fetchStdioMcpTools(command: string, args: string[], cwd?: string, timeoutMs = 8000): Promise<McpTool[]> {
  return new Promise((resolve) => {
    let resolved = false;
    let proc: ReturnType<typeof spawn> | null = null;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        if (proc) {
          try {
            proc.kill("SIGKILL");
          } catch {
            // Ignore kill error
          }
        }
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve([]);
    }, timeoutMs);

    try {
      proc = spawn(command, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      clearTimeout(timer);
      resolve([]);
      return;
    }

    let buffer = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: { tools?: McpTool[] };
          };
          if (msg.id === 2 && Array.isArray(msg.result?.tools)) {
            clearTimeout(timer);
            cleanup();
            resolve(msg.result.tools);
            return;
          }
        } catch {
          // Non-JSON line or partial, continue buffering
        }
      }
    });

    proc.on("error", () => {
      clearTimeout(timer);
      cleanup();
      resolve([]);
    });

    proc.on("exit", () => {
      clearTimeout(timer);
      cleanup();
      resolve([]);
    });

    // Send initialize handshake sequence
    try {
      proc.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "wangscode", version: "1.0.0" },
          },
        }) + "\n",
      );

      proc.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );

      proc.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }) + "\n",
      );
    } catch {
      clearTimeout(timer);
      cleanup();
      resolve([]);
    }
  });
}

/**
 * Resolves the stdio command and arguments for an MCP server from:
 * 1. server.config (if provided by SDK)
 * 2. cwd/.mcp.json
 * 3. ~/.claude.json
 * 4. wangs-ui fallback heuristic
 */
function resolveServerCommandAndArgs(server: McpServerStatus, cwd?: string): { command: string; args: string[] } | null {
  const config = server.config;

  // 1. server.config
  if (config && "command" in config && typeof config.command === "string") {
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    return { command: config.command, args };
  }

  // 2. cwd/.mcp.json
  if (cwd) {
    const projectMcpPath = path.join(cwd, ".mcp.json");
    try {
      if (existsSync(projectMcpPath)) {
        const raw = readFileSync(projectMcpPath, "utf8");
        const parsed = JSON.parse(raw) as {
          mcpServers?: Record<string, { command?: string; args?: string[] }>;
        };
        const s = parsed.mcpServers?.[server.name];
        if (s?.command) {
          return { command: s.command, args: s.args ?? [] };
        }
      }
    } catch {
      // Ignore
    }
  }

  // 3. ~/.claude.json
  try {
    const homedir = process.env.HOME || process.env.USERPROFILE || "";
    const claudeJsonPath = path.join(homedir, ".claude.json");
    if (existsSync(claudeJsonPath)) {
      const raw = readFileSync(claudeJsonPath, "utf8");
      const parsed = JSON.parse(raw) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
        projects?: Record<string, { mcpServers?: Record<string, { command?: string; args?: string[] }> }>;
      };
      const projectServers = cwd ? parsed.projects?.[cwd]?.mcpServers : undefined;
      const s = projectServers?.[server.name] ?? parsed.mcpServers?.[server.name];
      if (s?.command) {
        return { command: s.command, args: s.args ?? [] };
      }
    }
  } catch {
    // Ignore
  }

  // 4. wangs-ui fallback
  if (server.name === "wangs-ui") {
    const projectInfo = cwd ? detectProjectWangsUiVersion(cwd) : null;
    const version = projectInfo?.version ?? "latest";
    const registry = cwd ? getMcpTargetRegistry(cwd) : undefined;
    return {
      command: "npx",
      args: ["-y", ...(registry ? [`--registry=${registry}`] : []), `@wangs-ui/mcp@${version}`],
    };
  }

  return null;
}

/**
 * Parses an MCP "Streamable HTTP" JSON-RPC response, which may come back as either a plain JSON
 * body or a one-shot SSE stream (`event: message\ndata: {...}\n\n`) — both are spec-legal, and a
 * real server can send SSE even for a single non-streaming reply (confirmed against docs-knowledge's
 * actual server: it always does). A naive `resp.json()` throws on the SSE shape (it isn't valid
 * JSON on its own), which — caught by the caller's try/catch — silently produced zero tools and a
 * permanently-empty inputSchema for every HTTP-based server, not just docs-knowledge.
 */
async function parseJsonRpcHttpResponse(resp: Response): Promise<{ result?: { tools?: McpTool[] } }> {
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return (await resp.json()) as { result?: { tools?: McpTool[] } };
  }

  const text = await resp.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) continue;
    return JSON.parse(payload) as { result?: { tools?: McpTool[] } };
  }
  return {};
}

/**
 * Fetches full tool definitions (name, description, inputSchema, annotations)
 * for the given MCP server.
 */
export async function fetchServerToolDefinitions(server: McpServerStatus, cwd?: string): Promise<McpTool[]> {
  if (server.name === "wangs-feature-build") {
    return WANGS_FEATURE_BUILD_TOOLS;
  }

  const cacheKey = `${server.name}:${JSON.stringify(server.config ?? "")}`;
  const cached = toolCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  let fetchedTools: McpTool[] = [];

  // Check HTTP/SSE — restricted to config.type "http"/"sse" specifically, NOT any config that
  // merely happens to have a `url` field. `claude.ai Claude Docs` and similarly account-managed
  // servers report `type: "claudeai-proxy"` with a `url` pointing at Anthropic's own internal API
  // (https://api.anthropic.com/v1/pages/mcp) — confirmed via a real connected session. A plain
  // unauthenticated fetch() to that URL can never succeed (it needs the running `claude` subprocess's
  // own account session, which this app has no access to and must not try to fabricate), so
  // attempting it was pure wasted latency: a guaranteed-to-fail request eating the full 5s timeout
  // on every "Show Tools" click, silently swallowed by the catch below, forever stuck showing
  // "Loading details…". mcpServerStatus() itself never returns `description` for these proxied
  // tools either (confirmed: only `name`+`annotations`) — there is no manual way to get it from
  // outside the subprocess (that's what /doctor-style tool search running INSIDE the subprocess,
  // e.g. ToolSearch, has that this app's own external fetch never will), so this now fails fast
  // and lets the UI show "no description available" instead of stalling.
  const config = server.config;
  const isDirectlyFetchableHttp = config && "type" in config && (config.type === "http" || config.type === "sse");
  if (isDirectlyFetchableHttp && "url" in config && typeof (config as { url?: unknown }).url === "string") {
    const url = (config as { url: string }).url;
    if (url) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // MCP's "Streamable HTTP" transport lets the server reply as either a plain JSON body
            // or a one-shot SSE stream (`event: message\ndata: {...}`) — both are spec-legal, and
            // real servers (confirmed against docs-knowledge's actual server) do choose SSE even
            // for a single non-streaming reply. Without offering it in Accept, a strict server can
            // refuse the request outright; parseJsonRpcHttpResponse below handles either shape the
            // server actually sends back.
            Accept: "application/json, text/event-stream",
            ...(config as { headers?: Record<string, string> }).headers,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await parseJsonRpcHttpResponse(resp);
          if (Array.isArray(data.result?.tools)) {
            fetchedTools = data.result.tools;
          }
        }
      } catch {
        // Fall back
      }
    }
  }

  // If not HTTP/SSE or HTTP failed, try stdio
  if (fetchedTools.length === 0) {
    const cmdAndArgs = resolveServerCommandAndArgs(server, cwd);
    if (cmdAndArgs) {
      fetchedTools = await fetchStdioMcpTools(cmdAndArgs.command, cmdAndArgs.args, cwd);
    }
  }

  if (fetchedTools.length === 0) {
    // If external fetch failed or returned nothing, return existing tools
    return (server.tools ?? []) as McpTool[];
  }

  // Merge with server.tools to preserve annotations
  const existingMap = new Map((server.tools ?? []).map((t) => [t.name, t]));
  const merged: McpTool[] = fetchedTools.map((t) => {
    const existing = existingMap.get(t.name);
    return {
      ...t,
      annotations: existing?.annotations ?? t.annotations,
    };
  });

  // Also include any existing tools that weren't in fetchedTools
  for (const existing of server.tools ?? []) {
    if (!merged.some((t) => t.name === existing.name)) {
      merged.push(existing as McpTool);
    }
  }

  toolCache.set(cacheKey, merged);
  return merged;
}

/**
 * Enriches all connected servers in the list with full tool definitions.
 */
export async function enrichMcpServersWithTools(servers: McpServerStatus[], cwd?: string): Promise<McpServerStatus[]> {
  return Promise.all(
    servers.map(async (server) => {
      if (server.status !== "connected" && (!server.tools || server.tools.length === 0)) {
        return server;
      }
      try {
        const enrichedTools = await fetchServerToolDefinitions(server, cwd);
        if (enrichedTools.length > 0) {
          return {
            ...server,
            tools: enrichedTools,
          };
        }
      } catch {
        // Ignore error and keep server as is
      }
      return server;
    }),
  );
}
