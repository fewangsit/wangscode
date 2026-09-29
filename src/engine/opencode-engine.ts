import type { AgentEngine, EngineRunOptions } from "./types.ts";
import { OpenCodeSdkEngine, getOpencodeClient } from "./opencode-sdk-engine.ts";
import type { SessionInfo } from "../tui/SessionPicker.tsx";

// ============================================================================
// OPENCODE CORE TYPES & PROTOCOLS
// ============================================================================

export type EffortLevel = "low" | "medium" | "high" | "max" | "xhigh";

export interface ModelInfo {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: EffortLevel[];
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
  canonicalModel?: string;
  provider?: string;
  [key: string]: any;
}

export interface SDKControlGetUsageResponse {
  session: {
    total_cost_usd: number;
    total_api_duration_ms: number;
    total_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
    model_usage: Record<string, ModelUsage>;
  };
  subscription_type: string | null;
  rate_limits_available: boolean;
  rate_limits: {
    five_hour?: {
      utilization: number | null;
      resets_at: string | null;
    } | null;
    seven_day?: {
      utilization: number | null;
      resets_at: string | null;
    } | null;
  } | null;
  behaviors?: {
    day: {
      request_count: number;
      session_count: number;
      behaviors: Record<string, unknown>;
    };
  };
}

export interface McpServerStatus {
  name: string;
  status: "connected" | "failed" | "pending" | "disabled" | "needs-auth";
  config?: any;
  scope?: string;
  serverInfo?: { name: string; version?: string; [key: string]: any };
  error?: string;
  tools?: any[];
  [key: string]: any;
}

export type McpServerConfig =
  | { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "sse"; url: string; headers?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> }
  | Record<string, unknown>;

export interface SessionKey {
  projectKey: string;
  sessionId: string;
  subpath?: string;
  [key: string]: any;
}

export type SessionStoreEntry = Record<string, any>;

export interface SessionStore {
  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
  load(key: SessionKey): Promise<SessionStoreEntry[] | null>;
  delete?(key: SessionKey): Promise<void>;
  listSessions?(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>>;
  listSubkeys?(key: { projectKey: string; sessionId: string }): Promise<string[]>;
  [key: string]: any;
}

export type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; [key: string]: any }
  | { behavior: "deny"; message?: string; interrupt?: boolean; [key: string]: any };

export interface PermissionUpdate {
  type: string;
  [key: string]: any;
}

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: {
    signal: AbortSignal;
    title?: string;
    suggestions?: PermissionUpdate[];
    mcpServer?: { name: string; source?: string };
    [key: string]: any;
  },
) => Promise<PermissionResult>;

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  model?: string;
}

export interface SDKUserMessage {
  type: "user";
  message: { role: "user"; content: string | any[] };
  parent_tool_use_id?: string | null;
  parent_agent_id?: string | null;
  session_id?: string;
  uuid?: string;
  [key: string]: any;
}

export interface SDKSystemMessage {
  type: "system";
  subtype?: string;
  session_id: string;
  model: string;
  cwd: string;
  permissionMode: string;
  effort?: EffortLevel | null;
  [key: string]: any;
}

export type SDKMessage =
  | SDKUserMessage
  | SDKSystemMessage
  | {
      type: "stream_event";
      event: any;
      session_id?: string;
      [key: string]: any;
    }
  | {
      type: "assistant";
      message: {
        id?: string;
        role: "assistant";
        content: Array<{ type: string; text?: string; [key: string]: any }>;
        model?: string;
        stop_reason?: string | null;
        stop_sequence?: string | null;
        usage?: Record<string, number>;
        [key: string]: any;
      };
      parent_tool_use_id?: string | null;
      parent_agent_id?: string | null;
      session_id?: string;
      uuid?: string;
      [key: string]: any;
    }
  | {
      type: "result";
      subtype: "success" | "error";
      is_error: boolean;
      result: string;
      structured_output?: unknown;
      total_cost_usd: number;
      session_id?: string;
      modelUsage?: Record<string, ModelUsage>;
      duration_ms?: number;
      duration_api_ms?: number;
      num_turns?: number;
      [key: string]: any;
    };

export type SessionMessage = SDKMessage;

export interface Options {
  cwd?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: any;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  sessionStore?: SessionStore;
  resume?: string;
  canUseTool?: CanUseTool;
  agents?: Record<string, AgentDefinition>;
  mcpServers?: Record<string, McpServerConfig>;
  plugins?: Array<{ type?: string; path: string; [key: string]: any }>;
  thinking?: any;
  includePartialMessages?: boolean;
  outputFormat?: any;
  tools?: any;
  [key: string]: any;
}

