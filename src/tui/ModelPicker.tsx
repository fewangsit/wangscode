import type { EffortLevel, ModelInfo } from "@anthropic-ai/claude-agent-sdk";

import { capitalize } from "./format.ts";
import { BG, CARD_BORDER, GOLD } from "./theme.ts";

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

export interface ModelPickerProps {
  models: ModelInfo[];
  selectedIndex: number;
  loading: boolean;
  currentModel: string | null;
  effort: EffortLevel;
  onCancel?: () => void;
  onSelect?: (index: number) => void;
}

export function ModelPicker({ models, selectedIndex, loading, currentModel, effort, onCancel, onSelect }: ModelPickerProps): React.ReactNode {
  const highlighted = models[selectedIndex];
  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: CARD_BORDER,
        flexDirection: "column",
        paddingX: 0,
        paddingY: 0,
      }}
    >
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <text content="Select model" style={{ fg: GOLD }} />
        <text content="Esc to cancel" style={{ fg: "#565f89" }} onMouseDown={onCancel} />
      </box>
      {loading ? (
        <box style={{ paddingX: 1 }}>
          <text content="Loading models..." style={{ fg: "#565f89" }} />
        </box>
      ) : models.length === 0 ? (
        <box style={{ paddingX: 1 }}>
          <text content="No models reported by this session." style={{ fg: "#565f89" }} />
        </box>
      ) : (
        models.map((m, i) => {
          const isSelected = i === selectedIndex;
          const isCurrent = m.value === currentModel || m.resolvedModel === currentModel;
          const prefix = isCurrent ? "✔ " : "  ";
          return (
            <box
              key={m.value}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingX: 1,
                backgroundColor: isSelected ? GOLD : undefined,
              }}
              onMouseDown={() => onSelect?.(i)}
            >
              <box style={{ minWidth: 22, marginRight: 2, flexShrink: 0 }}>
                <text content={`${prefix}${m.displayName}`} wrapMode="none" truncate style={{ fg: isSelected ? BG : GOLD }} />
              </box>
              <text content={m.description} wrapMode="none" truncate flexShrink={1} style={{ fg: isSelected ? "#343b58" : "#94a3b8" }} />
            </box>
          );
        })
      )}
      {highlighted?.supportsEffort ? (
        <box style={{ paddingX: 1, marginTop: 1 }}>
          <text content={`● ${capitalize(effort)} effort   ←/→ to adjust`} style={{ fg: "#e0af68" }} />
        </box>
      ) : null}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text content="This session only — Enter to select · Esc to cancel" style={{ fg: "#565f89" }} />
      </box>
    </box>
  );
}
