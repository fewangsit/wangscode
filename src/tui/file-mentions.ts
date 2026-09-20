// Caps how many directory-entries a single scan inspects before giving up, so a rarely-matching
// fragment in a huge repo can't stall the input on every keystroke. Not a requirement in the
// plan's own words ("gitignore-aware is a stretch goal, not a requirement for v1") — this cap is
// the same spirit applied to raw scan volume instead.
const MAX_FILES_SCANNED = 5000;

// `Bun.Glob`'s `dot: false` only excludes dot-files/dot-directories (.git, .cache, ...) — it does
// NOT skip node_modules, build output, etc. Left unfiltered, a real JS/TS project's node_modules
// alone would exhaust MAX_FILES_SCANNED before the scan ever reaches anything under src/, since
// "node_modules" sorts before most project directories. True gitignore-awareness is a stretch
// goal (per the plan), but skipping these well-known noise directories is basic usability, not a
// stretch — every comparable file-picker (VS Code's Quick Open, fzf, Claude Code's own @-mention)
// does the same by default.
const EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache", "out"]);

function isExcluded(relativePath: string): boolean {
  const firstSegment = relativePath.split("/", 1)[0];
  return firstSegment !== undefined && EXCLUDED_DIRS.has(firstSegment);
}

/** `@`-mention source: Bun's own built-in glob (`Bun.Glob`), no extra dependency needed. */
export async function listFileMentions(cwd: string, fragment: string, limit = 10): Promise<string[]> {
  const glob = new Bun.Glob("**/*");
  const needle = fragment.toLowerCase();
  const results: string[] = [];
  let scanned = 0;

  for await (const file of glob.scan({ cwd, dot: false })) {
    if (isExcluded(file)) continue;
    if (++scanned > MAX_FILES_SCANNED) break;
    if (needle.length === 0 || file.toLowerCase().includes(needle)) {
      results.push(file);
      if (results.length >= limit) break;
    }
  }

  return results;
}