export interface Query extends AsyncIterable<SDKMessage> {
  supportedModels(): Promise<ModelInfo[]>;
  supportedCommands(): Promise<Array<{ name: string; description: string }>>;
  setModel(model: string): Promise<void>;
  applyFlagSettings(flags: { effortLevel?: EffortLevel }): Promise<void>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  toggleMcpServer(name: string, enabled: boolean): Promise<any>;
  reconnectMcpServer(name: string): Promise<void>;
  interrupt(): Promise<any>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(opts?: { skipBehaviors?: boolean }): Promise<SDKControlGetUsageResponse>;
}

// ============================================================================
// OPENCODE RUNTIME ENGINE METHODS
// ============================================================================

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n--- OPENCODE DYNAMIC BOUNDARY ---\n";

export function createSdkMcpServer(config: any): any {
  return config;
}

export function tool(name: string, description: string, schema: any, handler: (args: any) => Promise<any>): any;
export function tool(def: any): any;
export function tool(...args: any[]): any {
  if (typeof args[0] === "string") {
    return { name: args[0], description: args[1], schema: args[2], handler: args[3] };
  }
  return args[0];
}

export async function renameSession(sessionId: string, newTitle: string, opts?: { dir?: string; sessionStore?: SessionStore }): Promise<void> {
  try {
    const client = await getOpencodeClient({ directory: opts?.dir });
    await client.session.update({
      path: { id: sessionId },
      body: { title: newTitle },
      query: { directory: opts?.dir },
    });
  } catch {
    // fallback / ignore
  }
}

