import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

import { PACKAGE_ROOT } from "./package-root.ts";

export interface WangsUiVersionInfo {
  version: string;
  source: string;
}

/** Candidate @wangs-ui packages to inspect in node_modules or package.json dependencies. */
const WANGS_UI_CANDIDATE_PACKAGES = ["react-core", "foundation", "animations", "form", "react-icons", "react-presets", "react-i18n"];

/**
 * Detects the version of `@wangs-ui/*` packages used by the project at `cwd`.
 * Priority:
 * 1. Look inside `node_modules/@wangs-ui/<pkg>/package.json` for installed version.
 * 2. Look inside project's root `package.json` dependencies / devDependencies.
 */
export function detectProjectWangsUiVersion(cwd: string): WangsUiVersionInfo | null {
  // 1. Check installed package.json in node_modules
  for (const pkg of WANGS_UI_CANDIDATE_PACKAGES) {
    const pkgPath = path.join(cwd, "node_modules", "@wangs-ui", pkg, "package.json");
    try {
      if (existsSync(pkgPath)) {
        const raw = readFileSync(pkgPath, "utf8");
        const json = JSON.parse(raw) as { version?: string };
        if (json.version) {
          return { version: json.version, source: `@wangs-ui/${pkg} (installed)` };
        }
      }
    } catch {
      // Ignore read/parse error and check next candidate
    }
  }

  // 2. Check project package.json dependencies — only the same UI-component-library candidates as
  // step 1 above, NOT every `@wangs-ui/*`-named package. `@wangs-ui/skills` in particular (the
  // skill-installer CLI, see skills-sync.ts) is a real, common `@wangs-ui/*` dependency that has
  // nothing to do with which `@wangs-ui/mcp` version to spawn — matching on name prefix alone
  // picked it up here before this fix, and its version field is frequently a pnpm/yarn workspace
  // protocol reference (`catalog:`, `workspace:*`) rather than a real semver, which would have
  // gone straight into an `npx @wangs-ui/mcp@<version>` command otherwise.
  const rootPkgPath = path.join(cwd, "package.json");
  try {
    if (existsSync(rootPkgPath)) {
      const raw = readFileSync(rootPkgPath, "utf8");
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const candidate of WANGS_UI_CANDIDATE_PACKAGES) {
        const name = `@wangs-ui/${candidate}`;
        const rawVersion = allDeps[name];
        if (!rawVersion) continue;

        // Clean semver range operators (^1.2.21, ~1.2.21, >=1.2.21 -> 1.2.21)
        const clean = rawVersion.replace(/^[\^~>=<v]+/, "").trim();
        // Reject workspace/catalog protocol references (pnpm `catalog:`, `workspace:*`, yarn
        // `link:`, etc.) — not a real, publishable version `npx @wangs-ui/mcp@<version>` could use.
        if (clean.length > 0 && /^\d/.test(clean)) {
          return { version: clean, source: `${name} (package.json)` };
        }
      }
    }
  } catch {
    // Ignore read/parse error
  }

  return null;
}

/**
 * Resolves the target registry URL for @wangs-ui packages:
 * 1. WANGS_CODE_REGISTRY environment variable
 * 2. .npmrc registry= or @wangs-ui:registry= (checked in cwd, PACKAGE_ROOT, and ~/.npmrc)
 * 3. "publishRegistry" field from wangs-code package.json
 */
export function getMcpTargetRegistry(cwd: string): string | undefined {
  if (process.env.WANGS_CODE_REGISTRY) {
    return process.env.WANGS_CODE_REGISTRY;
  }

  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const candidateNpmrcs = [path.join(cwd, ".npmrc"), path.join(PACKAGE_ROOT, ".npmrc"), ...(homedir ? [path.join(homedir, ".npmrc")] : [])];

  for (const p of candidateNpmrcs) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, "utf8");
        // Check @wangs-ui:registry= first, then general registry=
        const scopedMatch = content.match(/@wangs-ui:registry\s*=\s*(.+)$/m);
        if (scopedMatch?.[1]) return scopedMatch[1].trim();

        const generalMatch = content.match(/^registry\s*=\s*(.+)$/m);
        if (generalMatch?.[1]) return generalMatch[1].trim();
      }
    } catch {
      // Ignore read errors
    }
  }

  // Fall back to package.json publishRegistry
  try {
    const pkgRaw = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { publishRegistry?: string };
    if (pkg.publishRegistry) return pkg.publishRegistry;
  } catch {
    // Ignore read errors
  }

  return undefined;
}

/**
 * Builds the `wangs-ui` MCP server config to spawn for the project at `cwd`, derived live from
 * whatever `@wangs-ui/*` version that project actually has installed right now — not a value
 * stored anywhere (project `.mcp.json`, the user's global `~/.claude.json`) that could drift out
 * of sync after a routine `bun install`/upgrade with nothing forcing a re-sync. Callers (see
 * session-options.ts, pipeline/agent-runner.ts) merge this straight into `Options.mcpServers`, the
 * same in-process pattern already used for `wangs-feature-build`/`docs-knowledge` — the SDK spawns
 * it as a real child process itself, no file involved. Returns null (server simply omitted, same
 * as those other two when unused) when `@wangs-ui/*` isn't installed in this project.
 */
export function resolveWangsUiMcpServer(cwd: string): McpServerConfig | null {
  const info = detectProjectWangsUiVersion(cwd);
  if (!info) return null;

  const registry = getMcpTargetRegistry(cwd);
  return {
    type: "stdio",
    command: "npx",
    args: ["-y", ...(registry ? [`--registry=${registry}`] : []), `@wangs-ui/mcp@${info.version}`],
  };
}
