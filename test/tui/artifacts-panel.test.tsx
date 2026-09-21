import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";

import { ArtifactsPanel, type ArtifactItem } from "../../src/tui/ArtifactsPanel.tsx";

describe("ArtifactsPanel", () => {
  test("renders empty state with default gallery link", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 16 });
    const root = createRoot(testRenderer.renderer);

    root.render(<ArtifactsPanel artifacts={[]} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Claude Code Artifacts");
    expect(output).toContain("Gallery");
    expect(output).toContain("https://claude.ai/code/artifacts");
    expect(output).toContain("No artifacts generated in this session yet");
    expect(output).toContain("Esc to back");
  });

  test("renders artifacts list with items", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 18 });
    const root = createRoot(testRenderer.renderer);

    const items: ArtifactItem[] = [
      { title: "Design Prototype", url: "https://claude.ai/code/artifact/proto-123" },
      { url: "https://claude.ai/code/artifact/chart-456" },
    ];

    root.render(<ArtifactsPanel artifacts={items} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Design Prototype");
    expect(output).toContain("https://claude.ai/code/artifact/proto-123");
    expect(output).toContain("https://claude.ai/code/artifact/chart-456");
    expect(output).toContain("Recent Artifacts in this Session");
    expect(output).toContain("Enter/o to open");
  });
});
