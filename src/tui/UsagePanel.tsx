import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

import { CARD_BORDER, GOLD, ROSE } from "./theme.ts";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatResetTime(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const now = new Date();
  const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();

  const timeStr = date
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: date.getMinutes() === 0 ? undefined : "2-digit",
      hour12: true,
    })
    .toLowerCase()
    .replace(/\s+/g, "");

  if (isToday) {
    return `${timeStr} (${tz})`;
  }

  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${dateStr} at ${timeStr} (${tz})`;
}

const FRACTIONAL_BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const USAGE_BAR_WIDTH = 40;

function renderUsageBar(utilization: number | null | undefined): string {
  if (utilization === null || utilization === undefined) return "(not available)";
  const pct = Math.max(0, Math.min(100, utilization));
  const filledExact = (pct / 100) * USAGE_BAR_WIDTH;
  const fullCount = Math.floor(filledExact);
  const frac = filledExact - fullCount;
  const fracIdx = Math.floor(frac * 8);
  const fracChar = FRACTIONAL_BLOCKS[fracIdx] ?? "";
  const bar = "█".repeat(fullCount) + fracChar;
  return `${bar} ${pct.toFixed(0)}% used`;
}

function UsageWindow({
  title,
  window,
}: {
  title: string;
  window: { utilization: number | null; resets_at: string | null } | null | undefined;
}): React.ReactNode {
  if (window === null || window === undefined) return null;
  const pct = window.utilization ?? 0;
  const barColor = pct >= 90 ? ROSE : pct >= 70 ? GOLD : "#38bdf8";

  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <text content={title} style={{ fg: GOLD }} />
      <text content={renderUsageBar(window.utilization)} style={{ fg: barColor }} />
      <text content={`Resets ${formatResetTime(window.resets_at)}`} style={{ fg: "#565f89" }} />
    </box>
  );
}

export interface UsagePanelProps {
  loading: boolean;
  error: string | null;
  data: SDKControlGetUsageResponse | null;
  onBack?: () => void;
}

export function UsagePanel({ loading, error, data, onBack }: UsagePanelProps): React.ReactNode {
  if (loading) {
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
          <text content="Session" style={{ fg: GOLD }} />
          <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBack} />
        </box>
        <box style={{ paddingX: 1 }}>
          <text content="Loading usage..." style={{ fg: "#565f89" }} />
        </box>
      </box>
    );
  }

  if (error || !data) {
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
          <text content="Session" style={{ fg: GOLD }} />
          <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBack} />
        </box>
        <box style={{ paddingX: 1 }}>
          <text content={`Could not load usage: ${error ?? "no data"}`} style={{ fg: "#f7768e" }} />
        </box>
      </box>
    );
  }

  const { session, rate_limits_available, rate_limits } = data;
  const modelUsageEntries = Object.values(session.model_usage);
  const totalInput = modelUsageEntries.reduce((sum, u) => sum + u.inputTokens, 0);
  const totalOutput = modelUsageEntries.reduce((sum, u) => sum + u.outputTokens, 0);
  const totalCacheRead = modelUsageEntries.reduce((sum, u) => sum + u.cacheReadInputTokens, 0);
  const totalCacheWrite = modelUsageEntries.reduce((sum, u) => sum + u.cacheCreationInputTokens, 0);

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
        <text content="Session" style={{ fg: GOLD }} />
        <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBack} />
      </box>
      <box style={{ paddingX: 1, flexDirection: "column" }}>
        <text content={`Total cost: $${session.total_cost_usd.toFixed(4)}`} style={{ fg: "#c0caf5" }} />
        <text
          content={`Total duration (API): ${formatDuration(session.total_api_duration_ms)} · duration (wall): ${formatDuration(session.total_duration_ms)}`}
          style={{ fg: "#94a3b8" }}
        />
        <text
          content={`Total code changes: ${session.total_lines_added} lines added, ${session.total_lines_removed} lines removed`}
          style={{ fg: "#94a3b8" }}
        />
        <text
          content={`Usage: ${totalInput.toLocaleString()} input, ${totalOutput.toLocaleString()} output, ${totalCacheRead.toLocaleString()} cache read, ${totalCacheWrite.toLocaleString()} cache write`}
          style={{ fg: "#94a3b8" }}
        />
        {rate_limits_available && rate_limits ? (
          <>
            <UsageWindow title="Current session" window={rate_limits.five_hour} />
            <UsageWindow title="Current week (all models)" window={rate_limits.seven_day} />
          </>
        ) : (
          <text
            content="Plan rate limits are not available for this session (API key / third-party provider)."
            style={{ fg: "#565f89", marginTop: 1 }}
          />
        )}
      </box>
    </box>
  );
}
