import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

import { UsagePanel } from "../../src/tui/UsagePanel.tsx";

const MOCK_USAGE_DATA: SDKControlGetUsageResponse = {
  session: {
    total_cost_usd: 0.0425,
    total_api_duration_ms: 3200,
    total_duration_ms: 934000,
    total_lines_added: 42,
    total_lines_removed: 8,
    model_usage: {
      "claude-sonnet-5": {
        inputTokens: 1250,
        outputTokens: 480,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 200,
        contextWindow: 200000,
        costUSD: 0.0425,
      },
    },
  },
  subscription_type: "pro",
  rate_limits_available: true,
  rate_limits: {
    five_hour: {
      utilization: 75,
      resets_at: new Date(Date.now() + 3600000).toISOString(),
    },
    seven_day: {
      utilization: 21,
      resets_at: new Date(Date.now() + 86400000 * 5).toISOString(),
    },
  },
};

describe("UsagePanel", () => {
  test("renders full usage session metrics and rate limits", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 18 });
    const root = createRoot(testRenderer.renderer);

    root.render(<UsagePanel loading={false} error={null} data={MOCK_USAGE_DATA} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Session");
    expect(output).toContain("Esc to back");
    expect(output).toContain("Total cost: $0.0425");
    expect(output).toContain("Total duration (API): 3s · duration (wall): 15m 34s");
    expect(output).toContain("Total code changes: 42 lines added, 8 lines removed");
    expect(output).toContain("Usage: 1,250 input, 480 output, 5,000 cache read, 200 cache write");
    expect(output).toContain("Current session");
    expect(output).toContain("75% used");
    expect(output).toContain("Current week (all models)");
    expect(output).toContain("21% used");
  });

  test("renders loading state", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<UsagePanel loading={true} error={null} data={null} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Loading usage...");
    expect(output).toContain("Esc to back");
  });

  test("renders error state", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<UsagePanel loading={false} error="API unavailable" data={null} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Could not load usage: API unavailable");
    expect(output).toContain("Esc to back");
  });
});
