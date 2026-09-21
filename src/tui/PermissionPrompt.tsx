import type { ScrollBoxRenderable } from "@opentui/core";

import { BG, CARD_BORDER, GOLD, ROSE } from "./theme.ts";

export type PermissionChoice = "allow-once" | "always-allow" | "deny";

export interface PermissionOption {
  choice: PermissionChoice;
  label: string;
}

/** "Always allow" only appears when the SDK actually gave us a rule set for this exact call (see
 *  permission-prompt.ts's `suggestions` field) — there's nothing to apply otherwise. */
export function permissionOptionsFor(hasSuggestions: boolean): PermissionOption[] {
  const options: PermissionOption[] = [{ choice: "allow-once", label: "Allow once" }];
  if (hasSuggestions) options.push({ choice: "always-allow", label: "Always allow this session" });
  options.push({ choice: "deny", label: "Deny" });
  return options;
}

export interface PermissionPromptProps {
  label: string;
  mcpServerName: string | null;
  options: PermissionOption[];
  selectedIndex: number;
  onDeny?: () => void;
  onSelect?: (index: number) => void;
  maxContentHeight?: number;
  scrollRef?: React.RefObject<ScrollBoxRenderable | null>;
}

export function PermissionPrompt({
  label,
  mcpServerName,
  options,
  selectedIndex,
  onDeny,
  onSelect,
  maxContentHeight = 8,
  scrollRef,
}: PermissionPromptProps): React.ReactNode {
  // Estimate number of lines taking horizontal wrap into account (assuming terminal width ~76)
  const lines = label.split("\n");
  const estimatedLines = lines.reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 76)), 0);
  const contentHeight = Math.max(1, Math.min(estimatedLines, maxContentHeight));
  const isScrollable = estimatedLines > maxContentHeight;
  const footerText = isScrollable
    ? "↑/↓ to choose · PgUp/PgDn to scroll · Enter to confirm · Esc to deny"
    : "This session only — ↑/↓ to choose · Enter to confirm · Esc to deny";

  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: CARD_BORDER,
        flexDirection: "column",
        paddingX: 0,
        paddingY: 0,
        flexShrink: 0,
      }}
    >
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1, flexShrink: 0 }}>
        <text content="Permission requested" style={{ fg: GOLD }} />
        <text content="Esc to deny" style={{ fg: "#565f89" }} onMouseDown={onDeny} />
      </box>
      {mcpServerName ? (
        <box style={{ paddingX: 1, flexShrink: 0 }}>
          <text content={`MCP server: ${mcpServerName}`} style={{ fg: "#565f89" }} />
        </box>
      ) : null}
      <scrollbox
        ref={scrollRef}
        style={{
          height: contentHeight,
          flexShrink: 0,
          marginBottom: 1,
        }}
        focused={false}
      >
        <box style={{ paddingX: 1 }}>
          <text content={label} style={{ fg: "#c0caf5" }} />
        </box>
      </scrollbox>
      {options.map((opt, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? "❯ " : "  ";
        const defaultFg = opt.choice === "deny" ? ROSE : GOLD;
        return (
          <box
            key={opt.choice}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingX: 1,
              backgroundColor: isSelected ? GOLD : undefined,
              flexShrink: 0,
            }}
            onMouseDown={() => onSelect?.(i)}
          >
            <text content={`${prefix}${opt.label}`} wrapMode="none" truncate style={{ fg: isSelected ? BG : defaultFg }} />
          </box>
        );
      })}
      <box style={{ paddingX: 1, marginTop: 1, flexShrink: 0 }}>
        <text content={footerText} style={{ fg: "#565f89" }} />
      </box>
    </box>
  );
}
