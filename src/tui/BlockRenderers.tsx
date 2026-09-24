import { useEffect, useState } from "react";

import type { SyntaxStyle } from "@opentui/core";

import type { ChatBlock, ToolCallBlock } from "./chat-store.ts";
import { formatToolCall, getNodeSummary, isJsonString, parseToolName } from "./format.ts";
import { DIFF_ADD_BG, DIFF_DEL_BG, GOLD, GOLD_DIM, ROLE_COLOR, TOOL_STATUS_COLOR, TOOL_STATUS_GLYPH } from "./theme.ts";

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

// "⎿" is Claude Code's own marker for "here's the collapsed result of the action above" — reused
// here instead of a generic "▶ Output:"/"▶ Diff:" label so a tool call reads the same way a
// reviewer already expects from Claude Code itself. The toggle arrow still lives inline (▶/▼)
// since, unlike the real CLI's "ctrl+r to expand", this TUI's only affordance is a mouse click —
// the arrow is what tells you there's something to click.

/** Collapsed-by-default view for plain-text tool output (Read/Bash/Grep results etc.) — a short
 *  result (a one-line success message, a short status string) renders inline as before, but
 *  anything long enough to actually clutter the transcript (todo item 17: Read used to dump the
 *  whole file body straight into the chat) starts collapsed behind a summary line. `summary`
 *  overrides the default "N lines" label (e.g. Bash forces a fixed "Ran 1 shell command" summary
 *  regardless of how short its raw stdout happens to be — a 2-line `bun install` result is exactly
 *  as uninteresting collapsed-by-default as a 200-line one); `forceCollapse` skips the "short
 *  enough to just show inline" bypass for the same reason. */
function CollapsibleText({
  text,
  summary,
  forceCollapse = false,
  defaultExpanded = false,
}: {
  text: string;
  summary?: string;
  forceCollapse?: boolean;
  defaultExpanded?: boolean;
}): React.ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const lines = text.split("\n");

  if (!forceCollapse && lines.length <= 3 && text.length <= 200) {
    return (
      <box style={{ flexDirection: "row", paddingLeft: 2 }}>
        <text content="⎿  " style={{ fg: "#565f89" }} />
        <text content={text} style={{ fg: "#565f89" }} />
      </box>
    );
  }

  const toggleGlyph = expanded ? "▼" : "▶";
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2 }}>
      <box style={{ flexDirection: "row", alignItems: "center" }} onMouseDown={() => setExpanded((prev) => !prev)}>
        <text content={`⎿  ${toggleGlyph} `} style={{ fg: "#565f89" }} />
        {!expanded ? <text content={summary ?? `${lines.length} lines`} style={{ fg: "#565f89" }} /> : null}
      </box>
      {expanded ? (
        <box style={{ paddingLeft: 4, marginTop: 1 }}>
          <text content={text} style={{ fg: "#565f89" }} />
        </box>
      ) : null}
    </box>
  );
}

/** Edit tool calls carry `old_string`/`new_string` in their own input — enough to show a real
 *  diff (todo item 18) without waiting on any special tool-result shape. Not a proper LCS diff:
 *  `old_string`/`new_string` are each a single contiguous replacement block (this codebase's own
 *  Edit tool semantics, and Claude Code's), so a flat "every old line removed, every new line
 *  added" read is what a reviewer actually wants here — a real diff algorithm would just be
 *  re-deriving that same block shape the harder way. Line numbers are relative to each side of the
 *  block (1-based), not the file's real line numbers — the block only carries `old_string`/
 *  `new_string`, no surrounding file context to anchor an absolute line number to. */
