import { BG, CARD_BORDER, GOLD } from "./theme.ts";

export interface Suggestion {
  /** What actually gets spliced into the input after the trigger char. */
  insertText: string;
  /** What the suggestion row displays for the command or mention name. */
  label: string;
  /** Optional description displayed on the right side of the row. */
  description?: string;
}

export interface SuggestionBoxProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  onSelect?: (suggestion: Suggestion) => void;
}

export function SuggestionBox({ suggestions, selectedIndex, onSelect }: SuggestionBoxProps): React.ReactNode {
  if (suggestions.length === 0) return null;
  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: CARD_BORDER,
        flexShrink: 0,
        flexDirection: "column",
        paddingX: 0,
        paddingY: 0,
      }}
    >
      {suggestions.map((s, i) => {
        const isSelected = i === selectedIndex;
        return (
          <box
            key={s.insertText}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingX: 1,
              backgroundColor: isSelected ? GOLD : undefined,
            }}
            onMouseDown={() => onSelect?.(s)}
          >
            {s.description ? (
              <>
                <box style={{ minWidth: 18, marginRight: 2, flexShrink: 0 }}>
                  <text content={s.label} wrapMode="none" truncate style={{ fg: isSelected ? BG : GOLD }} />
                </box>
                <text content={s.description} wrapMode="none" truncate flexShrink={1} style={{ fg: isSelected ? "#343b58" : "#94a3b8" }} />
              </>
            ) : (
              <text content={s.label} wrapMode="none" truncate style={{ fg: isSelected ? BG : "#c0caf5" }} />
            )}
          </box>
        );
      })}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text content="Tab to select · ↑/↓ to navigate · Esc to dismiss" wrapMode="none" truncate style={{ fg: "#565f89" }} />
      </box>
    </box>
  );
}
