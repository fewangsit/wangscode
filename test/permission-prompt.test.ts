import { describe, expect, test } from "bun:test";

import { makeCanUseTool, PermissionRequestStore } from "../src/permission-prompt.ts";

describe("makeCanUseTool", () => {
  test("extracts clean tool name and server name for MCP tools with empty input", async () => {
    const store = new PermissionRequestStore();
    const canUseTool = makeCanUseTool(store);

    const promise = canUseTool("mcp__wangs-ui__docs-list", {}, { signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 10));

    const active = store.store.get();
    expect(active).not.toBeNull();
    expect(active?.toolName).toBe("mcp__wangs-ui__docs-list");
    expect(active?.label).toBe("docs-list");
    expect(active?.mcpServerName).toBe("wangs-ui");

    active?.resolve({ behavior: "allow" });
    const result = await promise;
    expect(result.behavior).toBe("allow");
  });

  test("extracts clean tool name and formats non-empty input", async () => {
    const store = new PermissionRequestStore();
    const canUseTool = makeCanUseTool(store);

    const promise = canUseTool("mcp__wangs-ui__docs-show", { component: "Button" }, { signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 10));

    const active = store.store.get();
    expect(active).not.toBeNull();
    expect(active?.label).toBe('docs-show {"component":"Button"}');
    expect(active?.mcpServerName).toBe("wangs-ui");

    active?.resolve({ behavior: "deny" });
    const result = await promise;
    expect(result.behavior).toBe("deny");
  });

  test("preserves explicit opts.title and opts.mcpServer if provided", async () => {
    const store = new PermissionRequestStore();
    const canUseTool = makeCanUseTool(store);

    const promise = canUseTool(
      "Bash",
      { command: "ls -la" },
      {
        signal: new AbortController().signal,
        title: "List directory contents",
        mcpServer: { name: "custom-system", source: "local" },
      },
    );
    await new Promise((r) => setTimeout(r, 10));

    const active = store.store.get();
    expect(active).not.toBeNull();
    expect(active?.label).toBe("List directory contents");
    expect(active?.mcpServerName).toBe("custom-system");

    active?.resolve({ behavior: "allow" });
    const result = await promise;
    expect(result.behavior).toBe("allow");
  });
});