function EditDiffView({ oldString, newString }: { oldString: string; newString: string }): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const removed = oldString.split("\n");
  const added = newString.split("\n");
  const numWidth = String(Math.max(removed.length, added.length)).length;

  const toggleGlyph = expanded ? "▼" : "▶";
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2 }}>
      <box style={{ flexDirection: "row", alignItems: "center" }} onMouseDown={() => setExpanded((prev) => !prev)}>
        <text content={`⎿  ${toggleGlyph} `} style={{ fg: "#565f89" }} />
        {!expanded ? <text content={`-${removed.length} +${added.length} lines`} style={{ fg: "#565f89" }} /> : null}
      </box>
      {expanded ? (
        <box style={{ flexDirection: "column", paddingLeft: 4, marginTop: 1 }}>
          {removed.map((line, i) => (
            <box key={`del-${i}`} style={{ backgroundColor: DIFF_DEL_BG, width: "100%" }}>
              <text content={`${String(i + 1).padStart(numWidth)} - ${line}`} style={{ fg: "#f7768e" }} />
            </box>
          ))}
          {added.map((line, i) => (
            <box key={`add-${i}`} style={{ backgroundColor: DIFF_ADD_BG, width: "100%" }}>
              <text content={`${String(i + 1).padStart(numWidth)} + ${line}`} style={{ fg: "#9ece6a" }} />
            </box>
          ))}
        </box>
      ) : null}
    </box>
  );
}

function ToolCallRow({ block, syntaxStyle }: { block: Extract<ChatBlock, { kind: "tool" }>; syntaxStyle: SyntaxStyle }): React.ReactNode {
  const glyph = TOOL_STATUS_GLYPH[block.status];
  const color = TOOL_STATUS_COLOR[block.status];
  const formatted = formatToolCall(block.name, block.input, block.isSkill);

  const { toolName } = parseToolName(block.name);
  const inputObj = typeof block.input === "object" && block.input !== null ? (block.input as Record<string, unknown>) : null;
  const isEdit = /^edit$/i.test(toolName) && typeof inputObj?.old_string === "string" && typeof inputObj?.new_string === "string";
  // The diff (Edit) / headline (Write) already say "this file changed" on their own — the tool's
  // own resultText on a successful Edit/Write is just a generic "The file ... has been updated
  // successfully." sentence restating that, with nothing new for a human reader. Suppressed only
  // on success — an error result still needs to be seen.
  const isEditOrWrite = /^(edit|write)$/i.test(toolName);
  const suppressResultText = isEditOrWrite && block.status !== "error";
  const isBash = /^bash$/i.test(toolName);

  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <text content={`${glyph} ${formatted.headline}`} style={{ fg: color }} />
      {formatted.detail ? (
        <box style={{ paddingLeft: 2 }}>
          <text content={formatted.detail} style={{ fg: "#94a3b8" }} wrapMode="none" truncate />
        </box>
      ) : null}
      {isEdit ? (
        <EditDiffView oldString={inputObj!.old_string as string} newString={inputObj!.new_string as string} />
      ) : formatted.rawJson ? (
        <CollapsibleJson label="Input" value={block.input} rawJson={formatted.rawJson} syntaxStyle={syntaxStyle} />
      ) : null}
      {block.resultText && !suppressResultText ? (
        isJsonString(block.resultText) ? (
          <CollapsibleJson label="Result" value={block.resultText} syntaxStyle={syntaxStyle} />
        ) : (
          <CollapsibleText text={block.resultText} forceCollapse={isBash} />
        )
      ) : null}
    </box>
  );
}

const THINKING_FRAMES = ["💭   ", "💭 . ", "💭 ..", "💭..."];
const THINKING_FRAME_MS = 350;

// Purely cosmetic — same spirit as Claude Code's own rotating verb ("Roosting…", etc.) but this is
// wangscode's own list, not a copy of theirs (we don't have their actual word list, only a couple
// of example screenshots to go on). Picked deterministically from the current phase (see
// `phaseKey` below), NOT a timer — a fixed-interval rotation changes words on a clock that has
// nothing to do with what's actually happening, which reads as noise once you notice it (a real
// complaint from watching Claude Code itself: the word only changes when the underlying process
// genuinely changes — thinking, then a tool call, then another tool call, then responding — and
// holds steady for however long that phase actually takes, not a fixed few seconds).
const TURN_VERBS = ["Thinking", "Working", "Noodling", "Pondering", "Percolating", "Mulling", "Tinkering", "Chewing"];
const TURN_TICK_MS = 1000;

