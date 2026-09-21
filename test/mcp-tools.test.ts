import { describe, expect, test } from "bun:test";
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";

import { clearMcpToolCache, enrichMcpServersWithTools, fetchServerToolDefinitions } from "../src/mcp-tools.ts";

describe("mcp-tools", () => {
  test("fetchServerToolDefinitions returns built-in tools for wangs-feature-build", async () => {
    const server: McpServerStatus = {
      name: "wangs-feature-build",
      status: "connected",
    };

    const tools = await fetchServerToolDefinitions(server);
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("create_feature");
    expect(tools[0]?.description).toContain("Build a Wangs Foundation feature");
    expect(tools[0]?.inputSchema?.properties?.featureSlug?.type).toBe("string");
    expect(tools[0]?.inputSchema?.required).toContain("featureSlug");
  });

  test("enrichMcpServersWithTools enriches servers in list", async () => {
    const servers: McpServerStatus[] = [
      {
        name: "wangs-feature-build",
        status: "connected",
        tools: [{ name: "create_feature" }],
      },
      {
        name: "unconnected-server",
        status: "failed",
      },
    ];

    const enriched = await enrichMcpServersWithTools(servers);
    expect(enriched[0]?.tools?.[0]?.description).toContain("Build a Wangs Foundation feature");
    expect(enriched[0]?.tools?.[0]?.inputSchema).toBeDefined();
    expect(enriched[1]?.status).toBe("failed");
  });

  test("clearMcpToolCache clears cached tools", async () => {
    clearMcpToolCache("wangs-ui");
    clearMcpToolCache();
  });
});
