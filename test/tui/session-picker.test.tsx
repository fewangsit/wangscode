import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";

import { formatSessionDate, SessionPicker, type SessionInfo } from "../../src/tui/SessionPicker.tsx";

const MOCK_SESSIONS: SessionInfo[] = [
  {
    sessionId: "session-1",
    summary: "Fix navbar styling and links",
    lastModified: Date.now() - 1000 * 60 * 5,
  },
  {
    sessionId: "session-2",
    summary: "Implement auth token refresh flow",
    lastModified: Date.now() - 1000 * 60 * 60 * 24,
  },
];

describe("SessionPicker", () => {
  test("renders title row matching UsagePanel and ModelPicker with session list", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SessionPicker sessions={MOCK_SESSIONS} selectedIndex={0} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Resume session");
    expect(output).toContain("Esc to cancel");
    expect(output).toContain("Fix navbar styling and links");
    expect(output).toContain("Implement auth token refresh flow");
    expect(output).toContain("This project only — ↑/↓ to navigate · Enter to resume · Esc to cancel");
  });

  test("highlights the selected session row with gold background", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SessionPicker sessions={MOCK_SESSIONS} selectedIndex={1} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const spans = testRenderer.captureSpans();
    const hasGoldBg = spans.lines.some((line) =>
      line?.spans.some((span) => span.bg.buffer[0] === 224 && span.bg.buffer[1] === 175 && span.bg.buffer[2] === 104),
    );
    expect(hasGoldBg).toBe(true);
  });

  test("renders loading state", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SessionPicker sessions={[]} selectedIndex={0} loading={true} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Resume session");
    expect(output).toContain("Loading sessions...");
    expect(output).toContain("Esc to cancel");
  });

  test("renders empty state when no sessions found", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SessionPicker sessions={[]} selectedIndex={0} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("No previous sessions found for this project.");
  });

  test("formatSessionDate returns formatted string", () => {
    expect(formatSessionDate(0)).toBe("");
    const formatted = formatSessionDate(Date.now());
    expect(formatted).toContain("Today at");
  });
});
