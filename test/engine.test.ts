import { describe, expect, test } from "bun:test";
import { DEFAULT_OPENCODE_MODELS, OpenCodeSdkEngine, createOpenCodeSession, getOpencodeGoApiKey } from "../src/engine/index.ts";

describe("OpenCode Engine & Shim Layer", () => {
  test("OpenCodeSdkEngine lists available models", async () => {
    const engine = new OpenCodeSdkEngine({ cwd: process.cwd() });
    const models = await engine.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.includes("claude-3.7-sonnet"))).toBe(true);
    expect(models.some((m) => m.id.includes("deepseek-r1"))).toBe(true);
  });

  test("createOpenCodeSession conforms to Query interface expected by TUI", async () => {
    const engine = new OpenCodeSdkEngine({ cwd: process.cwd() });
    const queryShim = createOpenCodeSession(engine, "halo", {
      cwd: "/repo",
      model: "claude-3-7-sonnet",
    });

    const models = await queryShim.supportedModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.displayName).toBeDefined();

    const mcpServers = await queryShim.mcpServerStatus();
    expect(Array.isArray(mcpServers)).toBe(true);

    const usage = await queryShim.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    expect(usage.session.model_usage["claude-3-7-sonnet"]).toBeDefined();
    expect(usage.session.total_duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("OpenCodeSdkEngine implements AgentEngine contract", async () => {
    const engine = new OpenCodeSdkEngine({ cwd: process.cwd() });
    expect(engine.name).toBe("opencode");
    expect(typeof engine.streamPrompt).toBe("function");
    expect(typeof engine.listModels).toBe("function");
    expect(typeof engine.listSessions).toBe("function");
    expect(typeof engine.getUsage).toBe("function");
    expect(typeof engine.interrupt).toBe("function");
  });

  test("createOpenCodeSession respects permissionMode in EngineRunOptions", async () => {
    const engine = new OpenCodeSdkEngine({ cwd: process.cwd() });
    const queryShim = createOpenCodeSession(engine, "test", {
      cwd: "/repo",
      permissionMode: "default",
    });

    const iterator = (queryShim as any)[Symbol.asyncIterator]();
    const firstMsg = await iterator.next();
    expect(firstMsg.value?.type).toBe("system");
    expect(firstMsg.value?.subtype).toBe("init");
    expect(firstMsg.value?.permissionMode).toBe("default");
  });

  test("getOpencodeGoApiKey resolves key from auth.json", () => {
    const key = getOpencodeGoApiKey(process.cwd());
    expect(key).toBeDefined();
    expect(typeof key).toBe("string");
    expect(key?.startsWith("sk-")).toBe(true);
  });
});
