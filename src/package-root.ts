import path from "node:path";
import { fileURLToPath } from "node:url";

// This file must live directly in src/ (not a subdirectory) — one level below the package root in
// both dev (`bun src/cli.ts`, unbundled — src/ files sit at their real, nested source depth) and
// prod (tsdown bundles every entry point into flat chunk files directly under dist/, regardless of
// original source depth — see dist/repl-*.mjs). "One level up" from this file's own location is
// correct in both cases only because this file itself lives one level deep in both. Any module
// needing the package root should import PACKAGE_ROOT from here rather than recomputing its own
// relative depth via `import.meta.url` — that broke for a module added under src/pipeline/ (two
// levels deep in source, but flattened to one level once bundled), which worked when run via `bun
// src/cli.ts` and silently resolved outside the package entirely once built.
export const PACKAGE_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
