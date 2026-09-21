import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { GOLD } from "../../src/tui/theme.ts";

function ChatInputBox({ lines, scrollY, activePrompt }: { lines: number; scrollY: number; activePrompt?: string }) {
  const visibleLines = Math.min(10, Math.max(1, lines));
  const linesAbove = Math.max(0, scrollY);
  const linesBelow = Math.max(0, lines - (scrollY + visibleLines));

  const topTitle = activePrompt
    ? linesAbove > 0
      ? `${activePrompt}  +${linesAbove}line`
      : activePrompt
    : linesAbove > 0
      ? `+${linesAbove}line`
      : undefined;

  const topTitleAlignment: "left" | "right" = activePrompt && linesAbove === 0 ? "left" : "right";
  const bottomTitle = linesBelow > 0 ? `+${linesBelow}line` : undefined;

  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: GOLD,
        height: visibleLines + 2,
        flexShrink: 0,
        flexDirection: "row",
        paddingX: 1,
      }}
      title={topTitle}
      titleAlignment={topTitleAlignment}
      titleColor={GOLD}
      bottomTitle={bottomTitle}
      bottomTitleAlignment="right"
    >
      <box style={{ flexDirection: "row", alignSelf: "flex-start" }}>
        <text content="❯ " style={{ fg: "#38bdf8" }} />
      </box>
      <text content={`Content with ${lines} lines`} style={{ flexGrow: 1 }} />
    </box>
  );
}

describe("ChatInputBox dimensions and overflow titles", () => {
  test("single-line text renders with height 3 and no overflow titles", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 15 });
    const root = createRoot(testRenderer.renderer);

    root.render(<ChatInputBox lines={1} scrollY={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("❯ Content with 1 lines");
    expect(output).not.toContain("+");
  });

  test("multi-line text under 10 lines expands height without overflow titles", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 15 });
    const root = createRoot(testRenderer.renderer);

    root.render(<ChatInputBox lines={5} scrollY={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).not.toContain("+");
  });

  test("18 lines of text clamped to 10 lines with cursor at bottom shows +8line at top", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 15 });
    const root = createRoot(testRenderer.renderer);

    // 18 lines total, visibleLines = 10, scrollY = 8 (lines 8..17 visible, 8 lines above)
    root.render(<ChatInputBox lines={18} scrollY={8} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("+8line");
  });

  test("18 lines of text clamped to 10 lines with cursor at top shows +8line at bottom", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 15 });
    const root = createRoot(testRenderer.renderer);

    // 18 lines total, visibleLines = 10, scrollY = 0 (lines 0..9 visible, 8 lines below)
    root.render(<ChatInputBox lines={18} scrollY={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("+8line");
  });

  test("18 lines with scrollY in middle shows +4line on top and +4line on bottom", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 15 });
    const root = createRoot(testRenderer.renderer);

    // 18 lines total, visibleLines = 10, scrollY = 4 (lines 4..13 visible, 4 above, 4 below)
    root.render(<ChatInputBox lines={18} scrollY={4} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("+4line");
  });
});
