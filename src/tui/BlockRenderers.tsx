import { useEffect, useState } from "react";

import type { SyntaxStyle } from "@opentui/core";

import type { ChatBlock } from "./chat-store.ts";
import { formatToolCall, getNodeSummary, isJsonString } from "./format.ts";
import { GOLD, ROLE_COLOR, TOOL_STATUS_COLOR, TOOL_STATUS_GLYPH } from "./theme.ts";

export interface JsonNodeViewProps {
  keyName?: string;
  value: unknown;
  depth?: number;
  defaultExpanded?: boolean;
}

export function JsonNodeView({ keyName, value, depth = 0, defaultExpanded = false }: JsonNodeViewProps): React.ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 1. Primitive handling
  if (value === null || typeof value !== "object") {
    let valStr: string;
    let fg: string;

    if (typeof value === "string") {
      valStr = JSON.stringify(value);
      fg = "#9ece6a"; // green
    } else if (typeof value === "number") {
      valStr = String(value);
      fg = "#ff9e64"; // orange
    } else if (typeof value === "boolean") {
      valStr = value ? "true" : "false";
      fg = "#bb9af7"; // purple
    } else {
      valStr = String(value);
      fg = "#565f89"; // muted
    }

    return (
      <box style={{ flexDirection: "row", paddingLeft: depth * 2 }}>
        {keyName !== undefined ? <text content={`${keyName}: `} style={{ fg: GOLD }} /> : null}
        <text content={valStr} style={{ fg }} />
      </box>
    );
  }

  // 2. Object or Array handling
  const isArray = Array.isArray(value);
  const entries = isArray ? (value as unknown[]).map((v, i) => [`[${i}]`, v] as const) : Object.entries(value as Record<string, unknown>);

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const summary = getNodeSummary(value);

  if (entries.length === 0) {
    return (
      <box style={{ flexDirection: "row", paddingLeft: depth * 2 }}>
        {keyName !== undefined ? <text content={`${keyName}: `} style={{ fg: GOLD }} /> : null}
        <text content={`${openBracket} ${closeBracket}`} style={{ fg: "#565f89" }} />
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column" }}>
      <box style={{ flexDirection: "row", alignItems: "center", paddingLeft: depth * 2 }} onMouseDown={() => setExpanded((prev) => !prev)}>
        <text content={`${expanded ? "▼" : "▶"} `} style={{ fg: GOLD }} />
        {keyName !== undefined ? <text content={`${keyName}: `} style={{ fg: GOLD }} /> : null}
        <text content={expanded ? openBracket : summary} style={{ fg: expanded ? "#7aa2f7" : "#565f89" }} />
      </box>

      {expanded ? (
        <>
          {entries.map(([k, v]) => (
            <JsonNodeView key={k} keyName={k} value={v} depth={depth + 1} defaultExpanded={false} />
          ))}
          <box style={{ paddingLeft: depth * 2 }}>
            <text content={closeBracket} style={{ fg: "#7aa2f7" }} />
          </box>
        </>
      ) : null}
    </box>
  );
}

export interface CollapsibleJsonProps {
  label: string;
  value?: unknown;
  rawJson?: string;
  syntaxStyle?: SyntaxStyle;
  defaultExpanded?: boolean;
}

export function CollapsibleJson({ label, value, rawJson, syntaxStyle, defaultExpanded = false }: CollapsibleJsonProps): React.ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);

  let parsed: unknown = value;
  if (parsed === undefined && rawJson) {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = rawJson;
    }
  } else if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Keep string
      }
    }
  }

  const isObject = typeof parsed === "object" && parsed !== null;
  const summary = isObject ? getNodeSummary(parsed) : String(parsed).slice(0, 50);
  const toggleGlyph = expanded ? "▼" : "▶";

  return (
    <box style={{ flexDirection: "column", paddingLeft: 2 }}>
      <box style={{ flexDirection: "row", alignItems: "center" }} onMouseDown={() => setExpanded((prev) => !prev)}>
        <text content={`${toggleGlyph} ${label}: `} style={{ fg: GOLD }} />
        {!expanded ? <text content={summary} style={{ fg: "#565f89" }} wrapMode="none" truncate /> : null}
      </box>

      {expanded ? (
        <box style={{ flexDirection: "column", paddingLeft: 1, marginTop: 1 }}>
          {isObject ? (
            Array.isArray(parsed) ? (
              parsed.map((item, idx) => <JsonNodeView key={idx} keyName={`[${idx}]`} value={item} depth={0} defaultExpanded={false} />)
            ) : (
              Object.entries(parsed as Record<string, unknown>).map(([k, v]) => (
                <JsonNodeView key={k} keyName={k} value={v} depth={0} defaultExpanded={false} />
              ))
            )
          ) : rawJson && syntaxStyle ? (
            <code content={rawJson} filetype="json" syntaxStyle={syntaxStyle} />
          ) : (
            <text content={String(parsed)} style={{ fg: "#c0caf5" }} />
          )}
        </box>
      ) : null}
    </box>
  );
}

