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
// Same package-root resolution trick as session-options.ts's WANGS_PLUGIN_ROOT
// — works whether run from source (src/) or from an installed package (dist/).
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_DIR = path.join(PACKAGE_ROOT, "rules");

const RULE_FILES = ["react19-compiler-typescript.md", "typescript-strict-typing.md"];

function readRule(filename: string): string {
  return fs.readFileSync(path.join(RULES_DIR, filename), "utf8").trim();
}

export const CODING_RULES: string = RULE_FILES.map(readRule).join("\n\n---\n\n");
