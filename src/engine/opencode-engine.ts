import type { AgentEngine, EngineRunOptions } from "./types.ts";
import { OpenCodeEngineStub } from "./opencode-stub.ts";
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

export function tool(
  name: string,
  description: string,
  schema: any,
  handler: (args: any) => Promise<any>,
): any;
export function tool(def: any): any;
export function tool(...args: any[]): any {
  if (typeof args[0] === "string") {
    return { name: args[0], description: args[1], schema: args[2], handler: args[3] };
  }
  return args[0];
}

export async function renameSession(
  _sessionId: string,
  _newTitle: string,
  _opts?: { dir?: string; sessionStore?: SessionStore },
): Promise<void> {
  // OpenCode rename
}

export async function getSessionMessages(_sessionId: string, _opts?: any): Promise<SessionMessage[]> {
  return [];
}

/**
 * OpenCode implementation of `query()`.
 */
export function query(params: { prompt: any; options?: Options }): Query {
  const engine = new OpenCodeEngineStub();
  return createOpenCodeSession(engine, params.prompt, {
    cwd: params.options?.cwd ?? process.cwd(),
    model: params.options?.model ?? "claude-3-7-sonnet",
    effort: params.options?.thinking?.effort ?? "high",
    resumeSessionId: params.options?.resume,
  });
}

/**
 * OpenCode implementation of `listSessions()`.
 */
export async function listSessions(opts?: { dir?: string; sessionStore?: SessionStore }): Promise<any[]> {
  const engine = new OpenCodeEngineStub();
  return shimListSessions(engine, opts?.dir ?? process.cwd());
}

/**
 * Creates an OpenCode session matching the TUI Query protocol.
 */
export function createOpenCodeSession(
  engine: AgentEngine,
  promptInput: AsyncIterable<any> | string,
  options: EngineRunOptions,
): Query {
  let activeModel = options.model ?? "claude-3-7-sonnet";
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
      return [
        { name: "/create-feature", description: "Build a Wangs Foundation feature end-to-end via gated pipeline" },
      ];
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
      return [
        {
          name: "opencode-tools",
          status: "connected",
          tools: [
            {
              name: "file_edit",
              description: "Edit files on disk via OpenCode",
            },
            {
              name: "bash",
              description: "Execute terminal commands",
            },
          ],
        },
      ];
    },

    async toggleMcpServer(_name: string, _enabled: boolean): Promise<any> {
      return { success: true };
    },

    async reconnectMcpServer(_name: string): Promise<void> {
      // Reconnect OpenCode tool
    },

    async interrupt(): Promise<any> {
      await engine.interrupt();
      return undefined;
    },

    async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(
      _opts?: { skipBehaviors?: boolean },
    ): Promise<SDKControlGetUsageResponse> {
      const usage = await engine.getUsage();

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
          total_api_duration_ms: 1200,
          total_duration_ms: 45000,
          total_lines_added: 0,
          total_lines_removed: 0,
          model_usage: modelUsageRecord,
        },
        subscription_type: "opencode-pro",
        rate_limits_available: true,
        rate_limits: {
          five_hour: {
            utilization: 10,
            resets_at: new Date(Date.now() + 3600000 * 4).toISOString(),
          },
          seven_day: {
            utilization: 5,
            resets_at: new Date(Date.now() + 86400000 * 6).toISOString(),
          },
        },
        behaviors: {
          day: {
            request_count: 1,
            session_count: 1,
            behaviors: {},
          },
        },
      };
    },
  };

  // Implement AsyncIterable<SDKMessage>
  const asyncIterable = {
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void, unknown> {
      const sessionId = options.resumeSessionId ?? `opencode-session-${Date.now()}`;

      // Emit system/init message so SessionStatusStore knows the session is ready
      yield ({
        type: "system",
        subtype: "init",
        session_id: sessionId,
        model: activeModel,
        cwd: options.cwd,
        effort: activeEffort,
        permissionMode: "default",
        apiKeySource: "opencode",
        claudeCodeVersion: "opencode-1.0.0",
        uuid: "init-uuid" as any,
      } as unknown as SDKMessage);

      // Stream chunks from the OpenCode engine
      const stream = engine.streamPrompt(promptInput, {
        ...options,
        model: activeModel,
        effort: activeEffort,
      });

      let contentIndex = 0;
      let fullResultText = "";

      for await (const chunk of stream) {
        if (chunk.type === "thinking_delta") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: contentIndex,
              content_block: { type: "thinking", thinking: "" },
            },
          } as SDKMessage;

          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: contentIndex,
              delta: { type: "thinking_delta", thinking: chunk.thinking },
            },
          } as SDKMessage;

          yield {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: contentIndex,
            },
          } as SDKMessage;
          contentIndex++;
        } else if (chunk.type === "text_delta") {
          fullResultText += chunk.text;
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: contentIndex,
              delta: { type: "text_delta", text: chunk.text },
            },
          } as SDKMessage;
        } else if (chunk.type === "tool_call_start") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: contentIndex,
              content_block: { type: "tool_use", id: chunk.id, name: chunk.name, input: {} },
            },
          } as SDKMessage;
        } else if (chunk.type === "tool_call_delta") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: contentIndex,
              delta: { type: "input_json_delta", partial_json: chunk.partialJson },
            },
          } as SDKMessage;
        } else if (chunk.type === "tool_call_end") {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: contentIndex,
            },
          } as SDKMessage;
          contentIndex++;
        }
      }

      const usage = await engine.getUsage();

      // Final assistant message completion
      yield {
        type: "assistant",
        message: {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: fullResultText }],
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

      // Result message for pipeline runners
      yield ({
        type: "result",
        subtype: "success",
        is_error: false,
        result: fullResultText,
        structured_output: undefined,
        total_cost_usd: usage.costUSD,
        session_id: sessionId,
        duration_ms: 1000,
        duration_api_ms: 800,
        num_turns: 1,
        uuid: `res-${Date.now()}` as any,
        usage: {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        },
      } as unknown as SDKMessage);
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
