import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createOpencode, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { AgentEngine, EngineModel, EngineRunOptions, EngineSessionSummary, EngineStreamChunk, EngineUsage } from "./types.ts";
import { syncOpenCodeSubagents } from "../subagents.ts";

/**
 * Default OpenCode models available out-of-the-box.
 * Compatible with multi-provider setups (Anthropic, OpenAI, DeepSeek, Local Ollama, OpenCode).
 */
export const DEFAULT_OPENCODE_MODELS: EngineModel[] = [
  {
    id: "opencode-go/claude-3.7-sonnet",
    name: "Claude 3.7 Sonnet (OpenCode Go)",
    displayName: "Claude 3.7 Sonnet (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    supportsThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  {
    id: "opencode-go/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet (OpenCode Go)",
    displayName: "Claude 3.5 Sonnet (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "opencode-go/deepseek-r1",
    name: "DeepSeek R1 (OpenCode Go)",
    displayName: "DeepSeek R1 (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsThinking: true,
    supportsEffort: false,
  },
  {
    id: "opencode-go/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash (OpenCode Go)",
    displayName: "DeepSeek V4.1 Flash (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "opencode-go/deepseek-chat",
    name: "DeepSeek V3 (OpenCode Go)",
    displayName: "DeepSeek V3 (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "opencode-go/qwen3.8-max",
    name: "Qwen 3.8 Max (OpenCode Go)",
    displayName: "Qwen 3.8 Max (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "opencode-go/qwen3.8-flash",
    name: "Qwen 3.8 Flash (OpenCode Go)",
    displayName: "Qwen 3.8 Flash (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "opencode-go/kimi-k3",
    name: "Kimi K3 (OpenCode Go)",
    displayName: "Kimi K3 (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsThinking: true,
    supportsEffort: false,
  },
  {
    id: "opencode-go/glm-5.3",
    name: "GLM 5.3 (OpenCode Go)",
    displayName: "GLM 5.3 (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: true,
    supportsEffort: false,
  },
  {
    id: "opencode-go/deepseek-v4-pro",
    name: "DeepSeek V4 Pro (OpenCode Go)",
    displayName: "DeepSeek V4 Pro (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "opencode-go/grok-4.7",
    name: "Grok 4.7 (OpenCode Go)",
    displayName: "Grok 4.7 (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: true,
    supportsEffort: false,
  },
  {
    id: "opencode-go/minimax-m3",
    name: "MiniMax M3 (OpenCode Go)",
    displayName: "MiniMax M3 (OpenCode Go)",
    provider: "opencode-go",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
];

let sharedClient: OpencodeClient | null = null;
let sharedServer: { url: string; close(): void } | null = null;
let clientPromise: Promise<OpencodeClient> | null = null;

/**
 * Connects to an existing OpenCode daemon (e.g. localhost:4096) or spawns a headless OpenCode server.
 */
export async function getOpencodeClient(options?: { directory?: string }): Promise<OpencodeClient> {
  if (sharedClient) return sharedClient;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const url = process.env.OPENCODE_URL || "http://127.0.0.1:4096";

    // 1. Try connecting to already running server
    try {
      const client = createOpencodeClient({ baseUrl: url, directory: options?.directory });
      // Ping check
      await client.session.list({ query: { directory: options?.directory } });
      sharedClient = client;
      return sharedClient;
    } catch {
      // 2. Spawn headless opencode serve
      try {
        const started = await createOpencode({
          hostname: "127.0.0.1",
          port: 4096,
          timeout: 15000,
        });
        sharedServer = started.server;
        sharedClient = started.client;
        return sharedClient;
      } catch (err) {
        console.warn("[OpenCode SDK] Could not start or connect to opencode server:", err);
        throw err;
      }
    }
  })();

  return clientPromise;
}

/**
 * Closes the background OpenCode server if one was spawned by this process.
 */
export function closeOpencodeServer(): void {
  if (sharedServer) {
    try {
      sharedServer.close();
    } catch {
      // ignore error on close
    }
    sharedServer = null;
    sharedClient = null;
    clientPromise = null;
  }
}

