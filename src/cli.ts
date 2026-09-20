#!/usr/bin/env bun
// Bun, not node: the terminal UI (@opentui/core) loads a native FFI binding that only
// initializes under Bun's runtime today — confirmed directly ("OpenTUI native FFI is not
// available for this runtime yet" under plain `node`, real ANSI rendering under `bun`), not a
// version gate (bumping engines.node further doesn't fix it). This shebang is the actual
// enforcement — npm's bin symlink runs whatever interpreter this line names on Unix. Known gap:
// npm on Windows generates a .cmd wrapper that always calls `node` regardless of shebang, so this
// script does not run as a global bin on Windows yet.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runRepl } from "./repl.tsx";
import { PACKAGE_ROOT } from "./package-root.ts";

const HELP = `wangs-agent — standalone interactive chat CLI for Wangs Foundation projects

Requires Bun (https://bun.sh) — the terminal UI's native binding only runs under Bun's runtime.

Usage:
  wangs-agent [--project=<path>]
  wangs-agent --update | -u
  wangs-agent --version | -v
  wangs-agent --help | -h

Starts an interactive chat session in the terminal. Behaves like a general
coding assistant; type /create-feature to run the deterministic, gated
feature-build pipeline instead of freeform judgment.

Run from the root of (or pass --project= pointing at) a project that follows
the Wangs Foundation convention: packages/core, packages/infrastructure,
packages/features/*, two layers only.`;

function parseProjectFlag(argv: string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith("--project="));
  return hit ? hit.slice("--project=".length) : undefined;
}

// Reads from PACKAGE_ROOT at runtime rather than a static `import ... from "../package.json"` —
// PACKAGE_ROOT already resolves correctly in both dev (`bun src/cli.ts`) and the tsdown-bundled
// prod build (see package-root.ts's own comment on why naive relative-depth resolution breaks
// between the two), so this stays correct for free instead of relying on the bundler to inline a
// JSON import consistently across bun/tsdown/tsc. Also backs --update below, which re-reads this
// same file after `npm install -g` overwrites it in place, to report what it actually landed on.
function readPackageJson(): { name: string; version: string } {
  const raw = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
  return JSON.parse(raw) as { name: string; version: string };
}

// Shells out to the same `npm install -g <pkg>@latest` a user would run by hand — deliberately not
// hardcoding a registry URL (e.g. the local Verdaccio one this project happens to publish to
// during development) so this keeps working unchanged once wangs-agent moves to a real registry;
// npm already resolves whatever registry the user has configured. `stdio: "inherit"` streams npm's
// own real progress/output straight through rather than re-implementing it.
function selfUpdate(): void {
  const pkg = readPackageJson();
  console.log(`Updating ${pkg.name} (currently ${pkg.version})...\n`);

  try {
    execFileSync("npm", ["install", "-g", `${pkg.name}@latest`], { stdio: "inherit" });
  } catch (err) {
    console.error(`\nUpdate failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const updated = readPackageJson();
  console.log(
    updated.version === pkg.version ? `\nAlready on the latest version (${updated.version}).` : `\nUpdated to ${updated.name}@${updated.version}.`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--update") || argv.includes("-u")) {
    selfUpdate();
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(readPackageJson().version);
    return;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  // Catches the two real ways this ends up running under node instead of bun despite the
  // shebang: an explicit `node dist/cli.mjs`, or npm's Windows .cmd wrapper (which always calls
  // node, ignoring the shebang). Fails with a clear message instead of the terminal UI's own
  // cryptic native-FFI stack trace.
  if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
    console.error("wangs-agent requires Bun (https://bun.sh) — run it with `bun wangs-agent` or `bunx wangs-agent`, not `node`.");
    process.exit(1);
  }

  const projectFlag = parseProjectFlag(argv);
  const cwd = projectFlag ? path.resolve(projectFlag) : process.cwd();

  await runRepl({ cwd });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
