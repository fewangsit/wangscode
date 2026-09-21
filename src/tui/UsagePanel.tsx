import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

import { GOLD } from "./theme.ts";

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
  return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

const USAGE_BAR_WIDTH = 40;

function renderUsageBar(utilization: number | null | undefined): string {
  if (utilization === null || utilization === undefined) return "(not available)";
  const pct = Math.max(0, Math.min(100, utilization));
  const filled = Math.round((pct / 100) * USAGE_BAR_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(USAGE_BAR_WIDTH - filled)} ${pct.toFixed(0)}% used`;
}

function UsageWindow({
  title,
  window,
}: {
  title: string;
  window: { utilization: number | null; resets_at: string | null } | null | undefined;
}): React.ReactNode {
  if (window === null || window === undefined) return null;
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <text content={title} style={{ fg: GOLD }} />
      <text content={renderUsageBar(window.utilization)} style={{ fg: "#c0caf5" }} />
      <text content={`Resets ${formatResetTime(window.resets_at)}`} style={{ fg: "#565f89" }} />
    </box>
  );
}

export function UsagePanel({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: string | null;
  data: SDKControlGetUsageResponse | null;
}): React.ReactNode {
  if (loading) {
    return (
      <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Usage">
        <text content="Loading usage..." style={{ fg: "#565f89" }} />
      </box>
    );
  }
  if (error || !data) {
    return (
      <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Usage">
        <text content={`Could not load usage: ${error ?? "no data"}`} style={{ fg: "#f7768e" }} />
        <text content="Esc to close" style={{ fg: "#565f89", marginTop: 1 }} />
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
    <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Usage">
      <text content="Session" style={{ fg: GOLD }} />
      <text content={`Total cost: $${session.total_cost_usd.toFixed(4)}`} style={{ fg: "#c0caf5", marginTop: 1 }} />
      <text
        content={`Total duration (API): ${formatDuration(session.total_api_duration_ms)} · duration (wall): ${formatDuration(session.total_duration_ms)}`}
        style={{ fg: "#c0caf5" }}
      />
      <text
        content={`Total code changes: ${session.total_lines_added} lines added, ${session.total_lines_removed} lines removed`}
        style={{ fg: "#c0caf5" }}
      />
      <text
        content={`Usage: ${totalInput.toLocaleString()} input, ${totalOutput.toLocaleString()} output, ${totalCacheRead.toLocaleString()} cache read, ${totalCacheWrite.toLocaleString()} cache write`}
        style={{ fg: "#c0caf5" }}
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
      <text content="Esc to close" style={{ fg: "#565f89", marginTop: 1 }} />
    </box>
  );
}
