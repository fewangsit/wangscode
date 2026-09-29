import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";

import { SubagentsPanel, type SubagentExecutionItem } from "../../src/tui/SubagentsPanel.tsx";

const MOCK_SUBAGENTS: SubagentExecutionItem[] = [
  {
    id: 1,
    toolUseId: "tool-sub-1",
    title: "Wangs Ui Querier",
    subagentType: "wangs-ui-querier",
    description: "Query documentation for WangsButton",
    prompt: "Please look up documentation and accessibility props for WangsButton component.",
    status: "done",
    startedAt: 1700000000000,
    completedAt: 1700000003400,
    durationSec: "3.4",
    events: [
      {
        id: "ev-think-1",
        type: "thinking",
        content: "I will query list-all-documentation first then get WangsButton docs.",
        timestamp: 1700000001000,
      },
      {
        id: "ev-tool-1",
        type: "tool_call",
        name: "mcp__wangs-ui__get-documentation",
        content: JSON.stringify({ id: "WangsButton" }),
        status: "done",
        timestamp: 1700000002000,
      },
    ],
    resultText: "== WANGS-UI QUERIER REPORT ==\nComponent: WangsButton\nProps: aria-label (required)",
    childSessionId: "session-sub-xyz",
  },
  {
    id: 2,
    toolUseId: "tool-sub-2",
    title: "Ui Design Reader",
    subagentType: "ui-design-reader",
    description: "Read UI Design spec for Checkout page",
    status: "running",
    startedAt: 1700000010000,
    events: [],
  },
];

describe("SubagentsPanel", () => {
  test("renders empty state with registered Wangs Foundation subagent catalog", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 20 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <SubagentsPanel
        subagents={[]}
        view={{ kind: "history", selectedIdx: 0 }}
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Subagents");
    expect(output).toContain("Execution History");
    expect(output).toContain("Total: 0");
    expect(output).toContain("No subagents have been invoked in this session yet");
    expect(output).toContain("Registered Wangs Foundation Subagents");
    expect(output).toContain("wangs-ui-querier");
    expect(output).toContain("ui-design-reader");
    expect(output).toContain("functional-reader");
    expect(output).toContain("test-case-reader");
    expect(output).toContain("Esc to close");
  });

  test("renders history list with execution items and status counts", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 20 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <SubagentsPanel
        subagents={MOCK_SUBAGENTS}
        view={{ kind: "history", selectedIdx: 0 }}
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Subagents");
    expect(output).toContain("Total: 2");
    expect(output).toContain("Done: 1");
    expect(output).toContain("Running: 1");
    expect(output).toContain("Wangs Ui Querier");
    expect(output).toContain("Query documentation for WangsButton");
    expect(output).toContain("3.4s");
    expect(output).toContain("Ui Design Reader");
    expect(output).toContain("Enter to view full trace & report");
  });

  test("renders detailed execution view with prompt, trace events, and report", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 24 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <SubagentsPanel
        subagents={MOCK_SUBAGENTS}
        view={{ kind: "detail", selectedIdx: 0 }}
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Subagent Execution");
    expect(output).toContain("Wangs Ui Querier");
    expect(output).toContain("wangs-ui-querier");
    expect(output).toContain("DONE");
    expect(output).toContain("Duration: 3.4s");
    expect(output).toContain("session-sub-");
    expect(output).toContain("[Task Objective / Prompt]");
    expect(output).toContain("Please look up documentation and accessibility props");
    expect(output).toContain("[Execution Trace (2 steps)]");
    expect(output).toContain("Thinking");
    expect(output).toContain("Get Documentation");
    expect(output).toContain("WangsButton");
    expect(output).toContain("[Output Report]");
    expect(output).toContain("== WANGS-UI QUERIER REPORT ==");
    expect(output).toContain("Esc to back");
    expect(output).toContain("c to copy report");
  });

  test("renders missing subagent fallback when selectedIdx out of bounds", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 16 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <SubagentsPanel
        subagents={MOCK_SUBAGENTS}
        view={{ kind: "detail", selectedIdx: 99 }}
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Subagent execution not found");
    expect(output).toContain("Esc to back");
  });

  test("renders initializing message for running subagent without prompt yet", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 16 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <SubagentsPanel
        subagents={[
          {
            id: 1,
            toolUseId: "tool-running-1",
            title: "Subagent",
            subagentType: "subagent",
            status: "running",
            events: [],
          },
        ]}
        view={{ kind: "detail", selectedIdx: 0 }}
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("(Initializing task...)");
    expect(output).toContain("(Execution currently in progress...)");
  });
});
