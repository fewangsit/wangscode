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
}

export function PermissionPrompt({ label, mcpServerName, options, selectedIndex, onDeny, onSelect }: PermissionPromptProps): React.ReactNode {
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
        <text content="Permission requested" style={{ fg: GOLD }} />
        <text content="Esc to deny" style={{ fg: "#565f89" }} onMouseDown={onDeny} />
      </box>
      {mcpServerName ? (
        <box style={{ paddingX: 1 }}>
          <text content={`MCP server: ${mcpServerName}`} style={{ fg: "#565f89" }} />
        </box>
      ) : null}
      <box style={{ paddingX: 1, marginBottom: 1 }}>
        <text content={label} style={{ fg: "#c0caf5" }} />
      </box>
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
            }}
            onMouseDown={() => onSelect?.(i)}
          >
            <text content={`${prefix}${opt.label}`} wrapMode="none" truncate style={{ fg: isSelected ? BG : defaultFg }} />
          </box>
        );
      })}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text content="This session only — ↑/↓ to choose · Enter to confirm · Esc to deny" style={{ fg: "#565f89" }} />
      </box>
    </box>
  );
}