export async function getSessionMessages(sessionId: string, opts?: any): Promise<SessionMessage[]> {
  try {
    const client = await getOpencodeClient({ directory: opts?.dir });
    const res = await client.session.messages({ path: { id: sessionId }, query: { directory: opts?.dir } });
    const messages: SessionMessage[] = [];
    for (const msg of res.data ?? []) {
      const parts = msg.parts ?? [];
      const timestamp = msg.info?.time?.created ? new Date(msg.info.time.created).toISOString() : new Date().toISOString();
      if (msg.info?.role === "user") {
        const textParts = parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n");
        messages.push({
          type: "user",
          message: { role: "user", content: textParts },
          session_id: sessionId,
          timestamp,
        } as SessionMessage);
      } else if (msg.info?.role === "assistant") {
        const content: any[] = [];
        for (const p of parts) {
          if (p.type === "reasoning") {
            content.push({ type: "thinking", thinking: p.text });
          } else if (p.type === "text") {
            content.push({ type: "text", text: p.text });
          } else if (p.type === "tool") {
            content.push({
              type: "tool_use",
              id: (p as any).callID || p.id,
              name: (p as any).tool,
              input: (p as any).state?.input ?? {},
            });
          }
        }
        messages.push({
          type: "assistant",
          message: {
            role: "assistant",
            content,
            model: msg.info.modelID,
          },
          session_id: sessionId,
          timestamp,
        } as SessionMessage);
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/**
 * OpenCode implementation of `query()`.
 */
export function query(params: { prompt: any; options?: Options }): Query {
  const engine = new OpenCodeSdkEngine({ cwd: params.options?.cwd });

  return createOpenCodeSession(engine, params.prompt, {
    cwd: params.options?.cwd ?? process.cwd(),
    model: params.options?.model ?? "opencode-go/qwen3.8-flash",
    effort: params.options?.thinking?.effort ?? "high",
    resumeSessionId: params.options?.resume,
    canUseTool: params.options?.canUseTool,
    systemPrompt:
      typeof params.options?.systemPrompt === "object" && params.options?.systemPrompt?.append
        ? params.options.systemPrompt.append
        : params.options?.systemPrompt,
    mcpServers: params.options?.mcpServers,
    outputFormat: params.options?.outputFormat,
  });
}

/**
 * OpenCode implementation of `listSessions()`.
 */
export async function listSessions(opts?: { dir?: string; sessionStore?: SessionStore }): Promise<any[]> {
  const engine = new OpenCodeSdkEngine({ cwd: opts?.dir });

  try {
    const client = await getOpencodeClient({ directory: opts?.dir });
    const res = await client.session.list({ query: { directory: opts?.dir } });
    if (res.data && res.data.length > 0) {
      return res.data.map((s) => ({
        sessionId: s.id,
        summary: s.title ?? `OpenCode Session (${s.id.slice(0, 8)})`,
        firstPrompt: s.title,
        lastModified: s.time?.updated ?? s.time?.created ?? Date.now(),
      }));
    }
  } catch {
    // Fallback if client is unreachable
  }

  return shimListSessions(engine, opts?.dir ?? process.cwd());
}

/**
 * Tries to extract a JSON value from arbitrary model text.
 * Handles: bare JSON, ```json ... ``` fences, and ``` ... ``` fences.
 */
function extractJsonFromText(text: string): unknown | undefined {
  if (!text) return undefined;

  // Try stripping markdown code fences first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Find the first '{' or '[' and try from there
  const start = candidate.search(/[{[]/);
  if (start === -1) return undefined;

  try {
    return JSON.parse(candidate.slice(start));
  } catch {
    // Try the whole candidate
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}

/**
 * Creates an OpenCode session matching the TUI Query protocol.
 */
export function createOpenCodeSession(engine: AgentEngine, promptInput: AsyncIterable<any> | string, options: EngineRunOptions): Query {
  let activeModel = options.model ?? "opencode-go/qwen3.8-flash";
  let activeEffort: EffortLevel = options.effort ?? "high";

  const sessionObj: Partial<Query> = {
    async supportedModels(): Promise<ModelInfo[]> {
      const models = await engine.listModels();
      return models.map((m) => ({
        value: m.id,
        resolvedModel: m.id,
        displayName: m.displayName,
        description: `${m.name} (${m.provider})`,
        supportsEffort: m.supportsEffort ?? false,
        supportedEffortLevels: m.supportedEffortLevels as EffortLevel[] | undefined,
      }));
    },

    async supportedCommands(): Promise<Array<{ name: string; description: string }>> {
      return [{ name: "/create-feature", description: "Build a Wangs Foundation feature end-to-end via gated pipeline" }];
    },

    async setModel(model: string): Promise<void> {
      activeModel = model;
      if ("setModel" in engine && typeof (engine as any).setModel === "function") {
        await (engine as any).setModel(model);
      }
    },

    async applyFlagSettings(flags: { effortLevel?: EffortLevel }): Promise<void> {
      if (flags.effortLevel) {
        activeEffort = flags.effortLevel;
      }
    },

    async mcpServerStatus(): Promise<McpServerStatus[]> {
      if ("getMcpStatus" in engine && typeof (engine as any).getMcpStatus === "function") {
        try {
          const list = await (engine as any).getMcpStatus();
          if (Array.isArray(list)) return list;
        } catch {
          // fallback
        }
      }
      return [];
    },

    async toggleMcpServer(name: string, enabled: boolean): Promise<any> {
      if ("toggleMcp" in engine && typeof (engine as any).toggleMcp === "function") {
        return (engine as any).toggleMcp(name, enabled);
      }
      return { success: true };
    },

    async reconnectMcpServer(name: string): Promise<void> {
      try {
        const client = await getOpencodeClient({ directory: options.cwd });
        await client.mcp.connect({ path: { name }, query: { directory: options.cwd } });
      } catch {
        // Ignore reconnect error
      }
    },

    async interrupt(): Promise<any> {
      await engine.interrupt();
      return undefined;
    },

    async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(_opts?: { skipBehaviors?: boolean }): Promise<SDKControlGetUsageResponse> {
      const usage = await engine.getUsage();
      const timing =
        "getTimingStats" in engine && typeof (engine as any).getTimingStats === "function"
          ? (engine as any).getTimingStats()
          : { apiDurationMs: 0, wallDurationMs: 0 };

      const modelUsageRecord: Record<string, ModelUsage> = {
        [activeModel]: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          thinkingTokens: usage.thinkingTokens ?? 0,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          webSearchRequests: usage.webSearchRequests,
          costUSD: usage.costUSD,
          contextWindow: usage.contextWindow,
          maxOutputTokens: usage.maxOutputTokens,
        },
      };

      return {
        session: {
          total_cost_usd: usage.costUSD,
          total_api_duration_ms: timing.apiDurationMs,
          total_duration_ms: timing.wallDurationMs,
          total_lines_added: 0,
          total_lines_removed: 0,
          model_usage: modelUsageRecord,
        },
        subscription_type: null,
        rate_limits_available: false,
        rate_limits: null,
        behaviors: {
          day: {
            request_count: 0,
            session_count: 0,
            behaviors: {},
          },
        },
      };
    },
  };

  // Implement AsyncIterable<SDKMessage>
  const asyncIterable = {
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void, unknown> {
      let sessionId = options.resumeSessionId;
      if (!sessionId && "initSession" in engine && typeof (engine as any).initSession === "function") {
        try {
          sessionId = await (engine as any).initSession(options);
        } catch {
          // fallback
        }
      }
      sessionId = sessionId ?? (engine as any).activeSessionId ?? `opencode-session-${Date.now()}`;

      // Emit system/init message so SessionStatusStore knows the session is ready
      yield {
        type: "system",
        subtype: "init",
        session_id: sessionId,
        model: activeModel,
        cwd: options.cwd,
        effort: activeEffort,
        permissionMode: options.permissionMode ?? "default",
        apiKeySource: "opencode",
        claudeCodeVersion: "opencode-1.18.32",
        uuid: "init-uuid" as any,
      } as unknown as SDKMessage;

      // Stream chunks from the OpenCode engine
      const stream = engine.streamPrompt(promptInput, {
        ...options,
        model: activeModel,
        effort: activeEffort,
      });

      let contentIndex = 0;
      let fullResultText = "";
      // Tracks the most recent complete text snapshot from message.part.updated.
      // When present, this is preferred over accumulated text_deltas for
      // structured output extraction because it is guaranteed to be the
      // canonical final text that the model produced.
      let lastTextSnapshot = "";

      for await (const chunk of stream) {
        if (chunk.type === "thinking_delta") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: contentIndex,
              content_block: { type: "thinking", thinking: "" },
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;

          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: contentIndex,
              delta: { type: "thinking_delta", thinking: chunk.thinking },
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;

          yield {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: contentIndex,
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;
          contentIndex++;
        } else if (chunk.type === "text_snapshot") {
          // Complete text of a finished text part — store as the canonical snapshot.
          // Do NOT yield a stream_event here (the deltas already streamed the
          // content live); this is only for structured output extraction later.
          lastTextSnapshot = chunk.text;
        } else if (chunk.type === "text_delta") {
          fullResultText += chunk.text;
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: contentIndex,
              delta: { type: "text_delta", text: chunk.text },
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;
        } else if (chunk.type === "tool_call_start") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: contentIndex,
              content_block: { type: "tool_use", id: chunk.id, name: chunk.name, input: {} },
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;
        } else if (chunk.type === "tool_call_delta") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: contentIndex,
              delta: { type: "input_json_delta", partial_json: chunk.partialJson },
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;
        } else if (chunk.type === "tool_call_end") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: contentIndex,
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId,
          } as SDKMessage;
          contentIndex++;
        } else if (chunk.type === "tool_result") {
          yield {
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: chunk.id,
                  content: chunk.content,
                  is_error: chunk.isError,
                },
              ],
            },
            parent_tool_use_id: chunk.parentToolUseId,
            session_id: chunk.childSessionId ?? sessionId,
          } as SDKMessage;
        } else if (chunk.type === "error") {
          fullResultText += `\n[OpenCode Error] ${chunk.message}`;
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: `\n[OpenCode Error] ${chunk.message}\n` },
            },
            session_id: sessionId,
            uuid: `uuid-${Date.now()}` as any,
          } as SDKMessage;
        }
      }

      const usage = await engine.getUsage();

      // Final assistant message completion
      yield {
        type: "assistant",
        message: {
          id: `msg-${Date.now()}`,
          role: "assistant",
          // Prefer the canonical snapshot text (from message.part.updated) over
          // accumulated deltas. If neither exists, fall back to empty string.
          content: [{ type: "text", text: lastTextSnapshot || fullResultText }],
          model: activeModel,
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
          },
        },
        session_id: sessionId,
        uuid: `uuid-${Date.now()}` as any,
      } as SDKMessage;

      const timing =
        "getTimingStats" in engine && typeof (engine as any).getTimingStats === "function"
          ? (engine as any).getTimingStats()
          : { apiDurationMs: 0, wallDurationMs: 0 };

      // Result message for pipeline runners
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: fullResultText,
        // Extract structured JSON from the model's text response when the
        // caller requested a json_schema output format.  OpenCode's API does
        // not have a native outputFormat field, so the schema instruction is
        // injected into the system prompt (see opencode-sdk-engine.ts) and
        // the model embeds its JSON answer in the response text.
        // Prefer lastTextSnapshot (canonical final text from message.part.updated)
        // over accumulated text_deltas — the snapshot is guaranteed to be the
        // complete final text even when the model sends one big update instead
        // of incremental delta events.
        structured_output: options.outputFormat
          ? extractJsonFromText(lastTextSnapshot || fullResultText)
          : undefined,
        total_cost_usd: usage.costUSD,
        session_id: sessionId,
        duration_ms: timing.wallDurationMs,
        duration_api_ms: timing.apiDurationMs,
        num_turns: 1,
        uuid: `res-${Date.now()}` as any,
        usage: {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        },
      } as unknown as SDKMessage;
    },
  };

  return Object.assign(sessionObj, asyncIterable) as unknown as Query;
}

export const createOpenCodeQueryShim = createOpenCodeSession;

/**
 * OpenCode session lister.
 */
export async function shimListSessions(engine: AgentEngine, cwd: string): Promise<SessionInfo[]> {
  const summaries = await engine.listSessions(cwd);
  return summaries.map((s) => ({
    sessionId: s.sessionId,
    summary: s.title ?? `OpenCode Session (${s.model})`,
    firstPrompt: s.title,
    lastModified: new Date(s.updatedAt).getTime(),
  }));
}
