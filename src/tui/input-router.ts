import { Store } from "./store.ts";

/**
 * Single source of truth for "what does the next line the user types go to" — replaces two
 * separate mechanisms the readline version relied on implicitly (the REPL's own `rl.on('line')`
 * handler, and `rl.question()`'s one-shot internal listener for sequential prompts in
 * slash-commands.ts and the y/n permission prompt). Those two competing consumers of the same
 * 'line' event were exactly what the old permission-prompt.ts's comment warned about: "confirmed
 * live: overlapping prompts, and the user's answer to one landing as a normal chat message
 * instead." This router makes "who consumes the next line" an explicit single field instead of an
 * implicit race between two independent readline listeners.
 */
export class InputRouter {
  /** Non-null while a sequential prompt (feature-build Q&A, permission y/n) is waiting on the next line — shown as the input's placeholder. */
  readonly promptStore = new Store<string | null>(null);
  private activeResolve: ((line: string) => void) | null = null;

  constructor(private readonly onDefaultLine: (line: string) => void) {}

  /** Called once per submitted line, from the TUI's <input onSubmit>. */
  submit(line: string): void {
    if (this.activeResolve) {
      const resolve = this.activeResolve;
      this.activeResolve = null;
      this.promptStore.set(null);
      resolve(line);
      return;
    }
    this.onDefaultLine(line);
  }

  /** Waits for exactly the next submitted line, surfacing `promptText` as the active prompt in the meantime. */
  askLine(promptText: string): Promise<string> {
    return new Promise((resolve) => {
      this.promptStore.set(promptText);
      this.activeResolve = resolve;
    });
  }
}
