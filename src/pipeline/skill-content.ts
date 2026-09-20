import fs from "node:fs";
import path from "node:path";

import { PACKAGE_ROOT } from "../package-root.ts";

// The headless pipeline (agent-runner.ts) has no `plugins` option — unlike the interactive chat
// REPL (session-options.ts), it never registers wangs-plugin's skills, so a model turn in this
// pipeline has no way to discover or load a skill by name. Several phase prompts nonetheless used
// to say things like "Follow the `feature-workflow` skill's Step 1 exactly" — a reference to
// content the model could never actually reach. This module reads that content directly off disk
// and injects it into the prompt string instead, the same way primary-rules.ts injects rule files
// into the system prompt — "follow this skill" becomes "here is the skill," deterministically.
//
// PACKAGE_ROOT comes from ../package-root.ts rather than being recomputed here — this file lives
// two levels deep in source (src/pipeline/) but tsdown bundles every entry point into flat chunk
// files directly under dist/, so a from-scratch `import.meta.url`-relative resolution here would
// use the wrong number of "..": correct only when run unbundled (`bun src/cli.ts`), silently wrong
// once built. See package-root.ts's own comment for the full explanation.
const SKILLS_DIR = path.join(PACKAGE_ROOT, "wangs-plugin", "skills");

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n/;

function readSkillFile(skillName: string): string {
  const raw = fs.readFileSync(path.join(SKILLS_DIR, skillName, "SKILL.md"), "utf8");
  // Strip the YAML frontmatter (`name`/`description`) — that's metadata for the interactive
  // chat's plugin/skill-discovery system, meaningless once the content is injected directly.
  return raw.replace(FRONTMATTER_PATTERN, "").trim();
}

/** The entire skill file (frontmatter stripped) — for a skill a phase needs in full, not one section of it. */
export function readSkill(skillName: string): string {
  return readSkillFile(skillName);
}

/**
 * Extracts one `## Heading` section (from that heading up to, but not including, the next heading
 * of the same or higher level) from a skill file. Throws loudly if `heading` isn't found exactly —
 * a section renamed in the SKILL.md must break this call visibly, not silently point a phase
 * prompt at nothing the way a bare skill-name string reference used to.
 */
export function readSkillSection(skillName: string, heading: string): string {
  const lines = readSkillFile(skillName).split("\n");
  const headingLine = `## ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim() === headingLine);
  if (startIndex === -1) {
    throw new Error(`readSkillSection: heading "${headingLine}" not found in the "${skillName}" skill.`);
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIndex = i;
      break;
    }
  }

  return lines
    .slice(startIndex, endIndex)
    .join("\n")
    .replace(/\n?---\s*$/, "") // trailing "---" section-divider line, if the slice happened to end on one
    .trim();
}
