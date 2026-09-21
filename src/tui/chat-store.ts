import { Store } from "./store.ts";
import { Typewriter } from "./typewriter.ts";

export interface ToolCallBlock {
  id: number;
  kind: "tool";
  toolUseId: string;
  name: string;
  input: unknown | null;
  status: "running" | "done" | "error";
  resultText?: string;
  isSkill: boolean;
}

export type ChatBlock =
  | { id: number; kind: "welcome" }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; streaming: boolean }
  | { id: number; kind: "thinking"; text: string; streaming: boolean }
  | ToolCallBlock
  | { id: number; kind: "host"; text: string }
  | { id: number; kind: "footer"; text: string };

type StreamingKind = "assistant" | "thinking";

const TICK_MS = 30;

/**
 * Chat scrollback, driven from outside React (repl.tsx's `for await` loop over the SDK session) —
 * see store.ts for why this isn't just component state.
 *
 * Assistant/thinking text doesn't paste SDK deltas straight into the block — each is buffered
 * through a `Typewriter` (typewriter.ts) and revealed on a shared tick loop, so bursty network
 * chunks look like smooth typing instead of jumping. `streaming: true` on a block means "still
 * animating," which can outlive the SDK actually finishing that block by however long it takes
 * the buffer to drain — `finishAssistant`/`finishThinking` only mark the SDK side done; the tick
 * loop is what flips `streaming` to false once the animation has actually caught up.
 */
export class ChatStore {
  readonly store = new Store<ChatBlock[]>([]);
  private nextId = 0;
  private toolIndex = new Map<string, number>(); // toolUseId -> blockId
  private toolInputBuffers = new Map<string, string>(); // toolUseId -> accumulated partial_json
  private typewriters = new Map<number, Typewriter>(); // blockId -> Typewriter
  private sdkDone = new Set<number>(); // blockId — SDK signaled no more deltas, animation may still be draining
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = Date.now();

  pushWelcome(): void {
    this.push({ id: this.nextId++, kind: "welcome" });
  }

  pushUser(text: string): void {
    this.push({ id: this.nextId++, kind: "user", text });
  }

  pushHost(text: string): void {
    this.push({ id: this.nextId++, kind: "host", text });
  }

  pushFooter(text: string): void {
    this.push({ id: this.nextId++, kind: "footer", text });
  }

  appendAssistantDelta(delta: string): void {
    this.appendStreamingDelta("assistant", delta);
  }

  finishAssistant(): void {
    this.markSdkDone("assistant");
  }

  appendThinkingDelta(delta: string): void {
    this.appendStreamingDelta("thinking", delta);
  }

  finishThinking(): void {
    this.markSdkDone("thinking");
  }

  startToolCall(toolUseId: string, name: string): void {
    const id = this.nextId++;
    this.toolIndex.set(toolUseId, id);
    this.push({ id, kind: "tool", toolUseId, name, input: null, status: "running", isSkill: name === "Skill" });
  }

  appendToolInputDelta(toolUseId: string, partialJson: string): void {
    const raw = this.toolInputBuffers.get(toolUseId) ?? "";
    this.toolInputBuffers.set(toolUseId, raw + partialJson);
  }

  finishToolInput(toolUseId: string): void {
    const raw = this.toolInputBuffers.get(toolUseId);
    this.toolInputBuffers.delete(toolUseId);
    if (raw === undefined) return;

    let parsed: unknown = null;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      parsed = raw; // malformed JSON (shouldn't happen, but don't lose the data if it does) — show the raw string
    }
    this.updateToolBlock(toolUseId, (block) => ({ ...block, input: parsed }));
  }

  completeToolCall(toolUseId: string, resultText: string, isError: boolean): void {
    this.updateToolBlock(toolUseId, (block) => ({ ...block, status: isError ? "error" : "done", resultText }));
  }

  /** Reveals all buffered typing animation immediately — used on shutdown/interrupt, not normal flow. */
  flushAll(): void {
    this.store.update((blocks) =>
      blocks.map((block) => {
        if (block.kind !== "assistant" && block.kind !== "thinking") return block;
        const tw = this.typewriters.get(block.id);
        if (!tw) return block;
        const rest = tw.flush();
        this.typewriters.delete(block.id);
        this.sdkDone.delete(block.id);
        return { ...block, text: block.text + rest, streaming: false };
      }),
    );
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Replaces all chat blocks with a restored history set — used on /resume. */
  replaceBlocks(blocks: ChatBlock[]): void {
    this.flushAll();
    this.toolIndex.clear();
    this.toolInputBuffers.clear();
    this.typewriters.clear();
    this.sdkDone.clear();

    let maxId = 0;
    for (const b of blocks) {
      if (b.id >= maxId) maxId = b.id + 1;
      if (b.kind === "tool") {
        this.toolIndex.set(b.toolUseId, b.id);
      }
    }
    this.nextId = maxId;
    this.store.set(blocks);
  }

  private push(block: ChatBlock): void {
    this.store.update((blocks) => [...blocks, block]);
  }

  private updateToolBlock(toolUseId: string, fn: (block: ToolCallBlock) => ToolCallBlock): void {
    const blockId = this.toolIndex.get(toolUseId);
    if (blockId === undefined) return;
    this.store.update((blocks) => blocks.map((b) => (b.id === blockId && b.kind === "tool" ? fn(b) : b)));
  }

  private appendStreamingDelta(kind: StreamingKind, delta: string): void {
    const blocks = this.store.get();
    const last = blocks[blocks.length - 1];
    let blockId: number;
    if (last && last.kind === kind && last.streaming && !this.sdkDone.has(last.id)) {
      blockId = last.id;
    } else {
      blockId = this.nextId++;
      this.push({ id: blockId, kind, text: "", streaming: true } as ChatBlock);
    }

    let tw = this.typewriters.get(blockId);
    if (!tw) {
      tw = new Typewriter();
      this.typewriters.set(blockId, tw);
    }
    tw.push(delta);
    this.ensureTicking();
  }

  private markSdkDone(kind: StreamingKind): void {
    const blocks = this.store.get();
    const last = blocks[blocks.length - 1];
    if (!last || last.kind !== kind) return;

    if (!this.typewriters.has(last.id)) {
      // No deltas ever arrived for this block (e.g. empty content) — nothing to animate, finish immediately.
      this.store.update((bs) => bs.map((b) => (b.id === last.id ? { ...b, streaming: false } : b)));
      return;
    }
    this.sdkDone.add(last.id);
  }

  private ensureTicking(): void {
    if (this.tickTimer) return;
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastTickAt;
    this.lastTickAt = now;

    this.store.update((blocks) =>
      blocks.map((block) => {
        if (block.kind !== "assistant" && block.kind !== "thinking") return block;
        const tw = this.typewriters.get(block.id);
        if (!tw) return block;

        const revealed = tw.tick(elapsedMs);
        const done = !tw.hasPending() && this.sdkDone.has(block.id);

        if (done) {
          this.typewriters.delete(block.id);
          this.sdkDone.delete(block.id);
          return { ...block, text: block.text + (revealed ?? ""), streaming: false };
        }

        if (revealed === null) return block;
        return { ...block, text: block.text + revealed };
      }),
    );

    if (this.typewriters.size === 0 && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
