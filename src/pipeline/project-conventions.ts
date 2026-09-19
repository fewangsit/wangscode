// This tool is not written for one repo — it targets any project that
// follows the "Wangs Foundation" convention (packages/core,
// packages/infrastructure, packages/features/*, two layers only). The one
// thing that legitimately varies between projects is the npm scope they
// publish their own internal packages under (@wangs-foundation/*,
// @acme/*, whatever a given project picked) — everything else in this tool
// reads that scope from the target project itself instead of assuming it.
import fs from "node:fs";
import path from "node:path";

export function detectPackageScope(repoRoot: string): string {
  const infraPkgPath = path.join(repoRoot, "packages", "infrastructure", "package.json");
  if (fs.existsSync(infraPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(infraPkgPath, "utf8")) as { name?: string };
    if (pkg.name?.startsWith("@") && pkg.name.includes("/")) {
      return pkg.name.split("/")[0]!;
    }
  }
  throw new Error(
    `Could not detect this project's package scope from packages/infrastructure/package.json under ${repoRoot}. ` +
      "wangs-agent's feature-build pipeline expects the Wangs Foundation convention (packages/core, packages/infrastructure, " +
      "packages/features/*, all published under one @scope) — run it from the root of a project that follows " +
      "that layout, or see the README for how to adapt it.",
  );
}
