import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "./engine/index.ts";

import { PACKAGE_ROOT } from "./package-root.ts";

export interface WangsUiVersionInfo {
  version: string;
  source: string;
}

/** Candidate @wangs-ui packages to inspect in node_modules or package.json dependencies. */
const WANGS_UI_CANDIDATE_PACKAGES = ["react-core", "foundation", "animations", "form", "react-icons", "react-presets", "react-i18n"];

/** Strip semver range operators (^1.2.3, ~1.2.3, >=1.2.3 -> 1.2.3). Returns null when not a real semver. */
function cleanSemver(raw: string): string | null {
  const clean = raw.replace(/^[\^~>=<v\s]+/, "").trim();
  if (clean.length > 0 && /^\d/.test(clean)) return clean;
  return null;
}

function isCatalogSpec(raw: string): boolean {
  return raw.trim() === "catalog:" || raw.trim().startsWith("catalog:");
}

function catalogNameFromSpec(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "catalog:" || trimmed === "catalog") return null; // default catalog
  const m = trimmed.match(/^catalog:([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/**
 * Minimal parser for the `catalog:` / `catalogs:` sections of a pnpm-workspace.yaml.
 * Full YAML parsing isn't worth a new dependency for two flat string maps — this handles
 * the shapes pnpm documents (default `catalog:` plus named `catalogs:`), quoted or not.
 */
function parsePnpmCatalogs(yaml: string): { catalog: Record<string, string>; catalogs: Record<string, Record<string, string>> } {
  const catalog: Record<string, string> = {};
  const catalogs: Record<string, Record<string, string>> = {};
  let mode: "none" | "catalog" | "catalogs" = "none";
  let currentNamed: string | null = null;

  const entryMatch = (line: string): [string, string] | null => {
    const m = line.match(/^\s+['"]?([^'"\s:#][^'":]*?)['"]?\s*:\s*['"]?([^\s'"]+)['"]?\s*$/);
    if (!m?.[1] || !m?.[2]) return null;
    return [m[1].trim(), m[2].trim()];
  };

  for (const line of yaml.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue;
    const topKey = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (topKey && !line.startsWith(" ") && !line.startsWith("\t")) {
      const key = topKey[1];
      if (key === "catalog") {
        mode = "catalog";
        currentNamed = null;
      } else if (key === "catalogs") {
        mode = "catalogs";
        currentNamed = null;
      } else {
        mode = "none";
        currentNamed = null;
      }
      continue;
    }
    if (mode === "catalog") {
      const entry = entryMatch(line);
      if (entry) catalog[entry[0]] = entry[1];
    } else if (mode === "catalogs") {
      const namedHeader = line.match(/^\s{2}([A-Za-z0-9_-]+)\s*:\s*$/);
      if (namedHeader?.[1]) {
        currentNamed = namedHeader[1];
        catalogs[currentNamed] = {};
        continue;
      }
      const entry = entryMatch(line);
      if (entry && currentNamed) catalogs[currentNamed][entry[0]] = entry[1];
    }
  }
  return { catalog, catalogs };
}

interface BunCatalogs {
  catalog: Record<string, string>;
  catalogs: Record<string, Record<string, string>>;
}

/** Bun documents catalogs inside package.json (`workspaces.catalog` / top-level `catalog`). */
function readBunCatalogs(pkg: Record<string, unknown>): BunCatalogs {
  const catalog: Record<string, string> = {};
  const catalogs: Record<string, Record<string, string>> = {};
  const asMap = (v: unknown): Record<string, string> => (v && typeof v === "object" ? (v as Record<string, string>) : {});
  const workspaces = pkg["workspaces"];
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const ws = workspaces as Record<string, unknown>;
    Object.assign(catalog, asMap(ws["catalog"]));
    const named = asMap(ws["catalogs"]);
    for (const [k, v] of Object.entries(named)) {
      if (v && typeof v === "object") catalogs[k] = v as Record<string, string>;
    }
  }
  Object.assign(catalog, asMap(pkg["catalog"]));
  const topNamed = asMap(pkg["catalogs"]);
  for (const [k, v] of Object.entries(topNamed)) {
    if (v && typeof v === "object") catalogs[k] = v as Record<string, string>;
  }
  return { catalog, catalogs };
}

/** Walk up from cwd to the filesystem root, yielding each dir (cwd first). */
function walkUpDirs(start: string): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(start);
  for (;;) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** Nearest ancestor (incl. cwd) containing pnpm-workspace.yaml, else cwd itself. */
function findWorkspaceRoot(cwd: string): string {
  for (const dir of walkUpDirs(cwd)) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
  }
  return path.resolve(cwd);
}

/** Look up one package's version inside resolved catalog maps. */
function lookupCatalogEntry(
  packageName: string,
  spec: string,
  pnpm: { catalog: Record<string, string>; catalogs: Record<string, Record<string, string>> },
  bun: BunCatalogs,
): { version: string; source: string } | null {
  const named = catalogNameFromSpec(spec);
  const candidates: Array<{ raw: string | undefined; source: string }> = named
    ? [
        { raw: pnpm.catalogs[named]?.[packageName], source: `pnpm-workspace.yaml catalogs.${named}` },
        { raw: bun.catalogs[named]?.[packageName], source: `bun catalogs.${named}` },
      ]
    : [
        { raw: pnpm.catalog[packageName], source: "pnpm-workspace.yaml catalog" },
        { raw: bun.catalog[packageName], source: "bun catalog" },
      ];
  for (const c of candidates) {
    if (!c.raw) continue;
    const cleaned = cleanSemver(c.raw);
    if (cleaned) return { version: cleaned, source: c.source };
  }
  return null;
}

function readJsonIfExists<T>(p: string): T | null {
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Expand simple workspace globs (`packages/*`) into member dirs containing a package.json. */
function expandWorkspaceMembers(workspaceRoot: string, patterns: string[]): string[] {
  const members: string[] = [];
  for (const pattern of patterns) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      const dir = path.join(workspaceRoot, pattern);
      if (existsSync(path.join(dir, "package.json"))) members.push(dir);
      continue;
    }
    // Only `prefix/*` (single-level) is expanded — `**` globs fall back to a shallow scan.
    const prefix = pattern.slice(0, star).replace(/\/$/, "");
    const base = path.join(workspaceRoot, prefix);
    let entries: string[] = [];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const e of entries) {
      const dir = path.join(base, e);
      try {
        if (statSync(dir).isDirectory() && existsSync(path.join(dir, "package.json"))) members.push(dir);
      } catch {
        // ignore
      }
    }
  }
  return members;
}

