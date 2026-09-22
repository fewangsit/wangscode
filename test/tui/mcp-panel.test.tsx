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
    expect(output).toContain("Show Tools");
    expect(output).toContain("Reconnect");
    expect(output).toContain("Disable server");
  });

  test("renders server actions view for a disabled/errored server", async () => {
    // wangs-ui is spawned automatically (session-options.ts) when @wangs-ui/* is detected in the
    // project — it's just an ordinary server name here, no special-cased UI for it anymore (see
    // McpPanel.tsx's getServerActions).
    const disabledServers: McpServerStatus[] = [
      {
        name: "wangs-ui",
        status: "disabled",
        error: "connection refused",
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 18 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "actions", serverIdx: 0, selectedIdx: 0 }} servers={disabledServers} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("wangs-ui");
    expect(output).toContain("disabled");
    expect(output).toContain("Error:");
    expect(output).toContain("connection refused");
    expect(output).toContain("Reconnect");
    expect(output).toContain("Enable server");
    // No "Show Tools" — not connected and no tools reported.
    expect(output).not.toContain("Show Tools");
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
        // A real, directly-fetchable HTTP config — "Loading details…" is only the honest message
        // for a server this app can actually still enrich (see McpPanel.tsx's canFetchMoreDetails).
        config: { type: "http", url: "http://example.test/mcp" },
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

  test("renders 'not available' instead of stalled loading for a claudeai-proxy server", async () => {
    // "claude.ai Claude Docs" and similarly account-managed servers proxy through Anthropic's own
    // internal API — this app can never fetch their description/inputSchema from outside the
    // running `claude` subprocess's own session, so showing "Loading details…" forever would be
    // dishonest (it will never resolve). See mcp-tools.ts's fetchServerToolDefinitions for the
    // matching skip on the fetch side.
    const claudeaiProxyServer: McpServerStatus[] = [
      {
        name: "claude.ai Claude Docs",
        status: "connected",
        config: { type: "claudeai-proxy", url: "https://api.anthropic.com/v1/pages/mcp", id: "mcpsrv_test" },
        tools: [{ name: "read", annotations: { readOnly: true } }],
      },
    ];

    const testRenderer = await createTestRenderer({ width: 80, height: 24 });
    const root = createRoot(testRenderer.renderer);

    root.render(<McpPanel view={{ kind: "tool-detail", serverIdx: 0, toolIdx: 0 }} servers={claudeaiProxyServer} loading={false} />);
    await new Promise((r) => setTimeout(r, 60));
    await testRenderer.renderOnce();

    const output = testRenderer.captureCharFrame();
    expect(output).toContain("read");
    expect(output).toContain("Description:");
    expect(output).toContain("not available");
    expect(output).not.toContain("Loading details…");
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