// The star glyph cycles through a small rotation (spinner-style) and the "✻ Verb…" segment's
// color pulses between GOLD_DIM and GOLD on a sine wave — both driven by the same fast animation
// tick, independent of the phase/verb logic above (that changes on real events; this is just
// motion to read as "still alive" while a phase holds steady for a while).
const STAR_FRAMES = ["✶", "✸", "✹", "✺"];
const ANIMATION_TICK_MS = 140;
const PULSE_STEP = 0.35; // radians advanced per tick — full pulse cycle ≈ (2π / this) × ANIMATION_TICK_MS ≈ 2.5s

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** Same phaseKey in, same verb out — no state, no timer, just a stable pick per phase. */
function verbForPhase(phaseKey: string): string {
  let hash = 0;
  for (let i = 0; i < phaseKey.length; i++) {
    hash = (hash * 31 + phaseKey.charCodeAt(i)) | 0;
  }
  return TURN_VERBS[Math.abs(hash) % TURN_VERBS.length]!;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** OpenTUI has no real color-interpolation/alpha primitive (confirmed: no per-side opacity, no
 *  gradient) — the "pulse" is just picking a fresh precomputed hex string every animation tick. */
function pulseGold(t: number): string {
  const [r1, g1, b1] = hexToRgb(GOLD_DIM);
  const [r2, g2, b2] = hexToRgb(GOLD);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface TurnStatusProps {
  /** Non-null for the whole span of one turn — see chat-store.ts's `turnStore`. */
  turn: { startedAt: number; startBlockId: number } | null;
  blocks: ChatBlock[];
  effort?: string | null;
}

/**
 * Live status line for the span of one turn — from the moment a message is sent (before anything
 * has streamed back yet) through thinking/tool calls/response text, ending only once the turn is
 * genuinely done. Replaces a static "Waiting for response..." that never changed no matter how
 * long a turn actually took (todo item 16's "kadang tidak muncul, dan kadang muncul tapi tidak
 * hilang" complaint) with something that reflects what's actually happening right now — modeled on
 * Claude Code's own turn indicator ("· Roosting… (20s · ↓ 591 tokens · thinking with medium
 * effort)"), not copied verbatim since the exact mechanism (and word list) isn't ours to read.
 *
 * The token count is a rough estimate (accumulated thinking/assistant text length ÷ 4 since
 * `turn.startBlockId`), not the API's real billed token count — there's no live "tokens so far"
 * figure available from the SDK for a normal (non-redacted) streaming turn, only
 * `SDKThinkingTokensMessage.estimated_tokens` during redacted-thinking, which doesn't cover the
 * common case. Good enough for a progress indicator, not meant to be exact.
 */
export function TurnStatusIndicator({ turn, blocks, effort }: TurnStatusProps): React.ReactNode {
  // Elapsed time is computed from Date.now() INSIDE the interval callback (an effect, not render)
  // and stored in state — computing it directly in the render body would call an impure function
  // (Date.now) during render, which oxlint's react(purity) check rightly rejects: render must be a
  // pure function of props/state, or it produces unstable/unpredictable output across re-renders.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [animFrame, setAnimFrame] = useState(0);

  useEffect(() => {
    if (!turn) return;
    // No synchronous setState here at mount — this component only mounts when `turn` transitions
    // to non-null (see App.tsx's `{turn ? <TurnStatusIndicator .../> : null}`), so elapsedSeconds's
    // initial 0 is already correct for that instant; the interval takes over from the first tick.
    const id = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - turn.startedAt) / 1000)));
    }, TURN_TICK_MS);
    return () => clearInterval(id);
  }, [turn]);

  useEffect(() => {
    if (!turn) return;
    const id = setInterval(() => setAnimFrame((f) => f + 1), ANIMATION_TICK_MS);
    return () => clearInterval(id);
  }, [turn]);

  if (!turn) return null;

  const turnBlocks = blocks.filter((b) => b.id >= turn.startBlockId);
  const charCount = turnBlocks.reduce((sum, b) => sum + (b.kind === "assistant" || b.kind === "thinking" ? b.text.length : 0), 0);
  const tokenEstimate = Math.round(charCount / 4);

  const runningTool = [...turnBlocks].reverse().find((b): b is ToolCallBlock => b.kind === "tool" && b.status === "running");
  const activeThinking = turnBlocks.find((b) => b.kind === "thinking" && b.streaming);
  const activeAssistant = turnBlocks.find((b) => b.kind === "assistant" && b.streaming);

  // Identifies WHICH specific thing is happening right now, not just its category — two different
  // tool calls in a row (toolUseId differs) count as a new phase just as much as thinking->tool
  // does, so the verb changes for each, not just at category boundaries.
  let phaseKey: string;
  let phase: string;
  if (runningTool) {
    phaseKey = `tool:${runningTool.toolUseId}`;
    phase = `running ${runningTool.name}`;
  } else if (activeThinking) {
    phaseKey = `thinking:${activeThinking.id}`;
    phase = effort ? `thinking with ${effort} effort` : "thinking";
  } else if (activeAssistant) {
    phaseKey = `responding:${activeAssistant.id}`;
    phase = "responding";
  } else {
    phaseKey = "waiting";
    phase = "waiting for response";
  }

  const tokenPart = tokenEstimate > 0 ? ` · ↓ ${tokenEstimate} tokens` : "";
  const star = STAR_FRAMES[animFrame % STAR_FRAMES.length];
  const pulseT = (Math.sin(animFrame * PULSE_STEP) + 1) / 2;
  const detail = `(${formatElapsed(elapsedSeconds)}${tokenPart} · ${phase})`;

  return (
    <box style={{ flexDirection: "row", marginBottom: 1 }}>
      <text content={`${star} ${verbForPhase(phaseKey)}… `} style={{ fg: pulseGold(pulseT) }} />
      <text content={detail} style={{ fg: "#565f89" }} />
    </box>
  );
}

