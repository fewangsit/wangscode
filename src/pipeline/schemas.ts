// Zod schemas validate `structured_output` at runtime; the JSON Schema
// objects next to each one are what actually gets sent as `outputFormat`
// (Options.outputFormat accepts raw JSON Schema, not a Zod schema —
// see OpenCode engine's `outputFormat` type).
// Keeping both hand-written side by side (instead of pulling in a
// zod-to-json-schema dependency) means a drift between them is caught
// immediately by the zod .parse() call failing against real output.
import { z } from "zod";

export const gapReportZod = z.object({
  gaps: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["missing", "contradiction", "ambiguous"]),
      description: z.string(),
      sources: z.array(z.string()),
    }),
  ),
});

export const gapReportJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["missing", "contradiction", "ambiguous"] },
          description: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "description", "sources"],
        additionalProperties: false,
      },
    },
  },
  required: ["gaps"],
  additionalProperties: false,
};

export const pageObjectContractZod = z.object({
  featureSlug: z.string(),
  screenName: z.string(),
  requiredSelectors: z.array(
    z.object({
      kind: z.enum(["a11y", "native-id"]),
      name: z.string(),
      role: z.string(),
      describedIn: z.string(),
    }),
  ),
  filePath: z.string(),
});

export const pageObjectContractJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    featureSlug: { type: "string" },
    screenName: { type: "string" },
    requiredSelectors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["a11y", "native-id"] },
          name: { type: "string" },
          role: { type: "string" },
          describedIn: { type: "string" },
        },
        required: ["kind", "name", "role", "describedIn"],
        additionalProperties: false,
      },
    },
    filePath: { type: "string" },
  },
  required: ["featureSlug", "screenName", "requiredSelectors", "filePath"],
  additionalProperties: false,
};

export const reviewFindingsZod = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(["BLOCKER", "WARNING", "INFO"]),
      file: z.string(),
      line: z.number().optional(),
      rule: z.string(),
      summary: z.string(),
    }),
  ),
});

export const reviewFindingsJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["BLOCKER", "WARNING", "INFO"] },
          file: { type: "string" },
          line: { type: "number" },
          rule: { type: "string" },
          summary: { type: "string" },
        },
        required: ["severity", "file", "rule", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};
