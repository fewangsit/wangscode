import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "Rules utama" (per user directive), not skills: unlike wangs-plugin/'s SKILL.md
// files (discoverable, model decides whether to invoke), this content is meant
// to be unconditionally in every model call's system prompt — both the
// interactive chat (session-options.ts) and every headless pipeline model turn
// (pipeline/agent-runner.ts). Kept as plain .md on disk (not a TS string
// constant) so it stays easy to read/diff/maintain; this module is just the
// loader.
//
// Covers two kinds of content, both "always in context, never gated behind
// the model deciding to invoke a skill": coding discipline (React 19 compiler
// rules, TypeScript strictness) and the Wangs Foundation architecture itself
// (layer map, feature folder structure, naming/import conventions) — the
// latter used to live as docs/*.md in each consuming project, read via the
// Read tool. Moved here instead: those docs were already fully generic
// (no per-project business content), and having two copies of the same
// selector-contract table (one here, one in each project's docs/) had
// already drifted once before this move.
//
// Same package-root resolution trick as session-options.ts's WANGS_PLUGIN_ROOT
// — works whether run from source (src/) or from an installed package (dist/).
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_DIR = path.join(PACKAGE_ROOT, "rules");

const RULE_FILES = [
  "architecture-overview.md",
  "feature-pattern.md",
  "conventions.md",
  "react19-compiler-typescript.md",
  "typescript-strict-typing.md",
];

function readRule(filename: string): string {
  return fs.readFileSync(path.join(RULES_DIR, filename), "utf8").trim();
}

export const PRIMARY_RULES: string = RULE_FILES.map(readRule).join("\n\n---\n\n");
