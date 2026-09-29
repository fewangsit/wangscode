import React from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { BG, CARD_BORDER, GOLD, TOOL_STATUS_COLOR, TOOL_STATUS_GLYPH } from "./theme.ts";
import type { SubagentChildEvent } from "./chat-store.ts";
import { formatChildToolLine } from "./format.ts";
import { WANGS_SUBAGENTS } from "../subagents.ts";

export interface SubagentExecutionItem {
  id: number;
  toolUseId: string;
  title: string;
  subagentType: string;
  description?: string;
  prompt?: string;
  status: "running" | "done" | "error";
  startedAt?: number;
  completedAt?: number;
  durationSec?: string;
  events: SubagentChildEvent[];
  resultText?: string;
  childSessionId?: string;
}

export type SubagentsPanelView =
  | { kind: "history"; selectedIdx: number }
  | { kind: "detail"; selectedIdx: number };

export interface SubagentsPanelProps {
  subagents: SubagentExecutionItem[];
  view: SubagentsPanelView;
  scrollRef?: React.RefObject<ScrollBoxRenderable | null>;
  onClose?: () => void;
  onSelect?: (idx: number) => void;
  onOpenDetail?: (idx: number) => void;
  onBackToList?: () => void;
}

const MAX_VISIBLE = 5;

