import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Packages that ship their own installable Claude-Code-style skills (SKILL.md bundles) via a
 * `loadAllSkills()` export — TestSpectra's own script-authoring conventions and Wangs UI's own
 * component conventions are both "part of what makes this agent succeed" (the user's own framing),
 * not something a project should hand-manage or commit. Add a new provider here to pick it up the
 * same way.
 */
interface SkillProviderPackage {
  /** Scoped npm package name, e.g. "@testspectra/skills". */
  packageName: string;
  /** Short label for status messages. */
  label: string;
}

const SKILL_PROVIDER_PACKAGES: SkillProviderPackage[] = [
  { packageName: "@testspectra/skills", label: "TestSpectra" },
  { packageName: "@wangs-ui/skills", label: "Wangs UI" },
];

interface SkillItem {
  id: string;
  name: string;
  description: string;
  content: string;
}

// The user's GLOBAL skill root (`~/.claude/skills/<id>/SKILL.md`) — not the project's own
// `.claude/skills/`. Deliberately not per-project: these skills aren't project-specific content
// (they're generic "how TestSpectra/Wangs UI conventions work" documents bundled inside the npm
// package itself), so writing them into the project repo would mean either committing generated,
// package-derived content or having to remember to gitignore it. Installing once, globally,
// avoids both — nothing ever lands inside any project's git tree, and every project that has
// wangs-code + the provider package installed benefits from the same synced skill without
// re-installing per repo.
const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

/** True if `<baseDir>/node_modules/<packageName>` is a real, physically installed package. */
function resolveInstalledPackageDir(baseDir: string, packageName: string): string | null {
  const dir = path.join(baseDir, "node_modules", ...packageName.split("/"));
  return fs.existsSync(path.join(dir, "package.json")) ? dir : null;
}

// On-demand fetch target for a provider NOT installed in the current project — a wangs-code-owned
// cache, not the project's own node_modules, so this never touches the project's package.json or
// lockfile. Reused across projects/sessions: once `@testspectra/skills` has been fetched here for
// any project, `/doctor` in a project that never installed it directly still finds it instantly.
const SKILL_PROVIDER_CACHE_ROOT = path.join(os.homedir(), ".cache", "wangs-code", "skill-providers");

function cacheInstallDirFor(packageName: string): string {
  return path.join(SKILL_PROVIDER_CACHE_ROOT, packageName.replace("/", "__"));
}

/** Runs `npm install --prefix <cache dir> <packageName>@latest` into the on-demand cache, isolated
 *  from any project. Returns the installed package's directory, or null if the install failed
 *  (offline, package unpublished, npm missing, etc. — callers treat this as "not found", not a
 *  thrown error, since it's an expected outcome worth reporting plainly rather than crashing over). */
async function fetchProviderToCache(packageName: string): Promise<string | null> {
  const installDir = cacheInstallDirFor(packageName);
  fs.mkdirSync(installDir, { recursive: true });

  try {
    await execFileAsync("npm", ["install", "--prefix", installDir, "--no-save", "--no-audit", "--no-fund", `${packageName}@latest`], {
      timeout: 60_000,
    });
  } catch {
    return null;
  }

  const pkgDir = path.join(installDir, "node_modules", ...packageName.split("/"));
  return fs.existsSync(path.join(pkgDir, "package.json")) ? pkgDir : null;
}

interface ProviderResolution {
  pkgDir: string;
  source: "project" | "cache";
}

/**
 * Locates a usable copy of a skill-provider package: the project's own install first (fast, no
 * network), then a previously on-demand-fetched cache copy, then — only when `allowFetch` is true —
 * a fresh on-demand fetch into that cache. `allowFetch` is false for the silent startup sync (never
 * block/slow down opening wangs-code on a network call) and true for `/doctor` (an explicit,
 * user-triggered "make sure everything's set up" action, where waiting on a fetch is expected).
 */
async function resolveProviderDir(cwd: string, packageName: string, allowFetch: boolean): Promise<ProviderResolution | null> {
  const projectDir = resolveInstalledPackageDir(cwd, packageName);
  if (projectDir) return { pkgDir: projectDir, source: "project" };

  const cachedDir = resolveInstalledPackageDir(cacheInstallDirFor(packageName), packageName);
  if (cachedDir) return { pkgDir: cachedDir, source: "cache" };

  if (!allowFetch) return null;

  const fetchedDir = await fetchProviderToCache(packageName);
  return fetchedDir ? { pkgDir: fetchedDir, source: "cache" } : null;
}

export interface SkillSyncResult {
  label: string;
  packageName: string;
  /** Where the package that produced `installedSkillIds` was found — absent when not found at all. */
  source?: "project" | "cache";
  installedSkillIds: string[];
  error?: string;
}

/** Loads a resolved provider package's bundled skills (via its own `loadAllSkills()` export — the
 *  same function its own CLI uses) and writes each one straight into `~/.claude/skills/<id>/SKILL.md`,
 *  overwriting whatever was there before.
 *
 *  Deliberately bypasses each provider's own `detector.ts`/`installSkill()` machinery — that's
 *  built around project-relative agent directories (`.claude/skills` under a chosen `baseDir`), with
 *  no built-in option to target the user's home directory instead, so it isn't reusable for the
 *  global-install behavior this needs. `loadAllSkills()` is the one export both known providers
 *  ship for getting at the raw skill content directly. */
async function installSkillsFromPackageDir(pkgDir: string): Promise<{ installedSkillIds: string[]; error?: string }> {
  const entryPath = path.join(pkgDir, "dist", "index.js");
  if (!fs.existsSync(entryPath)) {
    return { installedSkillIds: [], error: "dist/index.js not found" };
  }

  try {
    const mod = (await import(pathToFileURL(entryPath).href)) as { loadAllSkills?: () => SkillItem[] };
    if (typeof mod.loadAllSkills !== "function") {
      return { installedSkillIds: [], error: "package does not export loadAllSkills()" };
    }

    const installedSkillIds: string[] = [];
    for (const skill of mod.loadAllSkills()) {
      const destDir = path.join(GLOBAL_SKILLS_DIR, skill.id);
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, "SKILL.md"), skill.content, "utf8");
      installedSkillIds.push(skill.id);
    }
    return { installedSkillIds };
  } catch (err) {
    return { installedSkillIds: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function syncProviders(cwd: string, allowFetch: boolean): Promise<SkillSyncResult[]> {
  const results: SkillSyncResult[] = [];

  for (const provider of SKILL_PROVIDER_PACKAGES) {
    const resolution = await resolveProviderDir(cwd, provider.packageName, allowFetch);
    if (!resolution) {
      results.push({ ...provider, installedSkillIds: [] });
      continue;
    }

    const { installedSkillIds, error } = await installSkillsFromPackageDir(resolution.pkgDir);
    results.push({ ...provider, source: resolution.source, installedSkillIds, error });
  }

  return results;
}

/**
 * Fast path: syncs skills for every known provider that's already physically installed in the
 * current project — no network calls, safe to run on every wangs-code startup (see repl.tsx's
 * `initChat()`). Keeps `~/.claude/skills` in sync with whatever version of the provider package
 * the current project has installed, the same way `@testspectra/skills update` would, without ever
 * blocking startup on a fetch.
 */
export function syncProjectSkillProviders(cwd: string): Promise<SkillSyncResult[]> {
  return syncProviders(cwd, false);
}

/**
 * Full path used by the `/doctor` command: same sync, but for a provider not installed in the
 * current project, fetches it on demand into a wangs-code-owned cache
 * (`~/.cache/wangs-code/skill-providers`) instead of skipping it — without touching the project's
 * own `package.json`/lockfile. An explicit, user-triggered action, so waiting on a network fetch
 * here is expected (unlike the silent startup sync above).
 */
export function syncSkillProvidersWithFetch(cwd: string): Promise<SkillSyncResult[]> {
  return syncProviders(cwd, true);
}
