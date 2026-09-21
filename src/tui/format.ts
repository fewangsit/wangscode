export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export interface ParsedToolName {
  isMcp: boolean;
  serverName: string | null;
  toolName: string;
}

/**
 * Splits MCP namespaced tool names (e.g. "mcp__wangs-ui__docs-list") into its server
 * and command/tool name components ("wangs-ui" and "docs-list").
 * Non-MCP tools return the original name with isMcp: false.
 */
export function parseToolName(rawName: string): ParsedToolName {
  if (rawName.startsWith("mcp__")) {
    const parts = rawName.split("__");
    if (parts.length >= 3) {
      return {
        isMcp: true,
        serverName: parts[1] ?? null,
        toolName: parts.slice(2).join("__"),
      };
    }
    const remainder = rawName.slice("mcp__".length);
    if (remainder.length > 0) {
      return {
        isMcp: true,
        serverName: null,
        toolName: remainder,
      };
    }
  }
  return {
    isMcp: false,
    serverName: null,
    toolName: rawName,
  };
}

/**
 * Shortens an absolute path to be relative to cwd for concise display in TUI.
 */
export function shortenPath(fullPath: string, cwd = typeof process !== "undefined" ? process.cwd() : ""): string {
  if (!fullPath) return "";
  if (cwd && fullPath.startsWith(cwd)) {
    const rel = fullPath.slice(cwd.length).replace(/^[/\\]/, "");
    return rel || ".";
  }
  return fullPath;
}

/**
 * Formats a clean, readable label for permission prompts:
 * - If optsTitle is provided, uses it.
 * - Extracts clean tool name from mcp__<server>__<tool> prefix.
 * - Omits empty `{}` when input parameters are empty.
 */
export function formatToolLabel(toolName: string, input: Record<string, unknown>, optsTitle?: string): string {
  if (optsTitle) return optsTitle;
  const parsed = parseToolName(toolName);
  const hasInput = Object.keys(input).length > 0;
  return hasInput ? `${parsed.toolName} ${JSON.stringify(input)}` : parsed.toolName;
}

export interface FormattedToolCall {
  /** The primary row text (e.g. "Subagent: wangs-ui-querier", "$ bun test", "Read: src/index.ts") */
  headline: string;
  /** Optional secondary detail row (e.g. "↳ Daftar dokumentasi wangs-ui") */
  detail?: string;
  /** Optional raw JSON string for unhandled complex object payloads */
  rawJson?: string;
}

/**
 * Formats tool calls and subagent calls for a tidy, human-readable terminal display,
 * preventing noisy raw JSON dumps for known tools (Agent, Bash, Read, Edit, MCP, etc.).
 */
export function formatToolCall(rawName: string, input: unknown, isSkill = false): FormattedToolCall {
  // 1. Skill tool
  if (isSkill || rawName === "Skill") {
    const skillName = typeof input === "object" && input !== null && "skill" in input ? String((input as { skill?: unknown }).skill) : rawName;
    return { headline: `Skill: ${skillName}` };
  }

  const { toolName } = parseToolName(rawName);
  const inputObj = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;

  // 2. Subagent / Agent tool
  const isAgent = rawName.toLowerCase() === "agent" || rawName.toLowerCase() === "subagent" || Boolean(inputObj && "subagent_type" in inputObj);

  if (isAgent) {
    if (inputObj) {
      const subagentType = typeof inputObj.subagent_type === "string" ? inputObj.subagent_type : "subagent";
      const description = typeof inputObj.description === "string" ? inputObj.description : undefined;
      const prompt = typeof inputObj.prompt === "string" ? inputObj.prompt : undefined;

      let detail = description;
      if (!detail && prompt) {
        const singleLine = prompt.replace(/\s+/g, " ").trim();
        detail = singleLine.length > 90 ? `${singleLine.slice(0, 90)}…` : singleLine;
      }

      return {
        headline: `Subagent: ${subagentType}`,
        detail: detail ? `↳ ${detail}` : undefined,
      };
    }
    return { headline: "Subagent" };
  }

  // 3. Bash / Shell command
  if (rawName.toLowerCase() === "bash" || toolName.toLowerCase() === "bash") {
    if (inputObj && typeof inputObj.command === "string") {
      const cmd = inputObj.command.trim();
      const lines = cmd.split("\n");
      const firstLine = lines[0] ?? "";
      const remainingCount = lines.length - 1;
      return {
        headline: `$ ${firstLine}${remainingCount > 0 ? ` (+${remainingCount} lines)` : ""}`,
        detail: remainingCount > 0 ? `↳ ${lines.slice(1).join(" ").trim()}` : undefined,
      };
    }
    return { headline: "Bash" };
  }

  // 4. File reading (Read, View, view_file, read_file)
  const isRead = /^(read|view)(_file)?$/i.test(toolName);
  if (isRead && inputObj) {
    const filePath = inputObj.file_path ?? inputObj.path ?? inputObj.TargetFile ?? inputObj.AbsolutePath ?? inputObj.filePath;
    if (typeof filePath === "string") {
      return { headline: `Read: ${shortenPath(filePath)}` };
    }
  }

  // 5. File editing / writing (Edit, Write, write_to_file, replace_file_content, str_replace_editor)
  const isEditOrWrite = /^(edit|write|write_to_file|replace_file_content|str_replace_editor)$/i.test(toolName);
  if (isEditOrWrite && inputObj) {
    const filePath = inputObj.file_path ?? inputObj.path ?? inputObj.TargetFile ?? inputObj.AbsolutePath ?? inputObj.filePath;
    const action = toolName.toLowerCase().includes("write") ? "Write" : "Edit";
    const desc =
      typeof inputObj.Description === "string" ? inputObj.Description : typeof inputObj.Instruction === "string" ? inputObj.Instruction : undefined;

    if (typeof filePath === "string") {
      return {
        headline: `${action}: ${shortenPath(filePath)}`,
        detail: desc ? `↳ ${desc}` : undefined,
      };
    }
  }

  // 6. Search tools (Glob, Grep, FileSearch)
  const isSearch = /^(grep|glob|filesearch)$/i.test(toolName);
  if (isSearch && inputObj) {
    const pattern = inputObj.pattern ?? inputObj.query;
    const pathArg = inputObj.path ? ` in ${shortenPath(String(inputObj.path))}` : "";
    if (typeof pattern === "string") {
      return { headline: `${toolName}: "${pattern}"${pathArg}` };
    }
  }

  // 7. General / MCP tool with input object
  if (inputObj) {
    const entries = Object.entries(inputObj);
    if (entries.length === 0) {
      return { headline: toolName };
    }

    const isAllPrimitive = entries.every(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");

    if (isAllPrimitive) {
      const paramStr = entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      if (paramStr.length <= 60) {
        return { headline: `${toolName} ${paramStr}` };
      }
      return {
        headline: toolName,
        detail: `↳ ${paramStr}`,
      };
    }

    return {
      headline: toolName,
      rawJson: JSON.stringify(inputObj, null, 2),
    };
  }

  return {
    headline: toolName,
    rawJson: input !== null && input !== undefined ? String(input) : undefined,
  };
}
