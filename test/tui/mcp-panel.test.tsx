import { describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";

import { McpPanel } from "../../src/tui/McpPanel.tsx";

const MOCK_SERVERS: McpServerStatus[] = [
  {
    name: "uiux-knowledge",
    status: "connected",
    tools: [
      {
        name: "query_graph",
        description: "Keyword search cepat khusus domain [uiux]",
        annotations: { readOnly: true },
      },
      {
        name: "read_source_file",
        description: "Read source file content",
      },
    ],
  },
  {
    name: "broken-server",
    status: "failed",
    error: "connection refused",
  },
];

describe("McpPanel", () => {
  test("renders servers list view", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "servers", selectedIdx: 0 }} servers={MOCK_SERVERS} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("MCP Servers");
    expect(output).toContain("Esc to cancel");
    expect(output).toContain("uiux-knowledge");
    expect(output).toContain("2 tools");
    expect(output).toContain("broken-server");
    expect(output).toContain("failed");
  });

  test("renders server actions view with rich metadata", async () => {
    const serversWithConfig: McpServerStatus[] = [
      {
        name: "wangs-ui",
        status: "connected",
        scope: "project",
        config: {
          command: "npx",
          args: ["-y", "@wangs-ui/mcp@latest"],
        },
        // @ts-expect-error test runtime capabilities field
        capabilities: ["tools", "resources"],
        tools: Array.from({ length: 12 }, (_, i) => ({ name: `tool_${i}` })),
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 18 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <McpPanel
        view={{ kind: "actions", serverIdx: 0, selectedIdx: 0 }}
        servers={serversWithConfig}
        loading={false}
        cwd="/Volumes/Home/Documents/uiux-global-setting"
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("wangs-ui");
    expect(output).toContain("Esc to back");
    expect(output).toContain("Status:");
    expect(output).toContain("connected");
    expect(output).toContain("Command:");
    expect(output).toContain("npx");
    expect(output).toContain("Args:");
    expect(output).toContain("-y @wangs-ui/mcp@latest");
    expect(output).toContain("Config location:");
    expect(output).toContain("/Volumes/Home/Documents/uiux-global-setting/.mcp.json");
    expect(output).toContain("Capabilities:");
    expect(output).toContain("tools · resources");
    expect(output).toContain("Tools:");
    expect(output).toContain("12 tools");
    expect(output).toContain("Project @wangs-ui: 1.0.64");
    expect(output).toContain("@wangs-ui/mcp@latest (⚠️ mismatch)");
    expect(output).toContain("Update to @wangs-ui/mcp@1.0.64");
    expect(output).toContain("Show Tools");
    expect(output).toContain("Reconnect");
    expect(output).toContain("Disable server");
  });

  test("renders server actions view with matched version", async () => {
    const matchedServers: McpServerStatus[] = [
      {
        name: "wangs-ui",
        status: "connected",
        scope: "project",
        config: {
          command: "npx",
          args: ["-y", "@wangs-ui/mcp@1.0.64"],
        },
        tools: Array.from({ length: 12 }, (_, i) => ({ name: `tool_${i}` })),
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 18 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <McpPanel
        view={{ kind: "actions", serverIdx: 0, selectedIdx: 0 }}
        servers={matchedServers}
        loading={false}
        cwd="/Volumes/Home/Documents/uiux-global-setting"
      />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Project @wangs-ui: 1.0.64");
    expect(output).toContain("@wangs-ui/mcp@1.0.64 (✔ matched)");
    expect(output).toContain("Show Tools");
    expect(output).toContain("Reconnect");
    expect(output).toContain("Sync with project (@wangs-ui/mcp@1.0.64)");
    expect(output).toContain("Disable server");
  });

  test("renders server actions view when wangs-ui is not in project", async () => {
    const uninstalledServers: McpServerStatus[] = [
      {
        name: "wangs-ui",
        status: "disabled",
        scope: "project",
        error: "Not installed (@wangs-ui not detected in project)",
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 24 });
    const root = createRoot(testRenderer.renderer);

    root.render(
      <McpPanel view={{ kind: "actions", serverIdx: 0, selectedIdx: 0 }} servers={uninstalledServers} loading={false} cwd="/tmp/empty-repo" />,
    );
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Project @wangs-ui: not detected in project");
    expect(output).toContain("not installed");
    expect(output).toContain("Install @wangs-ui/mcp@latest");
    expect(output).toContain("Wangs UI is not installed in this repository");
  });

  test("renders tool list view", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "tools", serverIdx: 0, selectedIdx: 0 }} servers={MOCK_SERVERS} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("uiux-knowledge");
    expect(output).toContain("/ tools");
    expect(output).toContain("query_graph");
    expect(output).toContain("Keyword search cepat khusus domain [uiux]");
    expect(output).toContain("read_source_file");
  });

  test("renders tool detail view with parameters", async () => {
    const serversWithSchema: McpServerStatus[] = [
      {
        name: "uiux-knowledge",
        status: "connected",
        tools: [
          {
            name: "query_graph",
            description: "Keyword search cepat khusus domain [uiux]",
            annotations: { readOnly: true },
            // @ts-expect-error test schema augmentation
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Pertanyaan atau kata kunci pencarian",
                },
              },
              required: ["query"],
            },
          },
        ],
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 24 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "tool-detail", serverIdx: 0, toolIdx: 0 }} servers={serversWithSchema} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("query_graph");
    expect(output).toContain("uiux-knowledge");
    expect(output).toContain("Tool name: query_graph");
    expect(output).toContain("Full name: mcp__uiux-knowledge__query_graph");
    expect(output).toContain("read-only");
    expect(output).toContain("Description:");
    expect(output).toContain("Keyword search cepat khusus domain [uiux]");
    expect(output).toContain("Parameters:");
    expect(output).toContain("● query: string (required) - Pertanyaan atau kata kunci pencarian");
  });

  test("renders tool detail view loading details state", async () => {
    const serversWithBareTool: McpServerStatus[] = [
      {
        name: "uiux-knowledge",
        status: "connected",
        tools: [
          {
            name: "query_graph",
          },
        ],
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 24 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "tool-detail", serverIdx: 0, toolIdx: 0 }} servers={serversWithBareTool} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("query_graph");
    expect(output).toContain("Description:");
    expect(output).toContain("Loading details…");
  });

  test("renders loading state", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 8 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "servers", selectedIdx: 0 }} servers={[]} loading={true} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("MCP Servers");
    expect(output).toContain("Loading MCP servers…");
  });

  test("renders server actions connecting loading state", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 12 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "actions", serverIdx: 0, selectedIdx: 0 }} servers={MOCK_SERVERS} loading={true} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("Connecting to uiux-knowledge…");
  });
});
