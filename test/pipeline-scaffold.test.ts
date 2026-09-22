import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { scaffoldFeaturePackage } from "../src/pipeline/scaffold.ts";

function makeFixtureProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "wangs-scaffold-test-"));
  mkdirSync(path.join(root, "packages", "core", "routes"), { recursive: true });
  writeFileSync(
    path.join(root, "packages", "core", "routes", "index.ts"),
    `import { staticRoute } from "@wangs-ui/react-navigation";\n\nexport const CatalogList = staticRoute("catalog");\n`,
    "utf8",
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      { files: [], references: [{ path: "./packages/core" }, { path: "./packages/features/catalog" }, { path: "./apps/web" }] },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return root;
}

describe("scaffoldFeaturePackage", () => {
  test("creates the full two-layer skeleton", () => {
    const root = makeFixtureProject();
    try {
      const result = scaffoldFeaturePackage(root, "@wangs-foundation", "asset-tracking");
      expect(result.created).toBe(true);

      const pkgJson = JSON.parse(readFileSync(path.join(result.targetDir, "package.json"), "utf8")) as {
        name: string;
        dependencies: Record<string, string>;
      };
      expect(pkgJson.name).toBe("@wangs-foundation/feature-asset-tracking");
      expect(pkgJson.dependencies["@wangs-foundation/core"]).toBe("workspace:*");
      expect(pkgJson.dependencies["@wangs-ui/react-navigation"]).toBe("catalog:");

      expect(readFileSync(path.join(result.targetDir, "tsconfig.json"), "utf8")).toContain('"jsx": "react-jsx"');
      expect(readFileSync(path.join(result.targetDir, "data", "dto", "index.ts"), "utf8")).toContain("AssetTrackingItemDto");
      expect(readFileSync(path.join(result.targetDir, "data", "datasource", "AssetTrackingRemoteDataSource.ts"), "utf8")).toContain(
        "@wangs-foundation/infrastructure/http",
      );
      expect(readFileSync(path.join(result.targetDir, "ui", "screens", "AssetTracking", "AssetTracking.tsx"), "utf8")).toContain(
        "export function AssetTracking()",
      );
      expect(readFileSync(path.join(result.targetDir, "index.ts"), "utf8")).toContain("featureAssetTrackingGraph");

      const routes = readFileSync(path.join(root, "packages", "core", "routes", "index.ts"), "utf8");
      expect(routes).toContain('export const AssetTracking = staticRoute("asset-tracking");');

      const tsconfig = JSON.parse(readFileSync(path.join(root, "tsconfig.json"), "utf8")) as { references: Array<{ path: string }> };
      const paths = tsconfig.references.map((r) => r.path);
      expect(paths).toContain("./packages/features/asset-tracking");
      // Inserted right after the last existing feature reference, before apps/*.
      expect(paths.indexOf("./packages/features/asset-tracking")).toBe(paths.indexOf("./packages/features/catalog") + 1);
      expect(paths.indexOf("./packages/features/asset-tracking")).toBeLessThan(paths.indexOf("./apps/web"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is idempotent — a no-op when the feature package already exists", () => {
    const root = makeFixtureProject();
    try {
      const first = scaffoldFeaturePackage(root, "@wangs-foundation", "catalog");
      expect(first.created).toBe(true);

      // Mutate a generated file to prove the second call doesn't touch it.
      writeFileSync(path.join(first.targetDir, "data", "dto", "index.ts"), "// hand-edited, don't clobber\n", "utf8");

      const second = scaffoldFeaturePackage(root, "@wangs-foundation", "catalog");
      expect(second.created).toBe(false);
      expect(readFileSync(path.join(first.targetDir, "data", "dto", "index.ts"), "utf8")).toBe("// hand-edited, don't clobber\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
