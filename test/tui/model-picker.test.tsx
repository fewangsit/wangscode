import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import type { ModelInfo } from "../../src/engine/index.ts";

import { ModelPicker } from "../../src/tui/ModelPicker.tsx";

const MOCK_MODELS: ModelInfo[] = [
  {
    value: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    description: "Default fast model",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "claude-opus-4",
    displayName: "Claude Opus 4",
    description: "High capability model",
    supportsEffort: true,
    supportedEffortLevels: ["medium", "high", "max"],
  },
];

describe("ModelPicker", () => {
  test("renders title row matching UsagePanel and model list", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    root.render(<ModelPicker models={MOCK_MODELS} selectedIndex={0} loading={false} currentModel="claude-sonnet-5" effort="high" />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Select model");
    expect(output).toContain("Esc to cancel");
    expect(output).toContain("Claude Sonnet 5");
    expect(output).toContain("Claude Opus 4");
    expect(output).toContain("High effort");
  });

  test("renders loading state", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<ModelPicker models={[]} selectedIndex={0} loading={true} currentModel={null} effort="high" />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Select model");
    expect(output).toContain("Loading models...");
    expect(output).toContain("Esc to cancel");
  });
});
