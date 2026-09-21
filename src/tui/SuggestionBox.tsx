import { BG, GOLD } from "./theme.ts";

export interface Suggestion {
  /** What actually gets spliced into the input after the trigger char. */
  insertText: string;
  /** What the suggestion row displays. */
  label: string;
}

export function SuggestionBox({ suggestions, selectedIndex }: { suggestions: Suggestion[]; selectedIndex: number }): React.ReactNode {
  if (suggestions.length === 0) return null;
  return (
    <box style={{ border: true, flexShrink: 0, flexDirection: "column" }}>
      {suggestions.map((s, i) => (
        <text key={s.insertText} content={s.label} style={i === selectedIndex ? { fg: BG, bg: GOLD } : { fg: "#c0caf5" }} />
      ))}
    </box>
  );
}
