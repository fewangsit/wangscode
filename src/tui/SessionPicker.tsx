import { BG, CARD_BORDER, GOLD } from "./theme.ts";

export interface SessionInfo {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  lastModified: number;
}

export function formatSessionDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();

  const timeStr = date
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase()
    .replace(/\s+/g, "");

  if (isToday) {
    return `Today at ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${dateStr} at ${timeStr}`;
}

export interface SessionPickerProps {
  sessions: SessionInfo[];
  selectedIndex: number;
  loading: boolean;
  onCancel?: () => void;
  onSelect?: (index: number) => void;
}

const MAX_VISIBLE_SESSIONS = 6;

export function SessionPicker({ sessions, selectedIndex, loading, onCancel, onSelect }: SessionPickerProps): React.ReactNode {
  const windowStart = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(MAX_VISIBLE_SESSIONS / 2), Math.max(0, sessions.length - MAX_VISIBLE_SESSIONS)),
  );
  const visibleSessions = sessions.slice(windowStart, windowStart + MAX_VISIBLE_SESSIONS);

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
        <text content="Resume session" style={{ fg: GOLD }} />
        <text content="Esc to cancel" style={{ fg: "#565f89" }} onMouseDown={onCancel} />
      </box>
      {loading ? (
        <box style={{ paddingX: 1 }}>
          <text content="Loading sessions..." style={{ fg: "#565f89" }} />
        </box>
      ) : sessions.length === 0 ? (
        <box style={{ paddingX: 1 }}>
          <text content="No previous sessions found for this project." style={{ fg: "#565f89" }} />
        </box>
      ) : (
        visibleSessions.map((s, idx) => {
          const actualIndex = windowStart + idx;
          const isSelected = actualIndex === selectedIndex;
          const prefix = isSelected ? "✔ " : "  ";
          const title = s.summary || s.firstPrompt || s.sessionId;
          const dateFormatted = formatSessionDate(s.lastModified);
          return (
            <box
              key={s.sessionId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingX: 1,
                backgroundColor: isSelected ? GOLD : undefined,
              }}
              onMouseDown={() => onSelect?.(actualIndex)}
            >
              <box style={{ flexGrow: 1, marginRight: 2 }}>
                <text content={`${prefix}${title}`} wrapMode="none" truncate style={{ fg: isSelected ? BG : GOLD }} />
              </box>
              <text content={dateFormatted} wrapMode="none" truncate flexShrink={0} style={{ fg: isSelected ? "#343b58" : "#94a3b8" }} />
            </box>
          );
        })
      )}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text
          content={
            sessions.length > MAX_VISIBLE_SESSIONS
              ? `Session ${selectedIndex + 1} of ${sessions.length} — ↑/↓ to navigate · Enter to resume · Esc to cancel`
              : "This project only — ↑/↓ to navigate · Enter to resume · Esc to cancel"
          }
          style={{ fg: "#565f89" }}
        />
      </box>
    </box>
  );
}