function ToolCallRow({ block, syntaxStyle }: { block: Extract<ChatBlock, { kind: "tool" }>; syntaxStyle: SyntaxStyle }): React.ReactNode {
  const glyph = TOOL_STATUS_GLYPH[block.status];
  const color = TOOL_STATUS_COLOR[block.status];
  const formatted = formatToolCall(block.name, block.input, block.isSkill);

  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <text content={`${glyph} ${formatted.headline}`} style={{ fg: color }} />
      {formatted.detail ? (
        <box style={{ paddingLeft: 2 }}>
          <text content={formatted.detail} style={{ fg: "#94a3b8" }} wrapMode="none" truncate />
        </box>
      ) : null}
      {formatted.rawJson ? <CollapsibleJson label="Input" value={block.input} rawJson={formatted.rawJson} syntaxStyle={syntaxStyle} /> : null}
      {block.resultText ? (
        isJsonString(block.resultText) ? (
          <CollapsibleJson label="Result" value={block.resultText} syntaxStyle={syntaxStyle} />
        ) : (
          <box style={{ paddingLeft: 2 }}>
            <text content={block.resultText} style={{ fg: "#565f89" }} />
          </box>
        )
      ) : null}
    </box>
  );
}

const THINKING_FRAMES = ["💭   ", "💭 . ", "💭 ..", "💭..."];
const THINKING_FRAME_MS = 350;

/** While a thinking block has no text yet (the model hasn't emitted a delta), there's nothing to
 *  show but the icon sitting there motionless — cycles a small dot animation instead, so it reads
 *  as "actively thinking" rather than possibly stalled. Stops the moment real text starts arriving
 *  (the streaming text itself is motion enough at that point). */
function ThinkingRow({ block }: { block: Extract<ChatBlock, { kind: "thinking" }> }): React.ReactNode {
  const [frame, setFrame] = useState(0);
  const hasText = block.text.length > 0;

  useEffect(() => {
    if (hasText) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % THINKING_FRAMES.length), THINKING_FRAME_MS);
    return () => clearInterval(id);
  }, [hasText]);

  const content = hasText ? `💭 ${block.text}` : THINKING_FRAMES[frame];
  return <text content={content} style={{ fg: "#565f89", marginBottom: 1 }} />;
}

/** The welcome block is deliberately NOT handled here — it's rendered once, separately, directly
 *  in the App component's JSX (see WelcomeBanner.tsx) rather than through this per-block loop, so
 *  its onCommandClick callback (which touches a ref) is threaded as a plain JSX prop instead of a
 *  positional argument through a .map() callback — the latter tripped oxlint's react(refs) check,
 *  a real if overly cautious static-analysis limit (it can't trace that the callback is only ever
 *  attached as an onMouseDown prop several components down, never called during render). */
export function renderBlock(block: ChatBlock, syntaxStyle: SyntaxStyle): React.ReactNode {
  switch (block.kind) {
    case "welcome":
      return null;
    case "user":
      return <text key={block.id} content={`> ${block.text}`} style={{ fg: ROLE_COLOR.user, marginBottom: 1 }} />;
    case "assistant":
      return <markdown key={block.id} content={block.text} syntaxStyle={syntaxStyle} streaming={block.streaming} style={{ marginBottom: 1 }} />;
    case "thinking":
      return <ThinkingRow key={block.id} block={block} />;
    case "tool":
      return <ToolCallRow key={block.id} block={block} syntaxStyle={syntaxStyle} />;
    case "host":
      return <markdown key={block.id} content={block.text} syntaxStyle={syntaxStyle} style={{ marginBottom: 1, fg: ROLE_COLOR.host }} />;
    case "footer":
      return <text key={block.id} content={block.text} style={{ fg: ROLE_COLOR.footer, marginBottom: 1 }} />;
  }
}