export function SubagentsPanel({
  subagents,
  view,
  scrollRef,
  onClose,
  onSelect,
  onOpenDetail,
  onBackToList,
}: SubagentsPanelProps): React.ReactNode {
  if (view.kind === "detail") {
    const item = subagents[view.selectedIdx];
    if (!item) {
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 1, paddingY: 0 }}>
          <text content="Subagent execution not found." style={{ fg: "#f7768e" }} />
          <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBackToList} />
        </box>
      );
    }

    const glyph = TOOL_STATUS_GLYPH[item.status] ?? "◌";
    const glyphColor = TOOL_STATUS_COLOR[item.status] ?? "#e0af68";
    const fullTask =
      item.prompt ||
      item.description ||
      (item.status === "running" ? "(Initializing task...)" : "(No prompt description recorded)");
    const durationLabel = item.durationSec ? `${item.durationSec}s` : item.status === "running" ? "running..." : "-";
    const startedLabel = item.startedAt ? new Date(item.startedAt).toLocaleTimeString() : "-";
    const completedLabel = item.completedAt ? new Date(item.completedAt).toLocaleTimeString() : "-";

    return (
      <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 0, paddingY: 0 }}>
        {/* Header */}
        <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
          <box style={{ flexDirection: "row" }}>
            <text content="Subagent Execution" style={{ fg: GOLD }} />
            <text content={` · ${item.title}`} style={{ fg: "#ffffff" }} />
            <text content={` (${item.subagentType})`} style={{ fg: "#565f89" }} />
          </box>
          <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onBackToList} />
        </box>

        {/* Metadata summary badge row */}
        <box style={{ flexDirection: "row", paddingX: 1, marginBottom: 1, flexWrap: "wrap" }}>
          <text content={`${glyph} `} style={{ fg: glyphColor }} />
          <text content={item.status.toUpperCase()} style={{ fg: glyphColor }} />
          <text content="  ·  " style={{ fg: "#414868" }} />
          <text content="Duration: " style={{ fg: "#94a3b8" }} />
          <text content={durationLabel} style={{ fg: "#c0caf5" }} />
          <text content="  ·  " style={{ fg: "#414868" }} />
          <text content="Started: " style={{ fg: "#94a3b8" }} />
          <text content={startedLabel} style={{ fg: "#c0caf5" }} />
          {item.completedAt ? (
            <>
              <text content="  ·  " style={{ fg: "#414868" }} />
              <text content="Ended: " style={{ fg: "#94a3b8" }} />
              <text content={completedLabel} style={{ fg: "#c0caf5" }} />
            </>
          ) : null}
          {item.childSessionId ? (
            <>
              <text content="  ·  " style={{ fg: "#414868" }} />
              <text content="Session: " style={{ fg: "#94a3b8" }} />
              <text content={item.childSessionId.slice(0, 12)} style={{ fg: "#7dcfff" }} />
            </>
          ) : null}
          <text content="  ·  " style={{ fg: "#414868" }} />
          <text content={`${item.events.length} step(s)`} style={{ fg: "#94a3b8" }} />
        </box>

        {/* Scrollable trace & report */}
        <scrollbox ref={scrollRef} style={{ height: 14 }} focused={false}>
          <box style={{ flexDirection: "column", paddingX: 1 }}>
            {/* Task Objective / Prompt */}
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              <text content="[Task Objective / Prompt]" style={{ fg: GOLD }} />
              <text content={fullTask} style={{ fg: "#c0caf5" }} />
            </box>

            {/* Step-by-step Execution Trace */}
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              <box style={{ flexDirection: "row" }}>
                <text content={`[Execution Trace (${item.events.length} steps)]`} style={{ fg: GOLD }} />
              </box>
              {item.events.length === 0 ? (
                <text content="  ↳ (No child tool calls or thinking deltas recorded)" style={{ fg: "#565f89" }} />
              ) : (
                item.events.map((ev, i) => {
                  if (ev.type === "thinking") {
                    return (
                      <box key={ev.id || i} style={{ flexDirection: "row", marginTop: 0 }}>
                        <text content="  ↳ " style={{ fg: "#565f89" }} />
                        <text content="💭 Thinking: " style={{ fg: "#7aa2f7" }} />
                        <text content={ev.content.replace(/\s+/g, " ").slice(0, 120)} style={{ fg: "#a9b1d6" }} wrapMode="none" truncate />
                      </box>
                    );
                  }

                  const { name, detail } = formatChildToolLine(ev.name ?? "tool", ev.content);
                  const statusColor = ev.status === "error" ? "#f7768e" : ev.status === "running" ? "#7dcfff" : "#9ece6a";
                  const statusIcon = ev.status === "error" ? "✗" : ev.status === "running" ? "◌" : "✓";

                  return (
                    <box key={ev.id || i} style={{ flexDirection: "row", marginTop: 0 }}>
                      <text content="  ↳ " style={{ fg: "#565f89" }} />
                      <text content={`${statusIcon} `} style={{ fg: statusColor }} />
                      <text content={`${name}: `} style={{ fg: "#e0af68" }} />
                      <text content={detail.slice(0, 110)} style={{ fg: "#c0caf5" }} wrapMode="none" truncate />
                    </box>
                  );
                })
              )}
            </box>

            {/* Output Report */}
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text content="[Output Report]" style={{ fg: GOLD }} />
              {item.resultText ? (
                <text content={item.resultText} style={{ fg: "#e2e8f0" }} />
              ) : item.status === "running" ? (
                <text content="  (Execution currently in progress...)" style={{ fg: "#7dcfff" }} />
              ) : (
                <text content="  (No output report produced)" style={{ fg: "#565f89" }} />
              )}
            </box>
          </box>
        </scrollbox>

        {/* Footer */}
        <box style={{ paddingX: 1, marginTop: 1 }}>
          <text content="↑/↓ to scroll · c to copy report · Esc to back to history" style={{ fg: "#565f89" }} />
        </box>
      </box>
    );
  }

  // View: History List
  const selectedIdx = view.selectedIdx;
  const doneCount = subagents.filter((s) => s.status === "done").length;
  const runningCount = subagents.filter((s) => s.status === "running").length;
  const errorCount = subagents.filter((s) => s.status === "error").length;

  const windowStart = Math.max(
    0,
    Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), Math.max(0, subagents.length - MAX_VISIBLE)),
  );
  const visibleSubagents = subagents.slice(windowStart, windowStart + MAX_VISIBLE);

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexDirection: "column", paddingX: 0, paddingY: 0 }}>
      {/* Header */}
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <text content="Subagents" style={{ fg: GOLD }} />
          <text content=" · Execution History" style={{ fg: "#565f89" }} />
        </box>
        <text content="Esc to close" style={{ fg: "#565f89" }} onMouseDown={onClose} />
      </box>

      {/* Overview status bar */}
      <box style={{ flexDirection: "row", paddingX: 1, marginBottom: 1 }}>
        <text content="Total: " style={{ fg: "#94a3b8" }} />
        <text content={`${subagents.length}`} style={{ fg: "#c0caf5" }} />
        <text content="  ·  " style={{ fg: "#414868" }} />
        <text content="✓ Done: " style={{ fg: "#94a3b8" }} />
        <text content={`${doneCount}`} style={{ fg: "#9ece6a" }} />
        <text content="  ·  " style={{ fg: "#414868" }} />
        <text content="◌ Running: " style={{ fg: "#94a3b8" }} />
        <text content={`${runningCount}`} style={{ fg: "#e0af68" }} />
        <text content="  ·  " style={{ fg: "#414868" }} />
        <text content="✗ Error: " style={{ fg: "#94a3b8" }} />
        <text content={`${errorCount}`} style={{ fg: errorCount > 0 ? "#f7768e" : "#565f89" }} />
      </box>

      {/* Subagent List or Empty State */}
      <box style={{ flexDirection: "column", paddingX: 1 }}>
        {subagents.length === 0 ? (
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            <text content="No subagents have been invoked in this session yet." style={{ fg: "#94a3b8" }} />
            <text
              content="When commands require specialized research or specs, subagents run automatically."
              style={{ fg: "#565f89", marginTop: 1 }}
            />
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text content="Registered Wangs Foundation Subagents:" style={{ fg: GOLD, marginBottom: 1 }} />
              {Object.entries(WANGS_SUBAGENTS).map(([key, def]) => (
                <box key={key} style={{ flexDirection: "row", marginBottom: 1 }}>
                  <box style={{ minWidth: 22, marginRight: 1 }}>
                    <text content={`• ${key}`} style={{ fg: "#7dcfff" }} />
                  </box>
                  <text
                    content={def.description.slice(0, 75) + "..."}
                    style={{ fg: "#565f89" }}
                    wrapMode="none"
                    truncate
                    flexShrink={1}
                  />
                </box>
              ))}
            </box>
          </box>
        ) : (
          <box style={{ flexDirection: "column" }}>
            {visibleSubagents.map((item, localIdx) => {
              const globalIdx = windowStart + localIdx;
              const isSelected = globalIdx === selectedIdx;
              const glyph = TOOL_STATUS_GLYPH[item.status] ?? "◌";
              const glyphColor = TOOL_STATUS_COLOR[item.status] ?? "#e0af68";
              const desc = item.description || item.prompt || "(No description)";
              const duration = item.durationSec ? `${item.durationSec}s` : item.status === "running" ? "..." : "-";
              const stepCount = `${item.events.length} step(s)`;

              return (
                <box
                  key={item.toolUseId || item.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingX: 1,
                    backgroundColor: isSelected ? GOLD : undefined,
                  }}
                  onMouseDown={() => {
                    onSelect?.(globalIdx);
                    onOpenDetail?.(globalIdx);
                  }}
                >
                  <box style={{ flexDirection: "row", flexShrink: 1, minWidth: 0, marginRight: 2 }}>
                    <text content={`${glyph} `} style={{ fg: isSelected ? BG : glyphColor }} />
                    <text
                      content={item.title}
                      style={{ fg: isSelected ? BG : "#ffffff" }}
                      wrapMode="none"
                      truncate
                    />
                    <text
                      content={` · ${desc.replace(/\s+/g, " ").trim()}`}
                      style={{ fg: isSelected ? "#343b58" : "#94a3b8" }}
                      wrapMode="none"
                      truncate
                      flexShrink={1}
                    />
                  </box>
                  <box style={{ flexDirection: "row", flexShrink: 0 }}>
                    <text content={`${duration} · ${stepCount}`} style={{ fg: isSelected ? "#343b58" : "#565f89" }} />
                  </box>
                </box>
              );
            })}
          </box>
        )}
      </box>

      {/* Footer */}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text
          content={
            subagents.length > 0
              ? "↑/↓ to navigate · Enter to view full trace & report · Esc to back"
              : "Esc to back"
          }
          style={{ fg: "#565f89" }}
        />
      </box>
    </box>
  );
}