/** While a thinking block has no text yet (the model hasn't emitted a delta), there's nothing to
 *  show but the icon sitting there motionless — cycles a small dot animation instead, so it reads
 *  as "actively thinking" rather than possibly stalled. Stops the moment real text starts arriving
 *  (the streaming text itself is motion enough at that point) — AND stops once `block.streaming`
 *  goes false even if no text ever arrived (the model can produce a `redacted_thinking` block with
 *  no visible summary by design, not a bug — see render.ts). The animation used to key only on
 *  `hasText`, so a redacted/summary-less thinking block animated forever, well past the turn
 *  actually finishing and the real response already showing — exactly the "itu selalu animating,
 *  itu aneh" bug report: it looked stuck, not just quiet. */
function ThinkingRow({ block }: { block: Extract<ChatBlock, { kind: "thinking" }> }): React.ReactNode {
  const [frame, setFrame] = useState(0);
  const hasText = block.text.length > 0;
  const animating = !hasText && block.streaming;

  useEffect(() => {
    if (!animating) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % THINKING_FRAMES.length), THINKING_FRAME_MS);
    return () => clearInterval(id);
  }, [animating]);

  const content = hasText ? `💭 ${block.text}` : animating ? THINKING_FRAMES[frame] : "💭 (reasoning hidden)";
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
    case "turn-complete":
      return (
        <text
          key={block.id}
          content={`✻ Worked for ${formatElapsed(Math.round(block.durationMs / 1000))}`}
          style={{ fg: "#565f89", marginBottom: 1 }}
        />
      );
  }
}
