import React from "react";
import { BG, CARD_BORDER, GOLD } from "./theme.ts";

export interface ArtifactItem {
  title?: string;
  url: string;
}

export interface ArtifactsPanelProps {
  artifacts: ArtifactItem[];
  selectedIndex: number;
  onOpen?: (url: string) => void;
  onClose?: () => void;
  onSelect?: (idx: number) => void;
}

export function ArtifactsPanel({ artifacts, selectedIndex, onOpen, onClose, onSelect }: ArtifactsPanelProps): React.ReactNode {
  const defaultUrl = "https://claude.ai/code/artifacts";

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
      {/* Header */}
      <box style={{ flexDirection: "row", justifyContent: "space-between", paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <text content="Claude Code Artifacts" style={{ fg: GOLD }} />
          <text content=" · Gallery" style={{ fg: "#565f89" }} />
        </box>
        <text content="Esc to back" style={{ fg: "#565f89" }} onMouseDown={onClose} />
      </box>

      {/* Description */}
      <box style={{ flexDirection: "column", paddingX: 1 }}>
        <text content="Artifacts (interactive UI components, web apps, and documents) are hosted on your Claude account." style={{ fg: "#c0caf5" }} />
        <box style={{ flexDirection: "row", marginTop: 1 }}>
          <text content="Gallery: " style={{ fg: "#94a3b8" }} />
          <text content={defaultUrl} style={{ fg: "#38bdf8" }} />
        </box>
      </box>

      {/* Artifacts List or Empty Info */}
      <box style={{ flexDirection: "column", marginTop: 1, paddingX: 1 }}>
        {artifacts.length > 0 ? (
          <box style={{ flexDirection: "column" }}>
            <text content="Recent Artifacts in this Session:" style={{ fg: "#94a3b8", marginBottom: 1 }} />
            {artifacts.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <box
                  key={item.url}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingX: 1,
                    backgroundColor: isSelected ? GOLD : undefined,
                  }}
                  onMouseDown={() => {
                    onSelect?.(idx);
                    onOpen?.(item.url);
                  }}
                >
                  <box style={{ minWidth: 24, marginRight: 2, flexShrink: 0 }}>
                    <text
                      content={item.title || item.url.replace(/^https?:\/\//, "")}
                      wrapMode="none"
                      truncate
                      style={{ fg: isSelected ? BG : GOLD }}
                    />
                  </box>
                  <text content={item.url} wrapMode="none" truncate flexShrink={1} style={{ fg: isSelected ? "#343b58" : "#565f89" }} />
                </box>
              );
            })}
          </box>
        ) : (
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            <text
              content="No artifacts generated in this session yet. When Claude publishes an artifact, it will appear here."
              style={{ fg: "#565f89" }}
            />
          </box>
        )}
      </box>

      {/* Footer */}
      <box style={{ paddingX: 1, marginTop: 1 }}>
        <text
          content={
            artifacts.length > 0
              ? "↑/↓ to navigate · Enter/o to open · c to copy · g for gallery · Esc to back"
              : "Enter/o to open gallery · c to copy link · Esc to back"
          }
          style={{ fg: "#565f89" }}
        />
      </box>
    </box>
  );
}
