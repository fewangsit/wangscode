import { useEffect, useState } from "react";

import type { SyntaxStyle } from "@opentui/core";

import type { ChatBlock } from "./chat-store.ts";
import { formatToolCall } from "./format.ts";
import { ROLE_COLOR, TOOL_STATUS_COLOR, TOOL_STATUS_GLYPH } from "./theme.ts";

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
      {formatted.rawJson ? (
        <box style={{ paddingLeft: 2 }}>
          <code content={formatted.rawJson} filetype="json" syntaxStyle={syntaxStyle} />
        </box>
      ) : null}
      {block.resultText ? (
        <box style={{ paddingLeft: 2 }}>
          <text content={block.resultText} style={{ fg: "#565f89" }} />
        </box>
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
  return <text content={content} style={{ fg: "#565f89", marginBottom: block.streaming ? 0 : 1 }} />;
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
      return (
        <markdown
          key={block.id}
          content={block.text}
          syntaxStyle={syntaxStyle}
          streaming={block.streaming}
          style={{ marginBottom: block.streaming ? 0 : 1 }}
        />
      );
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
