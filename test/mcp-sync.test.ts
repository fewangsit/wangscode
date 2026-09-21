import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpServerStatus, Query } from "@anthropic-ai/claude-agent-sdk";

import {
  detectCurrentMcpVersion,
  detectProjectWangsUiVersion,
  getMcpTargetRegistry,
  syncWangsUiMcp,
  writeProjectMcpConfig,
} from "../src/mcp-sync.ts";

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

  describe("detectCurrentMcpVersion", () => {
    test("reads version from serverInfo when available", () => {
      const server: McpServerStatus = {
        name: "wangs-ui",
        status: "connected",
        serverInfo: { name: "wangs-ui", version: "1.0.64" },
      };
      expect(detectCurrentMcpVersion(server)).toBe("1.0.64");
    });

    test("extracts version from config args", () => {
      const server: McpServerStatus = {
        name: "wangs-ui",
        status: "connected",
        config: {
          command: "npx",
          args: ["-y", "--registry=http://192.168.1.102:4873/", "@wangs-ui/mcp@1.0.64"],
        },
      };
      expect(detectCurrentMcpVersion(server)).toBe("1.0.64");
    });

    test("detects latest when args contain unversioned @wangs-ui/mcp", () => {
      const server: McpServerStatus = {
        name: "wangs-ui",
        status: "connected",
        config: {
          command: "npx",
          args: ["-y", "@wangs-ui/mcp"],
        },
      };
      expect(detectCurrentMcpVersion(server)).toBe("latest");
    });

    test("returns null when no server or args present", () => {
      expect(detectCurrentMcpVersion(undefined)).toBeNull();
      const server: McpServerStatus = {
        name: "custom",
        status: "connected",
        config: { command: "node", args: ["server.js"] },
      };
      expect(detectCurrentMcpVersion(server)).toBeNull();
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

  describe("writeProjectMcpConfig", () => {
    test("creates new .mcp.json and preserves existing servers", () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });

      try {
        // First write
        writeProjectMcpConfig(tempDir, "existing-server", {
          command: "npx",
          args: ["-y", "existing-mcp"],
        });

        // Second write adding wangs-ui
        writeProjectMcpConfig(tempDir, "wangs-ui", {
          command: "npx",
          args: ["-y", "@wangs-ui/mcp@1.0.64"],
        });

        const content = JSON.parse(require("node:fs").readFileSync(path.join(tempDir, ".mcp.json"), "utf8")) as {
          mcpServers: Record<string, { command: string; args: string[] }>;
        };

        expect(content.mcpServers["existing-server"]).toBeDefined();
        expect(content.mcpServers["existing-server"]?.args).toEqual(["-y", "existing-mcp"]);
        expect(content.mcpServers["wangs-ui"]).toBeDefined();
        expect(content.mcpServers["wangs-ui"]?.args).toEqual(["-y", "@wangs-ui/mcp@1.0.64"]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("syncWangsUiMcp", () => {
    test("fails when project has no @wangs-ui dependencies", async () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const res = await syncWangsUiMcp(tempDir);
        expect(res.success).toBe(false);
        expect(res.error).toContain("No @wangs-ui/* packages found");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("writes .mcp.json and reconnects session", async () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { "@wangs-ui/react-core": "1.0.64" },
        }),
        "utf8",
      );

      let reconnectedServer: string | null = null;
      const mockSession = {
        reconnectMcpServer: async (name: string) => {
          reconnectedServer = name;
        },
      } as unknown as Query;

      try {
        const res = await syncWangsUiMcp(tempDir, mockSession);
        expect(res.success).toBe(true);
        expect(res.targetVersion).toBe("1.0.64");
        expect(reconnectedServer).toBe("wangs-ui");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("syncs with explicit targetVersion even when project has no @wangs-ui packages", async () => {
      const tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tempDir, { recursive: true });

      let reconnectedServer: string | null = null;
      const mockSession = {
        reconnectMcpServer: async (name: string) => {
          reconnectedServer = name;
        },
      } as unknown as Query;

      try {
        const res = await syncWangsUiMcp(tempDir, mockSession, "latest");
        expect(res.success).toBe(true);
        expect(res.targetVersion).toBe("latest");
        expect(reconnectedServer).toBe("wangs-ui");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