function workspaceGlobs(workspaceRoot: string, rootPkg: Record<string, unknown>): string[] {
  const globs: string[] = [];
  // pnpm-workspace.yaml `packages:`
  try {
    const wsPath = path.join(workspaceRoot, "pnpm-workspace.yaml");
    if (existsSync(wsPath)) {
      const text = readFileSync(wsPath, "utf8");
      const m = text.match(/^packages:\s*\n((?:\s+-\s+.*\n?)+)/m);
      if (m?.[1]) {
        for (const line of m[1].split("\n")) {
          const item = line.match(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/);
          if (item?.[1]) globs.push(item[1]);
        }
      }
    }
  } catch {
    // ignore
  }
  // package.json `workspaces`
  const ws = rootPkg["workspaces"];
  if (Array.isArray(ws)) {
    for (const g of ws) if (typeof g === "string") globs.push(g);
  } else if (ws && typeof ws === "object") {
    const pkgs = (ws as Record<string, unknown>)["packages"];
    if (Array.isArray(pkgs)) for (const g of pkgs) if (typeof g === "string") globs.push(g);
  }
  return globs;
}

/**
 * Detects the version of `@wangs-ui/*` packages used by the project at `cwd`.
 * Priority:
 * 1. Installed `node_modules/@wangs-ui/<pkg>/package.json` — `cwd` first, then each
 *    ancestor up to the filesystem root (pnpm/bun monorepos hoist to the workspace root).
 * 2. `package.json` dependencies / devDependencies — plain semver wins immediately;
 *    pnpm/bun `catalog:` specs are resolved via `pnpm-workspace.yaml` (`catalog:` /
 *    `catalogs:`) and bun `workspaces.catalog` / `catalogs` maps.
 * 3. Workspace member `package.json` files (same semver-then-catalog logic) when `cwd`
 *    is a monorepo root whose own `package.json` carries no `@wangs-ui/*` dep.
 */
