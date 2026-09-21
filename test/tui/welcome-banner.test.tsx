import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { WelcomeBanner } from "../../src/tui/WelcomeBanner.tsx";
import { SessionStatusStore } from "../../src/tui/session-status.ts";

describe("WelcomeBanner", () => {
  test("renders missing wangs-ui alert when repo has no @wangs-ui packages", async () => {
    const tempDir = path.join(os.tmpdir(), `welcome-banner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const sessionStatus = new SessionStatusStore();
    sessionStatus.seedKnownConfig({ model: "claude-sonnet-5", cwd: tempDir });

    const testRenderer = await createTestRenderer({ width: 100, height: 26 });
    const root = createRoot(testRenderer.renderer);

    try {
      root.render(
        <WelcomeBanner sessionStatus={sessionStatus} version="1.8.4" sessionStoreActive={false} cwd={tempDir} onCommandClick={() => undefined} />,
      );
      await new Promise((r) => setTimeout(r, 60));
      await testRenderer.renderOnce();

      const output = testRenderer.captureCharFrame();
      expect(output).toContain("v1.8.4");
      expect(output).toContain("Wangs UI: not detected");
      expect(output).toContain("Wangs UI Not Detected:");
      expect(output).toContain("No @wangs-ui/* packages found in this project.");
      expect(output).toContain("/mcp");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("renders wangs-ui version badge when @wangs-ui is installed in project", async () => {
    const tempDir = path.join(os.tmpdir(), `welcome-banner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const coreDir = path.join(tempDir, "node_modules", "@wangs-ui", "react-core");
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(path.join(coreDir, "package.json"), JSON.stringify({ version: "1.0.64" }), "utf8");

    const sessionStatus = new SessionStatusStore();
    sessionStatus.seedKnownConfig({ model: "claude-sonnet-5", cwd: tempDir });

    const testRenderer = await createTestRenderer({ width: 100, height: 26 });
    const root = createRoot(testRenderer.renderer);

    try {
      root.render(
        <WelcomeBanner sessionStatus={sessionStatus} version="1.8.4" sessionStoreActive={true} cwd={tempDir} onCommandClick={() => undefined} />,
      );
      await new Promise((r) => setTimeout(r, 60));
      await testRenderer.renderOnce();

      const output = testRenderer.captureCharFrame();
      expect(output).toContain("Wangs UI: v1.0.64");
      expect(output).not.toContain("Wangs UI Not Detected:");
      expect(output).toContain("/mcp");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
