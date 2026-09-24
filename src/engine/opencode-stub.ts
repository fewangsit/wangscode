import type { AgentEngine, EngineModel, EngineRunOptions, EngineSessionSummary, EngineStreamChunk, EngineUsage } from "./types.ts";

/**
 * Default OpenCode models available out-of-the-box.
 * Compatible with multi-provider setups (Anthropic, OpenAI, DeepSeek, Local Ollama).
 */
export const DEFAULT_OPENCODE_MODELS: EngineModel[] = [
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet (Hybrid)",
    displayName: "Claude 3.7 Sonnet",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    supportsThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    displayName: "Claude 3.5 Sonnet",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsEffort: false,
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    displayName: "DeepSeek R1",
    provider: "deepseek",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsThinking: true,
    supportsEffort: false,
  },
  {
    id: "gpt-4o",
    name: "OpenAI GPT-4o",
    displayName: "GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsThinking: false,
    supportsEffort: false,
  },
];

export class OpenCodeEngineStub implements AgentEngine {
  readonly name = "opencode";
  private activeModel = "claude-3-7-sonnet";
  private interrupted = false;

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

  async listModels(): Promise<EngineModel[]> {
    return DEFAULT_OPENCODE_MODELS;
  }

  async listSessions(_cwd: string): Promise<EngineSessionSummary[]> {
    return [
      {
        sessionId: "opencode-session-1",
        title: "Session OpenCode Aktif",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 2,
        model: this.activeModel,
      },
    ];
  }

  async getUsage(): Promise<EngineUsage> {
    return { ...this.accumulatedUsage };
  }

  async setModel(modelId: string): Promise<void> {
    const found = DEFAULT_OPENCODE_MODELS.find((m) => m.id === modelId || m.name === modelId);
    if (found) {
      this.activeModel = found.id;
      this.accumulatedUsage.contextWindow = found.contextWindow;
      this.accumulatedUsage.maxOutputTokens = found.maxOutputTokens;
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  async *streamPrompt(
    prompt: AsyncIterable<any> | string,
    options: EngineRunOptions,
  ): AsyncIterable<EngineStreamChunk> {
    this.interrupted = false;
    if (options.model) {
      await this.setModel(options.model);
    }

    const promptStream = typeof prompt === "string" ? [prompt] : prompt;

    for await (const rawItem of promptStream) {
      if (this.interrupted) break;

      const userText =
        typeof rawItem === "string"
          ? rawItem
          : typeof (rawItem as any)?.message?.content === "string"
            ? (rawItem as any).message.content
            : String(rawItem ?? "");

      // Simulate Thinking Chunk (if model supports it)
      const currentModel = DEFAULT_OPENCODE_MODELS.find((m) => m.id === this.activeModel);
      if (currentModel?.supportsThinking) {
        yield { type: "thinking_delta", thinking: `[OpenCode thinking for: "${userText.slice(0, 30)}..."]\n` };
      }

      // Simulate Assistant Response
      const responseText = `[OpenCode Engine Response] Menerima instruksi: "${userText}". Model: ${this.activeModel}. Arsitektur shim aktif dan siap dieksekusi.`;
      const words = responseText.split(" ");
      for (const word of words) {
        if (this.interrupted) break;
        yield { type: "text_delta", text: word + " " };
      }

      // Accumulate usage metrics
      this.accumulatedUsage.inputTokens += Math.max(1, Math.floor(userText.length / 4));
      this.accumulatedUsage.outputTokens += Math.max(1, Math.floor(responseText.length / 4));
      this.accumulatedUsage.costUSD += 0.001;

      yield {
        type: "usage",
        usage: { ...this.accumulatedUsage },
      };
    }
  }
}