export function detectProjectWangsUiVersion(cwd: string): WangsUiVersionInfo | null {
  // 1. Check installed package.json in node_modules (cwd + ancestors for monorepos)
  for (const dir of walkUpDirs(cwd)) {
    for (const pkg of WANGS_UI_CANDIDATE_PACKAGES) {
      const pkgPath = path.join(dir, "node_modules", "@wangs-ui", pkg, "package.json");
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
  }

  // Only the UI-component-library candidates below select the @wangs-ui/mcp version —
  // NOT every `@wangs-ui/*`-named package. `@wangs-ui/skills` in particular (the
  // skill-installer CLI, see skills-sync.ts) is a real, common `@wangs-ui/*` dependency
  // whose version must never leak into an `npx @wangs-ui/mcp@<version>` command.
  const workspaceRoot = findWorkspaceRoot(cwd);
  const rootPkg =
    readJsonIfExists<Record<string, unknown>>(path.join(path.resolve(cwd), "package.json")) ??
    readJsonIfExists<Record<string, unknown>>(path.join(workspaceRoot, "package.json")) ??
    {};
  const rootPkgDeps = {
    ...(rootPkg["dependencies"] as Record<string, string> | undefined),
    ...(rootPkg["devDependencies"] as Record<string, string> | undefined),
  };

  let pnpm = { catalog: {} as Record<string, string>, catalogs: {} as Record<string, Record<string, string>> };
  try {
    const wsPath = path.join(workspaceRoot, "pnpm-workspace.yaml");
    if (existsSync(wsPath)) pnpm = parsePnpmCatalogs(readFileSync(wsPath, "utf8"));
  } catch {
    // Ignore — bun catalogs below may still resolve the spec.
  }
  const bun = readBunCatalogs(rootPkg);

  // Deferred `catalog:` hits: plain semver always wins over a catalog lookup, so a
  // `catalog:` dep only resolves when no plain semver was found for any candidate.
  const catalogHits: Array<{ name: string; spec: string; memberDir?: string }> = [];

  const inspectDeps = (deps: Record<string, string | undefined>, memberDir?: string): WangsUiVersionInfo | null => {
    for (const candidate of WANGS_UI_CANDIDATE_PACKAGES) {
      const name = `@wangs-ui/${candidate}`;
      const rawVersion = deps[name];
      if (!rawVersion) continue;
      const cleaned = cleanSemver(rawVersion);
      if (cleaned) {
        return { version: cleaned, source: memberDir ? `${name} (${memberDir}/package.json)` : `${name} (package.json)` };
      }
      // `workspace:*`, `link:`, `portal:` etc. stay rejected — only `catalog:` is resolvable
      // without installing (its version lives in pnpm-workspace.yaml / bun catalog maps).
      if (isCatalogSpec(rawVersion)) catalogHits.push({ name, spec: rawVersion, memberDir });
    }
    return null;
  };

  // 2. Root package.json first (plain semver wins immediately).
  const direct = inspectDeps(rootPkgDeps);
  if (direct) return direct;

  // 3. Workspace members (monorepo root itself often has no @wangs-ui/* dep).
  try {
    const globs = workspaceGlobs(workspaceRoot, rootPkg);
    if (globs.length > 0) {
      for (const memberDir of expandWorkspaceMembers(workspaceRoot, globs)) {
        const memberPkg = readJsonIfExists<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
          path.join(memberDir, "package.json"),
        );
        if (!memberPkg) continue;
        const hit = inspectDeps({ ...memberPkg.dependencies, ...memberPkg.devDependencies }, path.relative(workspaceRoot, memberDir) || ".");
        if (hit) return hit;
      }
    }
  } catch {
    // Ignore — catalog fallback below may still resolve.
  }

  // 4. Resolve deferred `catalog:` specs (root first, then members, in encounter order).
  for (const hit of catalogHits) {
    const resolved = lookupCatalogEntry(hit.name, hit.spec, pnpm, bun);
    if (resolved) {
      const where = hit.memberDir ? `${hit.memberDir}/package.json via ${resolved.source}` : `package.json via ${resolved.source}`;
      return { version: resolved.version, source: `${hit.name} (${where})` };
    }
  }

  return null;
}

/**
 * Resolves the target registry URL for @wangs-ui packages:
 * 1. WANGS_CODE_REGISTRY environment variable
 * 2. .npmrc registry= or @wangs-ui:registry= (checked in cwd, PACKAGE_ROOT, and ~/.npmrc)
 * 3. "publishRegistry" field from wangscode package.json
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
// Confirmed via a real SDK session (not assumed): unlike an unreachable HTTP MCP server, which
// fails fast and non-blocking (the session still starts, that server just shows "failed"), a stdio
// server whose spawn command hangs — `npx` retrying against a dead registry with npm's own default
// fetch timeout/retry backoff — blocks the WHOLE session indefinitely. A real repro against this
// registry down (192.168.1.102:4873 was actually unreachable when this was found) never even
// produced the session's own `init` message within 30s. These env vars make npm give up in ~3s
// instead, which is enough for the session to start normally with wangs-ui simply marked "failed" —
// verified: the same repro with these vars set reaches `init` at ~7s with `wangs-ui` correctly
// "failed", and the turn completes normally.
const NPX_FAST_FAIL_ENV: Record<string, string> = {
  npm_config_fetch_timeout: "3000",
  npm_config_fetch_retries: "0",
  npm_config_fetch_retry_mintimeout: "500",
  npm_config_fetch_retry_maxtimeout: "1000",
};

export function resolveWangsUiMcpServer(cwd: string): McpServerConfig | null {
  const info = detectProjectWangsUiVersion(cwd);
  if (!info) return null;

  const registry = getMcpTargetRegistry(cwd);
  // McpStdioServerConfig spawns without inheriting the parent process's env unless it's passed
  // explicitly (confirmed by mcp-tools.ts's own fetchStdioMcpTools doing the same) — filter out
  // undefined values first since process.env's type allows them but Record<string, string> doesn't.
  const parentEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));

  return {
    type: "stdio",
    command: "npx",
    args: ["-y", ...(registry ? [`--registry=${registry}`] : []), `@wangs-ui/mcp@${info.version}`],
    env: { ...parentEnv, ...NPX_FAST_FAIL_ENV },
  };
}
