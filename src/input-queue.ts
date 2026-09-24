import type { SDKUserMessage } from "./engine/index.ts";

// Bridges the TUI input router's event-driven line submissions (see tui/input-router.ts) into the
// AsyncIterable<SDKUserMessage> `query()` expects when `prompt` is a stream — this is what keeps
// the SDK session alive across the whole REPL lifetime instead of restarting per message (see
// sdk.d.ts:5847-5861 for SDKUserMessage's real required shape: type, message,
// parent_tool_use_id — everything else optional).
export class AsyncInputQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiter: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: message, done: false });
    } else {
      this.pending.push(message);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const next = this.pending.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}
