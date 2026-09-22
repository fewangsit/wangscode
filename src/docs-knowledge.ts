import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

// qmd-based MCP server over TAG Samurai's own PRD/UI-Design/TestCases docs
// (global-settings, foundation, auth, fixed-asset, uiux-global-setting so far
// — admin-console pending, its Gitea org/repo name isn't known yet). Lets the
// model look up a cross-referenced sibling PRD (e.g. `role/PRD/role.md §2.3`
// cited from another module's spec) by itself instead of asking the user to
// paste in a file that could be large.
//
// Replaces the earlier graphify-based `docs-knowledge` server
// (http://192.168.1.114:3000/mcp/uiux/http), which had gone stale — it still
// pointed at the pre-migration 4-file PRD split and 404'd on its own returned
// paths (confirmed by a real query against it, not assumed).
//
// TEMPORARY: points at localhost — this is qmd-docs-server (../qmd-docs-server/)
// running manually on this dev machine, not a deployed service yet. Update
// this URL once qmd-docs-server is actually deployed somewhere reachable by
// every wangs-code user, not just this machine.
export const DOCS_KNOWLEDGE_MCP_URL = "http://localhost:8181/mcp";

export const DOCS_KNOWLEDGE_MCP_SERVERS: Record<string, McpServerConfig> = {
  "docs-knowledge": { type: "http", url: DOCS_KNOWLEDGE_MCP_URL },
};

// qmd's own tool names (confirmed via a real tools/list call against the
// running server, not guessed) — query (hybrid lex/vec/hyde search), get
// (fetch a document by path/docid, with line-range slicing), multi_get
// (batch fetch), status (index health). Namespaced by the SDK as
// `mcp__<server-key>__<tool-name>`, matching the key above.
export const DOCS_KNOWLEDGE_TOOLS = [
  "mcp__docs-knowledge__query",
  "mcp__docs-knowledge__get",
  "mcp__docs-knowledge__multi_get",
  "mcp__docs-knowledge__status",
];

// Appended to the cacheable RequirementBundle context (see
// pipeline/prompts.ts's buildCacheableContext) and to the interactive
// session's persona append — same instruction either way, so it's defined
// once here rather than drifting between the two call sites.
export const DOCS_KNOWLEDGE_USAGE_NOTE = `## Cross-referencing sibling documents (docs-knowledge MCP)
If a document above references another module's PRD/spec by path (e.g. "detail: role/PRD/role.md §8.2", "lihat position/PRD/position.md §9") and that detail actually matters for the task, use the \`docs-knowledge\` MCP tools to resolve it — don't guess or silently skip it:
- \`query\` to find the right document (pass the referenced path or a natural-language question).
- \`get\` to read the specific section once you have its path (supports a \`from:count\` line range).

Trust but verify: if \`get\` fails to find a path that \`query\` just returned, the index may be stale for that specific document — say so explicitly rather than silently proceeding as if the reference doesn't exist. Only a handful of repos are indexed today (global-settings, foundation, auth, fixed-asset, uiux-global-setting) — a reference into an unindexed repo won't resolve; note that too instead of treating an empty result as "the reference doesn't exist."`;
