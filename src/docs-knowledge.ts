import type { McpServerConfig } from "./engine/index.ts";

// Filesystem-backed MCP server over TAG Samurai's own PRD/UI-Design/TestCases docs — a live
// git-cloned copy on the server, read directly (list_directory/search_files/search_content/
// read_file), not a pre-built index or embedding store. Covers 6 repos: admin-console, auth,
// fixed-asset, global-settings, uiux-global-setting, foundation — confirmed via a real
// `list_directory` call, not assumed. Lets the model look up a cross-referenced sibling PRD (e.g.
// `role/PRD/role.md §2.3` cited from another module's spec) by itself instead of asking the user
// to paste in a file that could be large.
//
// History: this replaces TWO earlier attempts at the same job, in order —
// 1. graphify-based `docs-knowledge` (http://192.168.1.114:3000/mcp/uiux/http) — went stale, still
//    pointed at the pre-migration 4-file PRD split and 404'd on its own returned paths.
// 2. qmd (local hybrid lex/vec search, http://localhost:8181/mcp) — worked well on this dev
//    machine, but qmd's embedding model needs a GPU the real deployment target doesn't have, so it
//    was never actually deployable.
// This server sidesteps both problems: no index to go stale (it reads the live clone directly) and
// no embedding model to run (search_content is a plain grep-equivalent, no GPU needed at all).
// Confirmed reachable and returning accurate, current content via a real tools/call (not assumed).
export const DOCS_KNOWLEDGE_MCP_URL = "http://192.168.1.114:3001/mcp/uiux/http";

export const DOCS_KNOWLEDGE_MCP_SERVERS: Record<string, McpServerConfig> = {
  "docs-knowledge": { type: "http", url: DOCS_KNOWLEDGE_MCP_URL },
};

// This server's own tool names (confirmed via a real tools/list call against the running server,
// not guessed): list_directory (browse repo/module structure, no params = top-level repo list),
// search_files (find by path/filename, glob or substring), search_content (grep-equivalent over
// file bodies, for when only a term/concept is known, not the file), read_file (read full content,
// paginated via offset for large files). Namespaced by the SDK as `mcp__<server-key>__<tool-name>`,
// matching the key above.
export const DOCS_KNOWLEDGE_TOOLS = [
  "mcp__docs-knowledge__list_directory",
  "mcp__docs-knowledge__search_files",
  "mcp__docs-knowledge__search_content",
  "mcp__docs-knowledge__read_file",
];

// Appended to the cacheable RequirementBundle context (see
// pipeline/prompts.ts's buildCacheableContext) and to the interactive
// session's persona append — same instruction either way, so it's defined
// once here rather than drifting between the two call sites.
export const DOCS_KNOWLEDGE_USAGE_NOTE = `## Cross-referencing sibling documents (docs-knowledge MCP)
If a document above references another module's PRD/spec by path (e.g. "detail: role/PRD/role.md §8.2", "lihat position/PRD/position.md §9") and that detail actually matters for the task, use the \`docs-knowledge\` MCP tools to resolve it — don't guess or silently skip it:
- If you already know (or can guess) the repo/module name: \`list_directory\` to browse, or \`search_files\` to find the exact path.
- If you only know a term/concept but not which file it's in: \`search_content\` to grep the file bodies.
- \`read_file\` to read the full content of a path found above (paginated for large files — follow the returned \`offset\` until done).

This reads a live git clone on the server directly — no pre-built index to go stale, so a "not found" result means the reference is genuinely wrong or the repo/path doesn't exist, not a stale-index artifact. Covers 6 repos: admin-console, auth, fixed-asset, global-settings, uiux-global-setting, foundation — a reference into a repo outside that set won't resolve; note that explicitly instead of treating an empty result as "the reference doesn't exist."`;
