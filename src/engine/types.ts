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
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; partialJson: string }
  | { type: "tool_call_end"; id: string }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "usage"; usage: EngineUsage }
  | { type: "error"; message: string };

export interface EngineRunOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "max" | "xhigh";
  systemPrompt?: string;
  cwd: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export interface AgentEngine {
  readonly name: string;
  streamPrompt(prompt: AsyncIterable<any> | string, options: EngineRunOptions): AsyncIterable<EngineStreamChunk>;
  listModels(): Promise<EngineModel[]>;
  listSessions(cwd: string): Promise<EngineSessionSummary[]>;
  getUsage(): Promise<EngineUsage>;
  interrupt(): Promise<void>;
}
