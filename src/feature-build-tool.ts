import { createSdkMcpServer, tool } from "./engine/index.ts";
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
    "Build a Wangs Foundation feature end-to-end (requirements -> data-layer -> test-contract -> ui-slice -> connect -> e2e-run -> lint -> review) via the real, gated feature-build pipeline. Call this ONLY when the user has confirmed a feature slug and has all three source document sets (the single-file PRD, test-case file(s), API spec/LLD file(s)) ready as absolute file paths — a module can split test cases into main+FE+BE files and API docs into a .yaml+.md pair per endpoint group, so testCase/openapi each take an array, not a single path. Never attempt to build the feature yourself — writing the files or judging a phase 'done' yourself defeats the entire point of this tool. After calling it, relay the result's pendingQuestion/status to the user verbatim; do not paraphrase or second-guess it.",
    {
      featureSlug: z.string().describe("kebab-case feature slug, e.g. audit-tag"),
      prd: z
        .string()
        .describe(
          "absolute path to the feature's single-file PRD (PRD/<feature-name>.md, per prd-single-file-convention.md — Overview, UI Design, Functional Requirements, etc. all in one document)",
        ),
      testCase: z.array(z.string()).describe("absolute path(s) to the Test Case file(s) — main file plus FE/BE variants if the module splits them"),
      openapi: z
        .array(z.string())
        .describe(
          "absolute path(s) to API spec/LLD file(s) — real modules pair a .yaml (OpenAPI) with a .md (RBAC/SQL/derived-field logic) per endpoint group",
        ),
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
