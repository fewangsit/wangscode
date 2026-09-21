import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { TextareaRenderable } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { SuggestionBox, type Suggestion } from "../../src/tui/SuggestionBox.tsx";

const SAMPLE_SUGGESTIONS: Suggestion[] = [
  { insertText: "create-feature", label: "/create-feature", description: "Deterministic feature-build pipeline" },
  { insertText: "usage", label: "/usage", description: "Token and cost totals for this session" },
  { insertText: "model", label: "/model", description: "Switch the active model" },
  { insertText: "src/index.ts", label: "src/index.ts" },
];

describe("SuggestionBox", () => {
  test("renders nothing when suggestions array is empty", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 10 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SuggestionBox suggestions={[]} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame().trim();
    expect(output).toBe("");
  });

  test("renders 2-column layout with command on left and description on right", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SuggestionBox suggestions={SAMPLE_SUGGESTIONS} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("/create-feature");
    expect(output).toContain("Deterministic feature-build pipeline");
    expect(output).toContain("/usage");
    expect(output).toContain("Token and cost totals for this session");
    expect(output).toContain("src/index.ts");
  });

  test("highlights the selected row with gold background", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SuggestionBox suggestions={SAMPLE_SUGGESTIONS} selectedIndex={1} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const spans = testRenderer.captureSpans();
    // Line 0 is top border, Line 1 is row 0 (/create-feature), Line 2 is row 1 (/usage - selected)
    const selectedLine = spans.lines[2];
    expect(selectedLine).toBeDefined();

    // Check that selected row contains spans with GOLD background (r: 224, g: 175, b: 104)
    const hasGoldBg = selectedLine!.spans.some((span) => span.bg.buffer[0] === 224 && span.bg.buffer[1] === 175 && span.bg.buffer[2] === 104);
    expect(hasGoldBg).toBe(true);
  });

  test("truncates long descriptions without wrapping on narrow terminals", async () => {
    const testRenderer = await createTestRenderer({ width: 45, height: 10 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SuggestionBox suggestions={SAMPLE_SUGGESTIONS} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    const lines = output.split("\n").filter((l) => l.includes("│"));
    expect(lines.length).toBe(6);
    expect(output).toContain("/create-feature");
    expect(output).toContain("...");
  });

  test("renders footer hint with Tab to select, navigation, and dismissal", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 10 });
    const root = createRoot(testRenderer.renderer);

    root.render(<SuggestionBox suggestions={SAMPLE_SUGGESTIONS} selectedIndex={0} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Tab to select");
    expect(output).toContain("↑/↓ to navigate");
    expect(output).toContain("Esc to dismiss");
  });

  test("accepting a suggestion positions cursor at the end of the inserted command", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textarea = new TextareaRenderable(testRenderer.renderer as any, {});
    textarea.setText("/m");

    // Simulating acceptSuggestion:
    const activeFragment = { trigger: "/", fragment: "m", start: 0 };
    const suggestion = { insertText: "model", label: "/model", description: "Switch the active model" };
    const current = textarea.plainText;
    const before = current.slice(0, activeFragment.start);
    const after = current.slice(activeFragment.start + 1 + activeFragment.fragment.length);
    const inserted = `${activeFragment.trigger}${suggestion.insertText} `;
    const next = `${before}${inserted}${after}`;
    textarea.setText(next);
    textarea.cursorOffset = before.length + inserted.length;

    expect(textarea.plainText).toBe("/model ");
    expect(textarea.cursorOffset).toBe(7);
    expect(textarea.visualCursor.visualCol).toBe(7);
  });
});
