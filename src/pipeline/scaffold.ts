// Deterministic feature-package scaffolding — equivalent to the `pnpm create-feature` script every
// Wangs Foundation project used to run by hand before `/create-feature` could do anything, now
// folded straight into the pipeline as its own zero-model-call step. Kept fully deterministic on
// purpose (this repo's own package.json description: "real command gates, never model
// self-judgment") — package.json/tsconfig.json/tsdown.config.ts boilerplate must be byte-identical
// across every feature; that's exactly the kind of mechanical work an LLM shouldn't be trusted to
// reproduce exactly the same way every single time, not a judgment call worth spending a model turn
// on. See rules/architecture-overview.md, rules/packages.md, rules/feature-pattern.md for the
// conventions this mirrors.
import fs from "node:fs";
import path from "node:path";

function toWords(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const toPascalCase = (words: string[]): string => words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const toUpperSnakeCase = (words: string[]): string => words.map((w) => w.toUpperCase()).join("_");
const toHeadlineCase = (words: string[]): string => words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export interface ScaffoldResult {
  /** false when the feature package already existed — scaffold is then a pure no-op, not an error
   *  (every resumed pipeline call reaches this again; only the very first call actually creates
   *  anything, and a developer who scaffolded by hand before this phase existed is left untouched). */
  created: boolean;
  targetDir: string;
}

/** Inserts a new `{ path: "./packages/features/<slug>" }` reference into the root tsconfig.json's
 *  project-references array, right after the last existing `packages/features/*` entry (or right
 *  before the first `apps/*` entry if there are no feature references yet) — matching where a human
 *  adding a new feature by hand would put it. A no-op if the reference is already there, or if the
 *  root tsconfig.json doesn't have this exact `references` array shape (an unusual project layout
 *  this generic scaffold doesn't try to guess at). */
function registerTsconfigReference(repoRoot: string, featureSlug: string): void {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return;

  let parsed: { references?: Array<{ path: string }> };
  try {
    parsed = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as typeof parsed;
  } catch {
    return; // Malformed or unusual tsconfig.json — don't guess, leave it alone.
  }
  if (!Array.isArray(parsed.references)) return;

  const newRef = `./packages/features/${featureSlug}`;
  if (parsed.references.some((r) => r.path === newRef)) return;

  const lastFeatureIdx = parsed.references.reduce((last, r, i) => (r.path.startsWith("./packages/features/") ? i : last), -1);
  const insertAt =
    lastFeatureIdx >= 0 ? lastFeatureIdx + 1 : (parsed.references.findIndex((r) => r.path.startsWith("./apps/")) ?? parsed.references.length);
  const at = insertAt === -1 ? parsed.references.length : insertAt;
  parsed.references.splice(at, 0, { path: newRef });

  fs.writeFileSync(tsconfigPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}

/**
 * Creates `packages/features/<featureSlug>/` with the standard two-layer skeleton (package.json,
 * tsconfig.json, tsdown.config.ts, resources/Strings.ts, data/, ui/, e2e/) plus placeholder content
 * for the DTO/DataSource/ViewModel/Screen files the data-layer/ui-slice phases will overwrite with
 * real content once they run. Also appends this feature's route to packages/core/routes/index.ts
 * (`staticRoute(featureSlug)`) and registers the new package in the root tsconfig.json's project
 * references — both real, easy-to-forget mechanical steps, not something worth leaving to whoever
 * runs the pipeline to remember by hand.
 *
 * `scope` is the target project's own npm scope (e.g. "@wangs-foundation"), detected once per
 * pipeline run via project-conventions.ts's `detectPackageScope` — never hardcoded, since this
 * pipeline is meant to work against any project following the Wangs Foundation convention, not just
 * one specific monorepo.
 */
export function scaffoldFeaturePackage(repoRoot: string, scope: string, featureSlug: string): ScaffoldResult {
  const targetDir = path.join(repoRoot, "packages", "features", featureSlug);
  if (fs.existsSync(targetDir)) {
    return { created: false, targetDir };
  }

  const words = toWords(featureSlug);
  const pascalName = toPascalCase(words);
  const upperSnakeName = toUpperSnakeCase(words);
  const headlineName = toHeadlineCase(words);
  const kebabName = featureSlug;

  const directories = [
    targetDir,
    path.join(targetDir, "resources"),
    path.join(targetDir, "data"),
    path.join(targetDir, "data", "datasource"),
    path.join(targetDir, "data", "dto"),
    path.join(targetDir, "ui"),
    path.join(targetDir, "ui", "components"),
    path.join(targetDir, "ui", "screens", pascalName),
    path.join(targetDir, "e2e", "page-objects"),
    path.join(targetDir, "e2e", "specs", pascalName),
    path.join(targetDir, "e2e", "fixtures"),
  ];
  for (const dir of directories) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: `${scope}/feature-${kebabName}`,
        version: "0.0.1",
        private: true,
        type: "module",
        main: "./dist/index.js",
        exports: {
          ".": {
            source: "./index.ts",
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            default: "./dist/index.js",
          },
        },
        scripts: { build: "tsdown" },
        dependencies: {
          [`${scope}/assets`]: "workspace:*",
          [`${scope}/core`]: "workspace:*",
          [`${scope}/infrastructure`]: "workspace:*",
          "@wangs-ui/foundation": "catalog:",
          "@wangs-ui/react-core": "catalog:",
          "@wangs-ui/react-i18n": "catalog:",
          "@wangs-ui/react-icons": "catalog:",
          "@wangs-ui/react-navigation": "catalog:",
        },
      },
      null,
      2,
    ) + "\n",
  );

  fs.writeFileSync(
    path.join(targetDir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../../tsconfig.base.json",
        compilerOptions: {
          outDir: "./dist",
          rootDir: ".",
          declaration: true,
          noEmit: false,
          jsx: "react-jsx",
        },
        include: ["**/*"],
        // "e2e" is TestSpectra's own separate Nx e2e-project (its own project.json/tsconfig,
        // registered independently — see the e2e/project.json written below), not part of this
        // package's own TS project. "tsdown.config.ts" imports ../../../tsdown.base.ts, which sits
        // outside this package's rootDir — a real error caught by testing this scaffold end-to-end
        // (tsc -b) against a real project, not present in the original hand-written create-feature.mjs
        // this was ported from (only visible once you actually try to build a freshly scaffolded
        // package rather than assume the template was already correct).
        exclude: ["dist", "node_modules", "**/*.spec.ts", "**/*.test.ts", "e2e", "tsdown.config.ts"],
      },
      null,
      2,
    ) + "\n",
  );

  fs.writeFileSync(
    path.join(targetDir, "tsdown.config.ts"),
    `import { definePackageConfig } from "../../../tsdown.base.ts";\n\nexport default definePackageConfig({\n  entry: ["index.ts"],\n});\n`,
  );

  fs.writeFileSync(
    path.join(targetDir, "resources", "Strings.ts"),
    `const Strings = {\n  TITLE_${upperSnakeName}: "${headlineName}",\n  ACTION_SUBMIT: "Submit",\n  ERROR_GENERIC: "Something went wrong. Please try again.",\n} as const;\n\nexport default Strings;\n`,
  );

  fs.writeFileSync(
    path.join(targetDir, "data", "dto", "index.ts"),
    `// Source: <method> <path> — openapi.yaml (filled in by the data-layer phase)\nexport interface ${pascalName}ItemDto {\n  id: string;\n  name: string;\n  createdAt: string;\n}\n`,
  );

  fs.writeFileSync(
    path.join(targetDir, "data", "datasource", `${pascalName}RemoteDataSource.ts`),
    `import { http } from "${scope}/infrastructure/http";\n\nimport type { ${pascalName}ItemDto } from "../dto";\n\nexport const get${pascalName}Items = async (): Promise<${pascalName}ItemDto[]> => {\n  const res = await http.get<${pascalName}ItemDto[]>("/v1/${kebabName}");\n  return res.data;\n};\n`,
  );

  fs.writeFileSync(path.join(targetDir, "data", "index.ts"), `export * from "./datasource/${pascalName}RemoteDataSource";\nexport * from "./dto";\n`);

  fs.writeFileSync(
    path.join(targetDir, "ui", "screens", pascalName, `use${pascalName}ViewModel.ts`),
    `import { useEffect, useState } from "react";\nimport { useI18n } from "@wangs-ui/react-i18n";\n\nimport { get${pascalName}Items } from "../../../data";\nimport type { ${pascalName}ItemDto } from "../../../data";\nimport Strings from "../../../resources/Strings";\n\nexport function use${pascalName}ViewModel() {\n  const { t } = useI18n();\n  const [items, setItems] = useState<${pascalName}ItemDto[]>([]);\n  const [isLoading, setIsLoading] = useState(false);\n  const [errorMessage, setErrorMessage] = useState<string | null>(null);\n\n  useEffect(() => {\n    let isMounted = true;\n\n    const load = async (): Promise<void> => {\n      setIsLoading(true);\n      try {\n        const data = await get${pascalName}Items();\n        if (isMounted) setItems(data);\n      } catch (err: unknown) {\n        if (isMounted) setErrorMessage(err instanceof Error ? err.message : t(Strings.ERROR_GENERIC));\n      } finally {\n        if (isMounted) setIsLoading(false);\n      }\n    };\n    void load();\n\n    return () => {\n      isMounted = false;\n    };\n  }, [t]);\n\n  return {\n    items,\n    isLoading,\n    errorMessage,\n    labels: { title: t(Strings.TITLE_${upperSnakeName}) },\n  };\n}\n`,
  );

  fs.writeFileSync(
    path.join(targetDir, "ui", "screens", pascalName, `${pascalName}.tsx`),
    `import { Text } from "@wangs-ui/foundation/theme";\n\nimport { use${pascalName}ViewModel } from "./use${pascalName}ViewModel";\n\n// Top-level screen — no props (rules/feature-pattern.md).\nexport function ${pascalName}() {\n  const vm = use${pascalName}ViewModel();\n\n  return (\n    <div className="flex flex-col gap-2 p-6">\n      <Text variant="titleMedium" aria-label="${kebabName}-title" className="font-bold text-on-surface">\n        {vm.labels.title}\n      </Text>\n      {vm.errorMessage && (\n        <Text variant="bodySmall" aria-label="${kebabName}-error-message" className="font-medium text-primary-500">\n          {vm.errorMessage}\n        </Text>\n      )}\n    </div>\n  );\n}\n`,
  );

  // Route value lives in core (features navigate by route, never import each other's screens) —
  // same place every other feature's routes are declared. Appended, not overwritten — a real
  // project's routes/index.ts already has other features' routes in it.
  const routesPath = path.join(repoRoot, "packages", "core", "routes", "index.ts");
  if (fs.existsSync(routesPath)) {
    const routesSource = fs.readFileSync(routesPath, "utf8");
    if (!routesSource.includes(`export const ${pascalName} `)) {
      fs.appendFileSync(routesPath, `\nexport const ${pascalName} = staticRoute("${kebabName}");\n`);
    }
  }

  fs.writeFileSync(
    path.join(targetDir, "index.ts"),
    `import React from "react";\n\nimport { buildGraph, composable, type Graph } from "@wangs-ui/react-navigation";\n\nimport { ${pascalName} } from "${scope}/core/routes";\n\nconst ${pascalName}Screen = React.lazy(async () => {\n  const m = await import("./ui/screens/${pascalName}/${pascalName}");\n  return { default: m.${pascalName} };\n});\n\nexport function feature${pascalName}Graph(graph: Graph): Graph {\n  return buildGraph(graph, composable(${pascalName}, ${pascalName}Screen));\n}\n`,
  );

  fs.writeFileSync(
    path.join(targetDir, "e2e", "project.json"),
    JSON.stringify(
      {
        name: `feature-${kebabName}-e2e`,
        $schema: "../../../../node_modules/nx/schemas/project-schema.json",
        projectType: "application",
        sourceRoot: `packages/features/${kebabName}/e2e`,
        targets: {
          e2e: {
            executor: "nx:run-commands",
            options: { command: "spectra run", cwd: `packages/features/${kebabName}/e2e` },
            configurations: {
              android: { command: "spectra run --target android" },
              ios: { command: "spectra run --target ios" },
              headless: { command: "spectra run --headless" },
            },
          },
        },
        tags: ["testspectra:e2e", `testspectra:scope:feature-${kebabName}`],
      },
      null,
      2,
    ) + "\n",
  );

  registerTsconfigReference(repoRoot, featureSlug);

  return { created: true, targetDir };
}
