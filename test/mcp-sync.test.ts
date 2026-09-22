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
        expect(config).toEqual({
          type: "stdio",
          command: "npx",
          args: ["-y", "--registry=http://registry.example/", "@wangs-ui/mcp@1.0.64"],
        });
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
