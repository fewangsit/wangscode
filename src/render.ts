import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// Prints streamed deltas as they arrive (token-level, from `stream_event`
// messages — real shape: sdk.d.ts:5147 SDKPartialAssistantMessage.event is a
// BetaRawMessageStreamEvent; text deltas are `{type:'content_block_delta',
// delta:{type:'text_delta', text}}` per @anthropic-ai/sdk's real
// messages.d.ts) and a trailing newline once a full assistant turn lands.
export function renderMessage(message: SDKMessage): void {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
    return;
  }

  if (message.type === "assistant") {
    process.stdout.write("\n");
    return;
  }

  if (message.type === "result") {
    if (message.subtype === "success") {
      process.stderr.write(`\n[cost: $${message.total_cost_usd.toFixed(6)}]\n`);
    } else {
      process.stderr.write(`\n[error: ${message.subtype}]\n`);
    }
  }
}
