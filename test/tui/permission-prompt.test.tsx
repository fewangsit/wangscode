import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";

import { PermissionPrompt, permissionOptionsFor } from "../../src/tui/PermissionPrompt.tsx";

describe("PermissionPrompt", () => {
  test("renders title row matching UsagePanel and ModelPicker with options", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    const options = permissionOptionsFor(true);
    root.render(<PermissionPrompt label="Run bash command: bun test" mcpServerName="system" options={options} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Permission requested");
    expect(output).toContain("Esc to deny");
    expect(output).toContain("MCP server: system");
    expect(output).toContain("Run bash command: bun test");
    expect(output).toContain("Allow once");
    expect(output).toContain("Always allow this session");
    expect(output).toContain("Deny");
    expect(output).toContain("This session only — ↑/↓ to choose · Enter to confirm · Esc to deny");
  });

  test("highlights the selected option row with gold background", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    const options = permissionOptionsFor(false);
    root.render(<PermissionPrompt label="Edit file: src/index.ts" mcpServerName={null} options={options} selectedIndex={1} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const spans = testRenderer.captureSpans();
    const hasGoldBg = spans.lines.some((line) =>
      line?.spans.some((span) => span.bg.buffer[0] === 224 && span.bg.buffer[1] === 175 && span.bg.buffer[2] === 104),
    );
    expect(hasGoldBg).toBe(true);
  });
});
