import { describe, expect, test } from "bun:test";
import { capitalize, formatToolCall, formatToolLabel, isJsonString, parseToolName, shortenPath, summarizeJson } from "../../src/tui/format.ts";

describe("format utilities", () => {
  describe("capitalize", () => {
    test("capitalizes first character", () => {
      expect(capitalize("high")).toBe("High");
      expect(capitalize("low")).toBe("Low");
      expect(capitalize("")).toBe("");
    });
  });

  describe("parseToolName", () => {
    test("splits MCP tool names into server and tool components", () => {
      const result = parseToolName("mcp__wangs-ui__docs-list");
      expect(result).toEqual({
        isMcp: true,
        serverName: "wangs-ui",
        toolName: "docs-list",
      });
    });

    test("handles multi-hyphenated and complex MCP tool names", () => {
      const result = parseToolName("mcp__wangs-ui__docs-show-story");
      expect(result).toEqual({
        isMcp: true,
        serverName: "wangs-ui",
        toolName: "docs-show-story",
      });
    });

    test("handles MCP names with additional double underscores in tool name", () => {
      const result = parseToolName("mcp__server__sub__tool");
      expect(result).toEqual({
        isMcp: true,
        serverName: "server",
        toolName: "sub__tool",
      });
    });

    test("handles non-MCP tool names unchanged", () => {
      const bash = parseToolName("Bash");
      expect(bash).toEqual({
        isMcp: false,
        serverName: null,
        toolName: "Bash",
      });

      const skill = parseToolName("Skill");
      expect(skill).toEqual({
        isMcp: false,
        serverName: null,
        toolName: "Skill",
      });
    });

    test("handles incomplete mcp prefix gracefully", () => {
      const result = parseToolName("mcp__custom");
      expect(result).toEqual({
        isMcp: true,
        serverName: null,
        toolName: "custom",
      });
    });
  });

  describe("shortenPath", () => {
    test("shortens absolute path when within cwd", () => {
      expect(shortenPath("/repo/src/index.ts", "/repo")).toBe("src/index.ts");
      expect(shortenPath("/repo/test/app.test.tsx", "/repo")).toBe("test/app.test.tsx");
    });

    test("keeps path unchanged when outside cwd or already relative", () => {
      expect(shortenPath("/other/path.ts", "/repo")).toBe("/other/path.ts");
      expect(shortenPath("src/index.ts", "/repo")).toBe("src/index.ts");
    });
  });

  describe("formatToolLabel", () => {
    test("omits empty json object for tool without input", () => {
      expect(formatToolLabel("mcp__wangs-ui__docs-list", {})).toBe("docs-list");
    });

    test("includes json stringified input when input has keys", () => {
      expect(formatToolLabel("mcp__wangs-ui__docs-show", { name: "Button" })).toBe('docs-show {"name":"Button"}');
    });

    test("prefers optsTitle when provided", () => {
      expect(formatToolLabel("Bash", { command: "bun test" }, "Run test suite")).toBe("Run test suite");
    });

    test("formats non-MCP tools cleanly without empty brackets", () => {
      expect(formatToolLabel("GlobTool", {})).toBe("GlobTool");
      expect(formatToolLabel("Bash", { command: "ls" })).toBe('Bash {"command":"ls"}');
    });
  });

  describe("formatToolCall", () => {
    test("formats Agent subagent calls with type and description", () => {
      const input = {
        description: "Daftar dokumentasi wangs-ui",
        subagent_type: "wangs-ui-querier",
        prompt:
          "Panggil docs-list pada MCP wangs-ui, lalu laporkan seluruh daftar ID komponen dan dokumentasi yang tersedia (dikelompokkan jika memungkinkan). Jangan panggil docs-show dulu.",
        run_in_background: false,
      };

      const result = formatToolCall("Agent", input);
      expect(result).toEqual({
        headline: "Subagent: wangs-ui-querier",
        detail: "↳ Daftar dokumentasi wangs-ui",
      });
    });

    test("formats Agent subagent call falling back to prompt preview when description is missing", () => {
      const input = {
        subagent_type: "ui-design-reader",
        prompt: "Ingest UI Design.md and output sections",
      };

      const result = formatToolCall("Agent", input);
      expect(result.headline).toBe("Subagent: ui-design-reader");
      expect(result.detail).toBe("↳ Ingest UI Design.md and output sections");
      expect(result.rawJson).toBeUndefined();
    });

    test("formats Bash commands with a fixed headline and the command as detail", () => {
      const result = formatToolCall("Bash", { command: "bun test" });
      expect(result).toEqual({
        headline: "Ran 1 shell command",
        detail: "↳ $ bun test",
      });
    });

    test("formats multiline Bash command with line count hint in the detail", () => {
      const result = formatToolCall("Bash", { command: "echo line1\necho line2\necho line3" });
      expect(result.headline).toBe("Ran 1 shell command");
      expect(result.detail).toBe("↳ $ echo line1 (+2 lines)");
    });

    test("formats file read and edit tools with clean path and description", () => {
      const read = formatToolCall("Read", { file_path: "src/tui/App.tsx" });
      expect(read.headline).toBe("Reading src/tui/App.tsx");

      const edit = formatToolCall("replace_file_content", {
        TargetFile: "src/tui/App.tsx",
        Description: "Add key navigation handler",
      });
      expect(edit.headline).toBe("Editing src/tui/App.tsx");
      expect(edit.detail).toBe("↳ Add key navigation handler");
    });

    test("formats search tools (Grep/Glob)", () => {
      const grep = formatToolCall("Grep", { pattern: "ToolCallRow", path: "src/" });
      expect(grep.headline).toBe('Grep: "ToolCallRow" in src/');
    });

    test("formats MCP tools without dumping raw JSON", () => {
      const list = formatToolCall("mcp__wangs-ui__docs-list", {});
      expect(list).toEqual({ headline: "docs-list" });

      const show = formatToolCall("mcp__wangs-ui__docs-show", { component: "Button" });
      expect(show).toEqual({ headline: 'docs-show component="Button"' });
    });

    test("preserves rawJson only for unhandled complex objects", () => {
      const complex = formatToolCall("CustomTool", { nested: { array: [1, 2, 3] } });
      expect(complex.headline).toBe("CustomTool");
      expect(complex.rawJson).toContain('"nested"');
    });
  });

  describe("isJsonString", () => {
    test("detects valid json objects and arrays", () => {
      expect(isJsonString('{"acks":[{"verdict":"allow"}]}')).toBe(true);
      expect(isJsonString('["item1", "item2"]')).toBe(true);
      expect(isJsonString('  { "key": 123 }  ')).toBe(true);
    });

    test("rejects invalid or non-object json", () => {
      expect(isJsonString("")).toBe(false);
      expect(isJsonString("plain text")).toBe(false);
      expect(isJsonString("123")).toBe(false);
      expect(isJsonString('"just a string"')).toBe(false);
      expect(isJsonString("{ invalid json }")).toBe(false);
    });
  });

  describe("summarizeJson", () => {
    test("summarizes object with nested structures cleanly", () => {
      const input = {
        container: { kind: "project", id: "123" },
        batch: [{ verb: "create", object: "utterance" }],
      };
      expect(summarizeJson(input)).toBe("{ container: {…}, batch: [1] }");
    });

    test("summarizes arrays with item count", () => {
      expect(summarizeJson([1, 2, 3])).toBe("[3 items]");
      expect(summarizeJson([])).toBe("[0 items]");
      expect(summarizeJson(["one"])).toBe("[1 item]");
    });

    test("handles primitives and null values", () => {
      expect(summarizeJson({ str: "hello", num: 42, active: true, nothing: null })).toBe('{ str: "hello", num: 42, active: true, nothing: null }');
    });

    test("handles empty object", () => {
      expect(summarizeJson({})).toBe("{}");
    });

    test("truncates when exceeding maxLen", () => {
      const large = {
        key1: "very long text value here",
        key2: "another long value here",
        key3: "yet another value",
        key4: "overflow",
      };
      const summary = summarizeJson(large, 40);
      expect(summary).toContain("+");
      expect(summary.length).toBeLessThanOrEqual(50);
    });
  });
});
