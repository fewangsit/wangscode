import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { detectProjectWangsUiVersion, getMcpTargetRegistry, resolveWangsUiMcpServer } from "../src/mcp-sync.ts";

describe("mcp-sync", () => {
  describe("detectProjectWangsUiVersion", () => {
    test("detects version from installed node_modules package.json", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const coreDir = path.join(tempDir, "node_modules", "@wangs-ui", "react-core");
      mkdirSync(coreDir, { recursive: true });
      writeFileSync(path.join(coreDir, "package.json"), JSON.stringify({ version: "1.0.64" }), "utf8");

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("1.0.64");
        expect(result?.source).toBe("@wangs-ui/react-core (installed)");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("falls back to package.json dependencies and cleans semver prefixes", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: {
            "@wangs-ui/react-presets": "^1.2.3",
          },
        }),
        "utf8",
      );

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("1.2.3");
        expect(result?.source).toBe("@wangs-ui/react-presets (package.json)");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("returns null if no @wangs-ui packages are present", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: {
            react: "^19.0.0",
          },
        }),
        "utf8",
      );

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).toBeNull();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("resolves pnpm catalog: via pnpm-workspace.yaml default catalog", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@wangs-ui/react-core": "catalog:" } }), "utf8");
      writeFileSync(
        path.join(tempDir, "pnpm-workspace.yaml"),
        "packages:\n  - 'packages/*'\n\ncatalog:\n  '@wangs-ui/react-core': ^1.2.21\n",
        "utf8",
      );

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("1.2.21");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("resolves pnpm catalog:named via pnpm-workspace.yaml catalogs", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@wangs-ui/react-core": "catalog:ui" } }), "utf8");
      writeFileSync(path.join(tempDir, "pnpm-workspace.yaml"), "catalogs:\n  ui:\n    '@wangs-ui/react-core': 1.0.64\n", "utf8");

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("1.0.64");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("resolves bun catalog: via workspaces.catalog", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { "@wangs-ui/react-core": "catalog:" },
          workspaces: { packages: ["packages/*"], catalog: { "@wangs-ui/react-core": "^2.0.0" } },
        }),
        "utf8",
      );

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("2.0.0");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("detects @wangs-ui dep in a workspace member package.json", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const memberDir = path.join(tempDir, "packages", "web");
      mkdirSync(memberDir, { recursive: true });
      writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"] }), "utf8");
      writeFileSync(path.join(tempDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
      writeFileSync(path.join(memberDir, "package.json"), JSON.stringify({ dependencies: { "@wangs-ui/react-core": "^3.1.0" } }), "utf8");

      try {
        const result = detectProjectWangsUiVersion(tempDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("3.1.0");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("detects hoisted node_modules from a workspace member cwd", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const coreDir = path.join(tempDir, "node_modules", "@wangs-ui", "react-core");
      const memberDir = path.join(tempDir, "packages", "web");
      mkdirSync(coreDir, { recursive: true });
      mkdirSync(memberDir, { recursive: true });
      writeFileSync(path.join(coreDir, "package.json"), JSON.stringify({ version: "4.0.0" }), "utf8");
      writeFileSync(path.join(memberDir, "package.json"), JSON.stringify({ name: "web" }), "utf8");

      try {
        const result = detectProjectWangsUiVersion(memberDir);
        expect(result).not.toBeNull();
        expect(result?.version).toBe("4.0.0");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("still returns null for unresolvable workspace:* specs", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@wangs-ui/react-core": "workspace:*" } }), "utf8");

      try {
        expect(detectProjectWangsUiVersion(tempDir)).toBeNull();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("getMcpTargetRegistry", () => {
    test("respects WANGS_CODE_REGISTRY env var", () => {
      const prev = process.env.WANGS_CODE_REGISTRY;
      process.env.WANGS_CODE_REGISTRY = "http://custom-registry:4873/";
      try {
        expect(getMcpTargetRegistry("/nonexistent")).toBe("http://custom-registry:4873/");
      } finally {
        if (prev !== undefined) {
          process.env.WANGS_CODE_REGISTRY = prev;
        } else {
          delete process.env.WANGS_CODE_REGISTRY;
        }
      }
    });

    test("reads @wangs-ui:registry from project .npmrc", () => {
      const prev = process.env.WANGS_CODE_REGISTRY;
      delete process.env.WANGS_CODE_REGISTRY;
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, ".npmrc"), "@wangs-ui:registry=http://npmrc-registry:4873/\n", "utf8");

      try {
        expect(getMcpTargetRegistry(tempDir)).toBe("http://npmrc-registry:4873/");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
        if (prev !== undefined) process.env.WANGS_CODE_REGISTRY = prev;
      }
    });
  });

  describe("resolveWangsUiMcpServer", () => {
    test("returns null when @wangs-ui/* isn't installed in the project", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        expect(resolveWangsUiMcpServer(tempDir)).toBeNull();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("builds a stdio config pinned to the project's installed @wangs-ui/* version", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@wangs-ui/react-core": "1.0.64" } }), "utf8");

      const prev = process.env.WANGS_CODE_REGISTRY;
      process.env.WANGS_CODE_REGISTRY = "http://registry.example/";
      try {
        const config = resolveWangsUiMcpServer(tempDir);
        expect(config?.type).toBe("stdio");
        expect(config && "command" in config ? config.command : undefined).toBe("npx");
        expect(config && "args" in config ? config.args : undefined).toEqual(["-y", "--registry=http://registry.example/", "@wangs-ui/mcp@1.0.64"]);
        // Fast-fail env — a stdio server that hangs trying to reach a dead registry blocks the
        // WHOLE session (confirmed via a real SDK repro), unlike an unreachable HTTP server which
        // fails fast and non-blocking. These make npx give up in ~3s instead of hanging.
        const env = (config && "env" in config ? config.env : undefined) as Record<string, string> | undefined;
        expect(env?.npm_config_fetch_timeout).toBe("3000");
        expect(env?.npm_config_fetch_retries).toBe("0");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
        if (prev !== undefined) {
          process.env.WANGS_CODE_REGISTRY = prev;
        } else {
          delete process.env.WANGS_CODE_REGISTRY;
        }
      }
    });
  });
});
