import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { FeatureBuildController } from "./slash-commands.ts";

// The model's ONLY conversational on-ramp into the deterministic pipeline —
// its description explicitly tells the model never to build a feature
// itself. The handler is 100% host code (FeatureBuildController, shared
// with the /create-feature slash-command path) — the model only decides
// *when* to call this, never what the pipeline's result means.
export function createFeatureBuildMcpServer(controller: FeatureBuildController) {
  const createFeatureTool = tool(
    "create_feature",
    "Build a Wangs Foundation feature end-to-end (requirements -> data-layer -> test-contract -> ui-slice -> connect -> e2e-run -> lint -> review) via the real, gated feature-build pipeline. Call this ONLY when the user has confirmed a feature slug and has all five source documents (overview, ui-design, functional, test-case, openapi) ready as absolute file paths. Never attempt to build the feature yourself — writing the files or judging a phase 'done' yourself defeats the entire point of this tool. After calling it, relay the result's pendingQuestion/status to the user verbatim; do not paraphrase or second-guess it.",
    {
      featureSlug: z.string().describe("kebab-case feature slug, e.g. audit-tag"),
      overview: z.string().describe("absolute path to Overview.md"),
      uiDesign: z.string().describe("absolute path to UI Design.md"),
      functional: z.string().describe("absolute path to Functionality.md"),
      testCase: z.string().describe("absolute path to the Test Case .md"),
      openapi: z.string().describe("absolute path to openapi.yaml"),
      mode: z.enum(["interactive", "auto"]).default("interactive"),
    },
    async (args) => {
      const result = await controller.start(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  return createSdkMcpServer({
    name: "wangs-feature-build",
    version: "0.1.0",
    tools: [createFeatureTool],
  });
}
