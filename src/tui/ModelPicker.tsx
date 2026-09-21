import type { EffortLevel, ModelInfo } from "@anthropic-ai/claude-agent-sdk";

import { capitalize } from "./format.ts";
import { BG, GOLD } from "./theme.ts";

/** Picks a sensible default effort level out of a model's supported set — "high" if it's offered
 *  (matches Claude Code's own default), otherwise whatever the model does support. */
export function defaultEffortFor(levels: readonly EffortLevel[]): EffortLevel {
  return levels.includes("high") ? "high" : (levels[0] ?? "high");
}

/** Keeps a candidate effort level valid for whichever model row is currently highlighted — moving
 *  to a model with a different supported set (or none at all) shouldn't leave a stale, invalid
 *  selection sitting around. */
export function clampEffort(effort: EffortLevel, levels: readonly EffortLevel[] | undefined): EffortLevel {
  if (!levels || levels.length === 0) return effort;
  return levels.includes(effort) ? effort : defaultEffortFor(levels);
}

export function ModelPicker({
  models,
  selectedIndex,
  loading,
  currentModel,
  effort,
}: {
  models: ModelInfo[];
  selectedIndex: number;
  loading: boolean;
  currentModel: string | null;
  effort: EffortLevel;
}): React.ReactNode {
  const highlighted = models[selectedIndex];
  return (
    <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Select model">
      {loading ? (
        <text content="Loading models..." style={{ fg: "#565f89" }} />
      ) : models.length === 0 ? (
        <text content="No models reported by this session." style={{ fg: "#565f89" }} />
      ) : (
        models.map((m, i) => {
          const isCurrent = m.value === currentModel || m.resolvedModel === currentModel;
          const label = `${isCurrent ? "✔" : " "} ${m.displayName} — ${m.description}`;
          return <text key={m.value} content={label} style={i === selectedIndex ? { fg: BG, bg: GOLD } : { fg: "#c0caf5" }} />;
        })
      )}
      {highlighted?.supportsEffort ? (
        <text content={`● ${capitalize(effort)} effort   ←/→ to adjust`} style={{ fg: "#e0af68", marginTop: 1 }} />
      ) : null}
      <text content="This session only — Enter to select · Esc to cancel" style={{ fg: "#565f89", marginTop: 1 }} />
    </box>
  );
}
