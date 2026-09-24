import { describe, expect, test } from "bun:test";
import React from "react";
import { SyntaxStyle } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";

import { CollapsibleJson, JsonNodeView, renderBlock } from "../../src/tui/BlockRenderers.tsx";
import type { ChatBlock } from "../../src/tui/chat-store.ts";

describe("BlockRenderers - CollapsibleJson", () => {
  const syntaxStyle = SyntaxStyle.create();

  test("renders collapsed JSON preview by default", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 10 });
    const root = createRoot(testRenderer.renderer);

    const inputData = {
      container: { kind: "project", id: "9bdd456d-2fd9" },
      batch: [{ verb: "create", object: "utterance" }],
    };

    root.render(<CollapsibleJson label="Input" value={inputData} syntaxStyle={syntaxStyle} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("▶ Input:");
    expect(output).toContain("{ container, batch }");
    expect(output).not.toContain('"kind": "project"');
  });

  test("renders level-1 tree nodes when expanded, with sub-nodes collapsed", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 15 });
    const root = createRoot(testRenderer.renderer);

    const inputData = {
      container: { kind: "project", id: "9bdd456d-2fd9" },
    };

    root.render(<CollapsibleJson label="Input" value={inputData} syntaxStyle={syntaxStyle} defaultExpanded={true} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("▼ Input:");
    expect(output).toContain("▶ container:");
    expect(output).toContain("{ kind, id }");
    expect(output).not.toContain('"kind": "project"');
  });

  test("JsonNodeView renders child properties when expanded", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 10 });
    const root = createRoot(testRenderer.renderer);

    const data = { kind: "project", id: "9bdd456d-2fd9" };

    root.render(<JsonNodeView keyName="container" value={data} defaultExpanded={true} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("▼ container: {");
    expect(output).toContain('kind: "project"');
    expect(output).toContain('id: "9bdd456d-2fd9"');
    expect(output).toContain("}");
  });

  test("renderBlock with tool block renders collapsible input and result", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 10 });
    const root = createRoot(testRenderer.renderer);

    const toolBlock: ChatBlock = {
      id: 1,
      kind: "tool",
      toolUseId: "tool-1",
      name: "batch",
      status: "done",
      isSkill: false,
      input: {
        container: { kind: "project", id: "9bdd456d" },
        batch: [{ verb: "create" }],
      },
      resultText: JSON.stringify({ acks: [{ verdict: "allow" }], frame: { slug: "test" } }),
    };

    root.render(renderBlock(toolBlock, syntaxStyle));
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("✓ batch");
    expect(output).toContain("▶ Input:");
    expect(output).toContain("▶ Result:");
  });
});