// Ensure cleanup on process exit
if (typeof process !== "undefined" && process.on) {
  process.on("exit", () => {
    closeOpencodeServer();
  });
}

export function getOpencodeGoApiKey(cwd?: string): string | undefined {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;
  if (process.env.OPENCODE_GO_API_KEY) return process.env.OPENCODE_GO_API_KEY;

  const candidateDirs: string[] = [];
  if (cwd) {
    candidateDirs.push(cwd);
    candidateDirs.push(path.join(cwd, "wangscode"));
  }
  candidateDirs.push(process.cwd());
  candidateDirs.push(path.join(process.cwd(), "wangscode"));
  try {
    const home = os.homedir();
    candidateDirs.push(path.join(home, ".local", "share", "opencode"));
    candidateDirs.push(path.join(home, ".config", "opencode"));
  } catch {
    // ignore
  }

  for (const dir of candidateDirs) {
    const authPath = path.join(dir, "auth.json");
    try {
      if (fs.existsSync(authPath)) {
        const raw = fs.readFileSync(authPath, "utf-8");
        const parsed = JSON.parse(raw);
        const opencodeGo = parsed?.["opencode-go"] || parsed?.opencodeGo || parsed?.opencode;
        const key = opencodeGo?.key || opencodeGo?.apiKey;
        if (key && typeof key === "string") {
          process.env.OPENCODE_API_KEY = key;
          return key;
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

/**
 * Real production AI engine powered directly by @opencode-ai/sdk.
 */
export class OpenCodeSdkEngine implements AgentEngine {
  readonly name = "opencode";
  public activeSessionId?: string;
  private activeModel = "opencode-go/qwen3.8-flash";
  private interrupted = false;
  private cwd?: string;
  private sessionStartTime: number = Date.now();
  private totalApiDurationMs: number = 0;

  private accumulatedUsage: EngineUsage = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 200000,
    maxOutputTokens: 64000,
  };

  constructor(opts?: { cwd?: string }) {
    this.cwd = opts?.cwd;
  }

  getTimingStats(): { apiDurationMs: number; wallDurationMs: number } {
    return {
      apiDurationMs: this.totalApiDurationMs,
      wallDurationMs: Math.max(0, Date.now() - this.sessionStartTime),
    };
  }

  async registerMcpServers(mcpServers: Record<string, any>, directory?: string): Promise<void> {
    try {
      const client = await getOpencodeClient({ directory: directory || this.cwd });
      for (const [name, cfg] of Object.entries(mcpServers)) {
        if (!cfg) continue;
        let config: any;
        if (cfg.command || cfg.type === "stdio") {
          config = {
            type: "local",
            command: [cfg.command, ...(cfg.args ?? [])],
            environment: cfg.env,
          };
        } else if (cfg.url || cfg.type === "sse" || cfg.type === "http") {
          config = {
            type: "remote",
            url: cfg.url,
            headers: cfg.headers,
          };
        }
        if (config) {
          try {
            await client.mcp.add({
              body: { name, config },
              query: { directory: directory || this.cwd },
            });
          } catch {
            // Already added or not supported in this runtime
          }
        }
      }
    } catch {
      // Ignore MCP registration errors
    }
  }

  async initSession(options: EngineRunOptions): Promise<string> {
    syncOpenCodeSubagents(options.cwd || this.cwd);

    if (options.mcpServers) {
      await this.registerMcpServers(options.mcpServers, options.cwd || this.cwd);
    }

    const opencodeGoApiKey = getOpencodeGoApiKey(options.cwd || this.cwd);
    if (opencodeGoApiKey) {
      try {
        const globalAuthDir = path.join(os.homedir(), ".local", "share", "opencode");
        const globalAuthFile = path.join(globalAuthDir, "auth.json");
        let currentAuth: Record<string, any> = {};
        if (fs.existsSync(globalAuthFile)) {
          try { currentAuth = JSON.parse(fs.readFileSync(globalAuthFile, "utf-8")); } catch {}
        }
        currentAuth["opencode"] = { type: "api", key: opencodeGoApiKey };
        currentAuth["opencode-go"] = { type: "api", key: opencodeGoApiKey };
        fs.mkdirSync(globalAuthDir, { recursive: true });
        fs.writeFileSync(globalAuthFile, JSON.stringify(currentAuth, null, 2), "utf-8");
      } catch {}

      try {
        const baseUrl = process.env.OPENCODE_URL || "http://127.0.0.1:4096";
        await fetch(`${baseUrl}/auth/opencode`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: opencodeGoApiKey }),
        }).catch(() => {});
        await fetch(`${baseUrl}/auth/opencode-go`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: opencodeGoApiKey }),
        }).catch(() => {});
      } catch {
        // ignore
      }

      try {
        const client = await getOpencodeClient({ directory: options.cwd || this.cwd });
        await (client as any).auth?.set?.({
          path: { id: "opencode" },
          body: { type: "api", key: opencodeGoApiKey },
          query: { directory: options.cwd || this.cwd },
        }).catch(() => {});
        await (client as any).auth?.set?.({
          path: { id: "opencode-go" },
          body: { type: "api", key: opencodeGoApiKey },
          query: { directory: options.cwd || this.cwd },
        }).catch(() => {});
      } catch {
        // ignore
      }
    }

    if (this.activeSessionId) return this.activeSessionId;
    if (options.resumeSessionId) {
      this.activeSessionId = options.resumeSessionId;
      return this.activeSessionId;
    }

    try {
      const client = await getOpencodeClient({ directory: options.cwd || this.cwd });
      const res = await client.session.create({
        body: { title: "Wangscode Chat Session" },
        query: { directory: options.cwd || this.cwd },
      });
      if (res.data?.id) {
        this.activeSessionId = res.data.id;
        return this.activeSessionId;
      }
    } catch (err) {
      console.warn("[OpenCode SDK] Failed to create session via SDK, generating fallback session ID:", err);
    }

    this.activeSessionId = `opencode-session-${Date.now()}`;
    return this.activeSessionId;
  }

  async setModel(modelId: string): Promise<void> {
    this.activeModel = modelId;
  }

  async listModels(): Promise<EngineModel[]> {
    try {
      const client = await getOpencodeClient({ directory: this.cwd });
      const res = await client.provider.list();
      const models: EngineModel[] = [];

      for (const provider of res.data?.all ?? []) {
        if (provider.id !== "opencode-go" && provider.id !== "opencode") continue;
        const providerModels = provider.models ?? {};
        for (const [modelId, modelDef] of Object.entries(providerModels)) {
          models.push({
            id: `${provider.id}/${modelId}`,
            name: (modelDef as any).name || modelId,
            displayName: `${(modelDef as any).name || modelId} (${provider.name})`,
            provider: provider.id,
            contextWindow: (modelDef as any).limit?.contextWindow ?? (modelDef as any).limit?.context ?? 128000,
            maxOutputTokens: (modelDef as any).limit?.maxOutputTokens ?? (modelDef as any).limit?.output ?? 8192,
            supportsThinking: (modelDef as any).capabilities?.reasoning ?? (modelDef as any).reasoning ?? false,
            supportsEffort: (modelDef as any).capabilities?.reasoning ?? (modelDef as any).reasoning ?? false,
            supportedEffortLevels: ["low", "medium", "high", "max"],
          });
        }
      }

      if (models.length > 0) {
        // Merge with DEFAULT_OPENCODE_MODELS ensuring uniqueness
        const map = new Map<string, EngineModel>();
        for (const m of DEFAULT_OPENCODE_MODELS) {
          map.set(m.id, m);
        }
        for (const m of models) {
          map.set(m.id, m);
        }
        return Array.from(map.values());
      }
    } catch {
      // Fallback if client is unreachable
    }

    return DEFAULT_OPENCODE_MODELS;
  }

  async listSessions(cwd: string): Promise<EngineSessionSummary[]> {
    try {
      const client = await getOpencodeClient({ directory: cwd || this.cwd });
      const res = await client.session.list({ query: { directory: cwd || this.cwd } });
      if (res.data) {
        return res.data.map((s) => ({
          sessionId: s.id,
          title: s.title ?? `OpenCode Session (${s.id.slice(0, 8)})`,
          createdAt: s.time?.created ? new Date(s.time.created).toISOString() : new Date().toISOString(),
          updatedAt: s.time?.updated ? new Date(s.time.updated).toISOString() : new Date().toISOString(),
          messageCount: 0,
          model: this.activeModel,
        }));
      }
    } catch {
      // Fallback
    }

    if (this.activeSessionId) {
      return [
        {
          sessionId: this.activeSessionId,
          title: "Current Active Session",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 1,
          model: this.activeModel,
        },
      ];
    }

    return [];
  }

  async getUsage(): Promise<EngineUsage> {
    return { ...this.accumulatedUsage };
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    if (this.activeSessionId) {
      try {
        const client = await getOpencodeClient({ directory: this.cwd });
        await client.session.abort({ path: { id: this.activeSessionId } });
      } catch {
        // Ignore abort error
      }
    }
  }

  async getMcpStatus(): Promise<any[]> {
    try {
      const client = await getOpencodeClient({ directory: this.cwd });
      const res = await client.mcp.status();
      const list: any[] = [];
      for (const [name, val] of Object.entries((res.data as any) ?? {})) {
        list.push({
          name,
          status: (val as any).status === "error" ? "failed" : ((val as any).status ?? "connected"),
          error: (val as any).error,
          tools: (val as any).tools ?? [],
        });
      }
      return list;
    } catch {
      return [];
    }
  }

  async toggleMcp(name: string, enabled: boolean): Promise<any> {
    try {
      const client = await getOpencodeClient({ directory: this.cwd });
      if (enabled) {
        await client.mcp.connect({ path: { name }, query: { directory: this.cwd } });
      } else {
        await client.mcp.disconnect({ path: { name }, query: { directory: this.cwd } });
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async *streamPrompt(prompt: AsyncIterable<any> | string, options: EngineRunOptions): AsyncIterable<EngineStreamChunk> {
    this.interrupted = false;
    if (options.model) {
      await this.setModel(options.model);
    }

    let client: OpencodeClient;
    try {
      client = await getOpencodeClient({ directory: options.cwd || this.cwd });
    } catch (err) {
      yield {
        type: "error",
        message: `Failed to connect to OpenCode engine: ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }

    if (!this.activeSessionId) {
      await this.initSession(options);
    }

    const sessionId = this.activeSessionId!;
    const promptStream = typeof prompt === "string" ? [prompt] : prompt;

    // Open SSE subscription before pushing prompt
    // Pass directory so OpenCode forwards events scoped to this project
    let sse: any;
    try {
      const sseDir = options.cwd || this.cwd;
      sse = await client.event.subscribe(
        sseDir ? { query: { directory: sseDir } } : undefined,
      );
    } catch (err) {
      yield {
        type: "error",
        message: `Failed to subscribe to OpenCode events: ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }

    for await (const rawItem of promptStream) {
      if (this.interrupted) break;
      const turnStart = Date.now();

      const userText =
        typeof rawItem === "string"
          ? rawItem
          : typeof (rawItem as any)?.message?.content === "string"
            ? (rawItem as any).message.content
            : String(rawItem ?? "");

      if (!userText.trim()) continue;

      const promptBody: any = {
        parts: [{ type: "text", text: userText }],
      };

      if (options.systemPrompt) {
        promptBody.system = typeof options.systemPrompt === "string" ? options.systemPrompt : JSON.stringify(options.systemPrompt);
      }

      // OpenCode's API has no native outputFormat field.  When the caller
      // requests json_schema output, inject a clear instruction + the full
      // schema into the system text so the model knows to return only JSON.
      if (options.outputFormat?.type === "json_schema" && options.outputFormat.schema) {
        const schemaInstruction =
          `\n\n---\nIMPORTANT: Your response MUST be a single valid JSON object that strictly` +
          ` conforms to the following JSON Schema. Output ONLY the JSON — no prose,` +
          ` no markdown fences, no explanation before or after.\n\nSchema:\n` +
          JSON.stringify(options.outputFormat.schema, null, 2) +
          `\n---`;
        if (promptBody.system) {
          promptBody.system += schemaInstruction;
        } else {
          promptBody.system = schemaInstruction;
        }
      }

      if (this.activeModel) {
        let providerID = "opencode";
        let modelID = this.activeModel;
        if (modelID.startsWith("opencode-go/")) {
          providerID = "opencode";
          modelID = modelID.slice("opencode-go/".length);
        } else if (modelID.startsWith("opencode/")) {
          providerID = "opencode";
          modelID = modelID.slice("opencode/".length);
        } else if (modelID.startsWith("openrouter/")) {
          providerID = "openrouter";
          modelID = modelID.slice("openrouter/".length);
        } else if (modelID.includes("/")) {
          const parts = modelID.split("/");
          providerID = parts[0];
          modelID = parts.slice(1).join("/");
        }
        if (providerID === "opencode-go") {
          providerID = "opencode";
        }
        promptBody.model = {
          providerID,
          modelID,
        };
      }

      try {
        await client.session.promptAsync({
          path: { id: sessionId },
          body: promptBody,
          query: { directory: options.cwd || this.cwd },
        });
      } catch (err) {
        yield {
          type: "error",
          message: `Failed to send prompt to OpenCode: ${err instanceof Error ? err.message : String(err)}`,
        };
        break;
      }

      let activeSubagentToolUseId: string | undefined;
      const childSessionToParentToolUseId = new Map<string, string>();

      // Stream events from SSE for this turn
      for await (const event of sse.stream) {
        if (this.interrupted) {
          await client.session.abort({ path: { id: sessionId } }).catch(() => { });
          break;
        }

        const props = (event as any).properties ?? (event as any).data ?? {};
        const evtSessionId = props?.sessionID || (event as any).sessionID;
        const isPermissionAsked =
          event.type === "permission.asked" ||
          event.type === "permission.v2.asked" ||
          event.type === "permission.updated";

        // question.asked / question.v2.asked must never be discarded even when
        // the sessionID belongs to a child/sub-agent session.
        const isQuestionAsked =
          event.type === "question.asked" ||
          event.type === "question.v2.asked";

        const isChildSession = Boolean(evtSessionId && evtSessionId !== sessionId);

        if (isChildSession && !isPermissionAsked && !isQuestionAsked) {
          if (evtSessionId && activeSubagentToolUseId) {
            childSessionToParentToolUseId.set(evtSessionId, activeSubagentToolUseId);
          }
          const parentId = (evtSessionId ? childSessionToParentToolUseId.get(evtSessionId) : undefined) || activeSubagentToolUseId;

          // If this event belongs to a child/sub-agent session, forward it with parent metadata
          if (event.type === "message.part.delta") {
            if (props.field === "reasoning") {
              yield {
                type: "thinking_delta",
                thinking: props.delta,
                parentToolUseId: parentId,
                childSessionId: evtSessionId,
              };
            } else if (props.field === "text") {
              yield {
                type: "text_delta",
                text: props.delta,
                parentToolUseId: parentId,
                childSessionId: evtSessionId,
              };
            }
          } else if (event.type === "message.part.updated") {
            const part = props.part;
            if (part?.type === "tool") {
              const childToolId = part.callID || part.id;
              if (part.state?.status === "running" || part.state?.status === "pending") {
                yield {
                  type: "tool_call_start",
                  id: childToolId,
                  name: part.tool,
                  parentToolUseId: parentId,
                  childSessionId: evtSessionId,
                };
                if (part.state.input) {
                  yield {
                    type: "tool_call_delta",
                    id: childToolId,
                    partialJson: typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input),
                    parentToolUseId: parentId,
                    childSessionId: evtSessionId,
                  };
                }
              } else if (part.state?.status === "completed" || part.state?.status === "error") {
                yield {
                  type: "tool_call_end",
                  id: childToolId,
                  parentToolUseId: parentId,
                  childSessionId: evtSessionId,
                };
                yield {
                  type: "tool_result",
                  id: childToolId,
                  content: typeof part.state.output === "string" ? part.state.output : JSON.stringify(part.state.output ?? ""),
                  isError: part.state.status === "error",
                  parentToolUseId: parentId,
                  childSessionId: evtSessionId,
                };
              }
            }
          }
          // Do not treat child session idle or other events as main turn completion
          continue;
        }

        if (event.type === "message.part.delta") {
          if (props.field === "reasoning") {
            yield { type: "thinking_delta", thinking: props.delta };
          } else if (props.field === "text") {
            yield { type: "text_delta", text: props.delta };
          }
        } else if (event.type === "message.part.updated") {
          const part = props.part;
          if (!part) continue;

          if (part.type === "text" && typeof part.text === "string" && part.text) {
            // Emit a snapshot of the complete text as delivered by OpenCode.
            // This is the canonical final text for this part — the consumer
            // (opencode-engine.ts) prefers it over accumulated text_deltas
            // when extracting structured output.
            yield { type: "text_snapshot", text: part.text };
          } else if (part.type === "tool") {
            const toolCallId = part.callID || part.id;
            const isSubagentTool =
              part.tool?.toLowerCase() === "agent" ||
              part.tool?.toLowerCase() === "subagent" ||
              part.tool?.toLowerCase() === "task";

            if (part.state?.status === "running" || part.state?.status === "pending") {
              if (isSubagentTool) {
                activeSubagentToolUseId = toolCallId;
              }
              yield { type: "tool_call_start", id: toolCallId, name: part.tool };
              if (part.state.input) {
                yield {
                  type: "tool_call_delta",
                  id: toolCallId,
                  partialJson: typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input),
                };
              }
            } else if (part.state?.status === "completed" || part.state?.status === "error") {
              if (activeSubagentToolUseId === toolCallId) {
                activeSubagentToolUseId = undefined;
              }
              yield { type: "tool_call_end", id: toolCallId };
              yield {
                type: "tool_result",
                id: toolCallId,
                content: typeof part.state.output === "string" ? part.state.output : JSON.stringify(part.state.output ?? ""),
                isError: part.state.status === "error",
              };
            }
          } else if (part.type === "step-finish") {
            if (part.tokens) {
              this.accumulatedUsage.inputTokens += part.tokens.input ?? 0;
              this.accumulatedUsage.outputTokens += part.tokens.output ?? 0;
              this.accumulatedUsage.thinkingTokens = (this.accumulatedUsage.thinkingTokens ?? 0) + (part.tokens.reasoning ?? 0);
            }
            if (typeof part.cost === "number") {
              this.accumulatedUsage.costUSD += part.cost;
            }
            yield { type: "usage", usage: { ...this.accumulatedUsage } };
          }
        } else if (isPermissionAsked) {
          const perm = props;
          const permId = perm.id || perm.requestID;
          // sessionID from the permission event (may differ from our sessionId in sub-agent calls)
          const permSessionId = perm.sessionID || evtSessionId || sessionId;
          if (permId) {
            const baseUrl = process.env.OPENCODE_URL || "http://127.0.0.1:4096";
            const directory = options.cwd || this.cwd;

            // Primary endpoint: POST /permission/{permId}/reply?directory=...
            // Fallback:         POST /api/session/{sessionID}/permission/{permId}/reply (v2)
            const replyPermission = async (reply: "once" | "always" | "reject") => {
              // Build primary URL — include ?directory so OpenCode can persist
              // "always" rules to the correct project config on disk.
              const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : "";
              const primaryUrl = `${baseUrl}/permission/${permId}/reply${dirParam}`;

              try {
                const res = await fetch(primaryUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reply }),
                });

                if (!res.ok) {
                  const errText = await res.text().catch(() => "");
                  console.warn(
                    `[OpenCode SDK] Primary permission reply returned ${res.status}: ${errText}. Trying v2 fallback…`,
                  );

                  // Fallback: v2 endpoint scoped to session
                  const v2Url = `${baseUrl}/api/session/${permSessionId}/permission/${permId}/reply`;
                  const v2Res = await fetch(v2Url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reply }),
                  });

                  if (!v2Res.ok) {
                    const v2Err = await v2Res.text().catch(() => "");
                    console.warn(`[OpenCode SDK] v2 permission reply also failed (${v2Res.status}): ${v2Err}`);
                  }
                }
              } catch (err) {
                console.warn(`[OpenCode SDK] Failed to reply to permission request ${permId}:`, err);
              }
            };

            const skipPermissions =
              process.env.OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS === "true" ||
              process.env.OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS === "1" ||
              Boolean(options.allowDangerouslySkipPermissions);

            if (skipPermissions) {
              await replyPermission("always");
            } else if (options.canUseTool) {
              const toolName = perm.permission || perm.action || perm.title || perm.type || "tool";
              const patterns = perm.patterns || perm.resources || [];
              const patternDesc = Array.isArray(patterns) && patterns.length > 0 ? patterns.join(", ") : "";
              const title = perm.title || (patternDesc ? `Allow access to ${patternDesc}` : `Allow ${toolName}`);
              const input = perm.metadata || (patternDesc ? { patterns } : {});
              const suggestions =
                (perm.always && perm.always.length > 0) || (perm.save && perm.save.length > 0)
                  ? [{ type: "always", patterns: perm.always || perm.save }]
                  : undefined;

              try {
                const result = await options.canUseTool(toolName, input, {
                  signal: options.signal ?? new AbortController().signal,
                  title,
                  suggestions: suggestions as any,
                });
                const responseChoice =
                  result.behavior === "allow"
                    ? (result.updatedPermissions && result.updatedPermissions.length > 0 ? "always" : "once")
                    : "reject";
                await replyPermission(responseChoice);
              } catch {
                await replyPermission("reject");
              }
            } else {
              console.warn(
                `[OpenCode SDK] Permission request ${permId} denied: To skip permissions in headless mode, set OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS=true`,
              );
              await replyPermission("reject");
            }
          }
        } else if (isQuestionAsked) {
          // The model used OpenCode's built-in `question` tool to ask the user
          // a structured question (with options).  We must reply via the
          // dedicated endpoint — ordinary chat messages do NOT unblock it.
          const q = props;
          const qId = q.id || q.requestID;
          const qSessionId = q.sessionID || evtSessionId || sessionId;
          if (qId) {
            const baseUrl = process.env.OPENCODE_URL || "http://127.0.0.1:4096";
            const directory = options.cwd || this.cwd;

            // answers: one string[] per question in the questions array.
            // We pick the first option (or the one marked recommended/default).
            const buildDefaultAnswers = (questions: any[]): string[][] =>
              questions.map((qi: any) => {
                const opts: any[] = qi.options ?? qi.answers ?? [];
                const rec = opts.find(
                  (o: any) =>
                    o.recommended === true ||
                    String(o.label ?? "").toLowerCase().includes("recommended"),
                );
                return [rec?.label ?? opts[0]?.label ?? String(opts[0] ?? "yes")];
              });

            const questions: any[] = q.questions ?? [q];

            const replyQuestion = async (answers: string[][]) => {
              const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : "";
              const primaryUrl = `${baseUrl}/question/${qId}/reply${dirParam}`;
              try {
                const res = await fetch(primaryUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ answers }),
                });
                if (!res.ok) {
                  const errText = await res.text().catch(() => "");
                  console.warn(
                    `[OpenCode SDK] Primary question reply ${res.status}: ${errText}. Trying v2 fallback…`,
                  );
                  // v2 fallback: scoped to session
                  const v2Url = `${baseUrl}/api/session/${qSessionId}/question/${qId}/reply`;
                  const v2Res = await fetch(v2Url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ answers }),
                  });
                  if (!v2Res.ok) {
                    const v2Err = await v2Res.text().catch(() => "");
                    console.warn(`[OpenCode SDK] v2 question reply also failed (${v2Res.status}): ${v2Err}`);
                  }
                }
              } catch (err) {
                console.warn(`[OpenCode SDK] Failed to reply to question ${qId}:`, err);
              }
            };

            const rejectQuestion = async () => {
              const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : "";
              const rejectUrl = `${baseUrl}/question/${qId}/reject${dirParam}`;
              try {
                const res = await fetch(rejectUrl, { method: "POST" });
                if (!res.ok) {
                  const v2Url = `${baseUrl}/api/session/${qSessionId}/question/${qId}/reject`;
                  await fetch(v2Url, { method: "POST" }).catch(() => { });
                }
              } catch {
                // Ignore
              }
            };

            const skipPermissions =
              process.env.OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS === "true" ||
              process.env.OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS === "1" ||
              Boolean(options.allowDangerouslySkipPermissions);

            if (skipPermissions) {
              // Headless: auto-pick first/recommended option for every question
              await replyQuestion(buildDefaultAnswers(questions));
            } else if (options.canUseTool) {
              // Interactive: surface through canUseTool so the user sees the question
              const firstQ = questions[0] ?? {};
              const optionLines = (firstQ.options ?? firstQ.answers ?? [])
                .map((o: any) => `• ${o.label ?? o}${o.description ? `: ${o.description}` : ""}`)
                .join("\n");
              const title =
                firstQ.header ??
                firstQ.question ??
                `Model question (${qId})`;
              const body = firstQ.question ?? firstQ.header ?? "";
              const displayTitle = body && body !== title ? `${title}\n${body}` : title;
              try {
                const result = await options.canUseTool(
                  "question",
                  { questions, options: firstQ.options ?? firstQ.answers ?? [] },
                  {
                    signal: options.signal ?? new AbortController().signal,
                    title: optionLines ? `${displayTitle}\n\n${optionLines}` : displayTitle,
                  },
                );
                if (result.behavior === "allow") {
                  await replyQuestion(buildDefaultAnswers(questions));
                } else {
                  await rejectQuestion();
                }
              } catch {
                // canUseTool threw (e.g. signal aborted) → pick default so session isn't stuck
                await replyQuestion(buildDefaultAnswers(questions));
              }
            } else {
              // No interactive handler — auto-pick first option so the session
              // never hangs waiting for a reply that will never come.
              console.warn(
                `[OpenCode SDK] Question ${qId} auto-answered (no canUseTool handler). ` +
                `Set OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS=true to suppress this warning.`,
              );
              await replyQuestion(buildDefaultAnswers(questions));
            }
          }
        } else if (event.type === "message.updated") {
          const msg = props?.info || props?.message;
          if (msg?.error) {
            yield {
              type: "error",
              message: msg.error.message || msg.error.name || "OpenCode message error",
            };
            break;
          }
        } else if (event.type === "session.status") {
          const status = props?.status;
          if (status?.type === "error" || status?.type === "failed") {
            yield {
              type: "error",
              message: status?.message || "OpenCode session failed",
            };
            break;
          }
        } else if ((event.type === "session.error" || event.type === "error") && (props?.sessionID === sessionId || evtSessionId === sessionId || !props?.sessionID)) {
          const err = props?.error?.data?.message || props?.error?.message || props?.error?.name || props?.message || (event as any).error || "OpenCode session error";
          yield {
            type: "error",
            message: typeof err === "string" ? err : JSON.stringify(err),
          };
          break;
        } else if (event.type === "session.idle" && (props?.sessionID === sessionId || evtSessionId === sessionId)) {
          // Completed this turn
          break;
        }
      }

      this.totalApiDurationMs += Math.max(0, Date.now() - turnStart);

      yield {
        type: "usage",
        usage: { ...this.accumulatedUsage },
      };
    }
  }
}
