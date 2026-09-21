import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { McpServerStatus, Query } from "@anthropic-ai/claude-agent-sdk";

import { PACKAGE_ROOT } from "./package-root.ts";

export interface WangsUiVersionInfo {
  version: string;
  source: string;
}

/** Candidate @wangs-ui packages to inspect in node_modules or package.json dependencies. */
const WANGS_UI_CANDIDATE_PACKAGES = ["react-core", "foundation", "animations", "form", "react-icons", "react-presets", "react-i18n"];

/**
 * Detects the version of `@wangs-ui/*` packages used by the project at `cwd`.
 * Priority:
 * 1. Look inside `node_modules/@wangs-ui/<pkg>/package.json` for installed version.
 * 2. Look inside project's root `package.json` dependencies / devDependencies.
 */
export function detectProjectWangsUiVersion(cwd: string): WangsUiVersionInfo | null {
  // 1. Check installed package.json in node_modules
  for (const pkg of WANGS_UI_CANDIDATE_PACKAGES) {
    const pkgPath = path.join(cwd, "node_modules", "@wangs-ui", pkg, "package.json");
    try {
      if (existsSync(pkgPath)) {
        const raw = readFileSync(pkgPath, "utf8");
        const json = JSON.parse(raw) as { version?: string };
        if (json.version) {
          return { version: json.version, source: `@wangs-ui/${pkg} (installed)` };
        }
      }
    } catch {
      // Ignore read/parse error and check next candidate
    }
  }

  // 2. Check project package.json dependencies
  const rootPkgPath = path.join(cwd, "package.json");
  try {
    if (existsSync(rootPkgPath)) {
      const raw = readFileSync(rootPkgPath, "utf8");
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, rawVersion] of Object.entries(allDeps)) {
        if (name.startsWith("@wangs-ui/")) {
          // Clean semver range operators (^1.2.21, ~1.2.21, >=1.2.21 -> 1.2.21)
          const clean = rawVersion.replace(/^[\^~>=<v]+/, "").trim();
          if (clean.length > 0) {
            return { version: clean, source: `${name} (package.json)` };
          }
        }
      }
    }
  } catch {
    // Ignore read/parse error
  }

  return null;
}

/**
 * Extracts the version of `@wangs-ui/mcp` currently configured on the server, if any.
 */
export function detectCurrentMcpVersion(server?: McpServerStatus): string | null {
  if (!server) return null;

  // 1. If serverInfo has a version reported by the running process
  if (server.serverInfo?.version) {
    return server.serverInfo.version;
  }

  // 2. Parse from args: e.g. ["-y", "@wangs-ui/mcp@1.2.21"]
  const config = server.config;
  if (config && "args" in config && Array.isArray(config.args)) {
    for (const arg of config.args) {
      if (arg === "@wangs-ui/mcp") {
        return "latest";
      }
      const match = arg.match(/@wangs-ui\/mcp@(.+)$/);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }

  return null;
}

/**
 * Resolves the target registry URL for @wangs-ui packages:
 * 1. WANGS_CODE_REGISTRY environment variable
 * 2. .npmrc registry= or @wangs-ui:registry= (checked in cwd, PACKAGE_ROOT, and ~/.npmrc)
 * 3. "publishRegistry" field from wangs-code package.json
 */
export function getMcpTargetRegistry(cwd: string): string | undefined {
  if (process.env.WANGS_CODE_REGISTRY) {
    return process.env.WANGS_CODE_REGISTRY;
  }

  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const candidateNpmrcs = [path.join(cwd, ".npmrc"), path.join(PACKAGE_ROOT, ".npmrc"), ...(homedir ? [path.join(homedir, ".npmrc")] : [])];

  for (const p of candidateNpmrcs) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, "utf8");
        // Check @wangs-ui:registry= first, then general registry=
        const scopedMatch = content.match(/@wangs-ui:registry\s*=\s*(.+)$/m);
        if (scopedMatch?.[1]) return scopedMatch[1].trim();

        const generalMatch = content.match(/^registry\s*=\s*(.+)$/m);
        if (generalMatch?.[1]) return generalMatch[1].trim();
      }
    } catch {
      // Ignore read errors
    }
  }

  // Fall back to package.json publishRegistry
  try {
    const pkgRaw = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { publishRegistry?: string };
    if (pkg.publishRegistry) return pkg.publishRegistry;
  } catch {
    // Ignore read errors
  }

  return undefined;
}

/**
 * Updates or creates `cwd/.mcp.json` with the specified @wangs-ui/mcp version and registry.
 */
export function writeProjectMcpConfig(cwd: string, serverName: string, config: { command: string; args: string[] }): void {
  const mcpJsonPath = path.join(cwd, ".mcp.json");
  let existingData: { mcpServers?: Record<string, unknown> } = {};

  if (existsSync(mcpJsonPath)) {
    try {
      const raw = readFileSync(mcpJsonPath, "utf8");
      existingData = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    } catch {
      existingData = {};
    }
  }

  const updatedData = {
    ...existingData,
    mcpServers: {
      ...existingData.mcpServers,
      [serverName]: config,
    },
  };

  writeFileSync(mcpJsonPath, JSON.stringify(updatedData, null, 2) + "\n", "utf8");
}

/**
 * Syncs the project's `@wangs-ui/mcp` configuration in `.mcp.json` to match the project's
 * installed/specified `@wangs-ui/*` version (or explicit targetVersion) and reconnects the MCP server.
 */
export async function syncWangsUiMcp(
  cwd: string,
  session?: Query,
  targetVersion?: string,
): Promise<{ success: boolean; targetVersion?: string; error?: string }> {
  const versionInfo = detectProjectWangsUiVersion(cwd);
  const version = targetVersion ?? versionInfo?.version;
  if (!version) {
    return {
      success: false,
      error: "No @wangs-ui/* packages found in this project. Specify a version or install @wangs-ui/react-core first.",
    };
  }

  const registry = getMcpTargetRegistry(cwd);

  const mcpConfig = {
    command: "npx",
    args: ["-y", ...(registry ? [`--registry=${registry}`] : []), `@wangs-ui/mcp@${version}`],
  };

  try {
    writeProjectMcpConfig(cwd, "wangs-ui", mcpConfig);

    if (session) {
      try {
        await session.reconnectMcpServer("wangs-ui");
      } catch {
        try {
          await session.setMcpServers({
            "wangs-ui": {
              type: "stdio",
              command: mcpConfig.command,
              args: mcpConfig.args,
            },
          });
        } catch {
          // Ignore fallback error
        }
      }
    }

    return { success: true, targetVersion: version };
  } catch (err) {
    return {
      success: false,
      targetVersion: version,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
