import { describe, expect, test } from "bun:test";
import { DEFAULT_OPENCODE_MODELS, OpenCodeEngineStub } from "../src/engine/opencode-stub.ts";
import { createOpenCodeSession } from "../src/engine/index.ts";

describe("OpenCode Engine & Shim Layer", () => {
  test("OpenCodeEngineStub lists available models", async () => {
    const engine = new OpenCodeEngineStub();
    const models = await engine.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.map((m) => m.id)).toContain("claude-3-7-sonnet");
    expect(models.map((m) => m.id)).toContain("deepseek-r1");
  });

  test("OpenCodeEngineStub streams prompt with thinking and usage", async () => {
    const engine = new OpenCodeEngineStub();
    const chunks = [];
    for await (const chunk of engine.streamPrompt("Buatkan kalkulator sederhana", {
      model: "claude-3-7-sonnet",
      cwd: "/test",
    })) {
      chunks.push(chunk);
    }

    const hasThinking = chunks.some((c) => c.type === "thinking_delta");
    const hasText = chunks.some((c) => c.type === "text_delta");
    const hasUsage = chunks.some((c) => c.type === "usage");

    expect(hasThinking).toBe(true);
    expect(hasText).toBe(true);
    expect(hasUsage).toBe(true);
  });

  test("createOpenCodeSession conforms to Query interface expected by TUI", async () => {
    const engine = new OpenCodeEngineStub();
    const queryShim = createOpenCodeSession(engine, "halo", {
      cwd: "/repo",
      model: "claude-3-7-sonnet",
    });

    const models = await queryShim.supportedModels();
    expect(models.length).toBe(DEFAULT_OPENCODE_MODELS.length);
    expect(models[0]?.displayName).toBe("Claude 3.7 Sonnet");

    const mcpServers = await queryShim.mcpServerStatus();
    expect(Array.isArray(mcpServers)).toBe(true);
    expect(mcpServers[0]?.name).toBe("opencode-tools");

    const usage = await queryShim.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    expect(usage.subscription_type).toBe("opencode-pro");
    expect(usage.session.model_usage["claude-3-7-sonnet"]).toBeDefined();
    expect(usage.rate_limits?.five_hour).toBeDefined();

    // Test async iterator emitting SDKMessages
    const messages = [];
    for await (const msg of queryShim) {
      messages.push(msg);
    }

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.type).toBe("system");
    expect((messages[0] as any).subtype).toBe("init");
  });

  test("runAgentTurn executes successfully with OpenCode engine", async () => {
    const prevEngine = process.env.WANGS_CODE_ENGINE;
    try {
      process.env.WANGS_CODE_ENGINE = "opencode";
      const { runAgentTurn } = await import("../src/pipeline/agent-runner.ts");
      const streamedMessages: any[] = [];

      const result = await runAgentTurn({
        repoRoot: "/test-repo",
        prompt: "Check requirements gap",
        allowedTools: ["GlobTool"],
        onMessage: (m) => streamedMessages.push(m),
      });

      expect(result.ok).toBe(true);
      expect(result.resultText).toContain("[OpenCode Engine Response]");
      expect(streamedMessages.length).toBeGreaterThan(0);
    } finally {
      process.env.WANGS_CODE_ENGINE = prevEngine;
    }
  });
});

