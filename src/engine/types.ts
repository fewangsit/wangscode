/**
 * Neutral engine contracts for wangscode.
 * Decouples the interactive TUI and the gated pipeline from any specific AI provider or SDK.
 */

export interface EngineModel {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: Array<"low" | "medium" | "high" | "max" | "xhigh">;
}

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface EngineSessionSummary {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model: string;
}

export type EngineStreamChunk =
  | { type: "text_delta"; text: string; parentToolUseId?: string; childSessionId?: string }
  /**
   * Complete text of a finished text part (from message.part.updated).
   * The consumer should prefer this over accumulated text_deltas when
   * extracting structured output — it is always the canonical final text.
   */
  | { type: "text_snapshot"; text: string; parentToolUseId?: string; childSessionId?: string }
  | { type: "thinking_delta"; thinking: string; parentToolUseId?: string; childSessionId?: string }
  | { type: "tool_call_start"; id: string; name: string; parentToolUseId?: string; childSessionId?: string }
  | { type: "tool_call_delta"; id: string; partialJson: string; parentToolUseId?: string; childSessionId?: string }
  | { type: "tool_call_end"; id: string; parentToolUseId?: string; childSessionId?: string }
  | { type: "tool_result"; id: string; content: string; isError?: boolean; parentToolUseId?: string; childSessionId?: string }
  | { type: "usage"; usage: EngineUsage }
  | { type: "error"; message: string };

export interface EngineRunOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "max" | "xhigh";
  systemPrompt?: string | any;
  cwd: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  canUseTool?: any;
  mcpServers?: Record<string, any>;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  /**
   * When set, the engine must:
   * 1. Append the schema as a JSON instruction to the system/user prompt.
   * 2. Parse the model's final text response as JSON and return it as
   *    `structured_output` in the result message.
   */
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
}

export interface AgentEngine {
  readonly name: string;
  activeSessionId?: string;
  initSession?(options: EngineRunOptions): Promise<string>;
  streamPrompt(prompt: AsyncIterable<any> | string, options: EngineRunOptions): AsyncIterable<EngineStreamChunk>;
  listModels(): Promise<EngineModel[]>;
  listSessions(cwd: string): Promise<EngineSessionSummary[]>;
  getUsage(): Promise<EngineUsage>;
  interrupt(): Promise<void>;
}
