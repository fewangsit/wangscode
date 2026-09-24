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
  | { id: number; kind: "footer"; text: string }
  /** A permanent "✻ Worked for Xs" marker for one finished turn — pushed by `endTurn()` below, not
   *  a transient toast (see that method's comment for why). Also reconstructed from a resumed
   *  session's real message timestamps in render.ts's `convertSessionMessagesToBlocks`, so it
   *  survives a full app restart the same way Claude Code's own transcript does. */
  | { id: number; kind: "turn-complete"; durationMs: number };

type StreamingKind = "assistant" | "thinking";

const TICK_MS = 50;

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
  readonly resumeEvent = new Store<number>(0);
  /** True from the moment a message is handed to the model until the first visible block of the
   *  turn appears (see `startWaiting`/the `push` override below) — surfaces a "waiting for
   *  response" indicator so a slow-to-start turn doesn't read as the app being stuck. */
  readonly waitingStore = new Store<boolean>(false);
  /**
   * Non-null for the whole span of one turn — from `startWaiting()` until `endTurn()` (called by
   * App.tsx once nothing is waiting/streaming/running anymore), not just the pre-first-block
   * window `waitingStore` covers. Drives the live status line (elapsed time, a rough output-token
   * estimate from `startBlockId` onward, current phase) the same way Claude Code's own turn
   * indicator works, instead of a static "waiting" message that never changes for however long the
   * turn takes.
   */
  readonly turnStore = new Store<{ startedAt: number; startBlockId: number } | null>(null);
  private nextId = 0;
  private toolIndex = new Map<string, number>(); // toolUseId -> blockId
  private toolInputBuffers = new Map<string, string>(); // toolUseId -> accumulated partial_json
  private typewriters = new Map<number, Typewriter>(); // blockId -> Typewriter
  private sdkDone = new Set<number>(); // blockId — SDK signaled no more deltas, animation may still be draining
  /**
   * kind -> id of the block currently accepting deltas for that kind. Explicit instead of
   * "whichever block happens to be last in `store`" (the old design) — a tool_use block routinely
   * gets pushed between a thinking block starting and the SDK's own message finalizing it (the
   * common think -> call a tool -> think pattern), which left `finishThinking()` unable to find
   * "its" block by array position and silently no-op, stranding the block's `streaming: true`
   * forever (the 💭 indicator that never goes away).
   */
  private activeStreamingId = new Map<StreamingKind, number>();
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

  /** Call right before handing a line to the model — see repl.tsx. `waitingStore` clears automatically the moment any new block is pushed (thinking/tool_use start, or the first assistant text delta), never by a timer; `turnStore` stays set for the whole turn until `endTurn()`. */
  startWaiting(): void {
    this.waitingStore.set(true);
    this.turnStore.set({ startedAt: Date.now(), startBlockId: this.nextId });
  }

  stopWaiting(): void {
    this.waitingStore.set(false);
  }

  /** Call once the turn has genuinely finished (no longer waiting, nothing streaming, no tool
   *  running) — see App.tsx's `isStreaming` transition to false. Pushes a permanent
   *  `turn-complete` block (not a 4-second toast that vanished for good once you closed the app —
   *  Claude Code itself keeps this line in the transcript, so wangscode should too) recording how
   *  long the turn actually took, using `turnStore`'s own `startedAt` before clearing it. */
  endTurn(): void {
    const turn = this.turnStore.get();
    this.turnStore.set(null);
    if (turn) {
      this.push({ id: this.nextId++, kind: "turn-complete", durationMs: Math.max(0, Date.now() - turn.startedAt) });
    }
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
    this.activeStreamingId.clear();
    this.stopWaiting();
    this.endTurn();
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Clears all chat blocks and resets state for a new session. */
  reset(): void {
    this.flushAll();
    this.toolIndex.clear();
    this.toolInputBuffers.clear();
    this.typewriters.clear();
    this.sdkDone.clear();
    this.activeStreamingId.clear();
    this.nextId = 0;
    this.store.set([{ id: this.nextId++, kind: "welcome" }]);
    this.resumeEvent.update((n) => n + 1);
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
    this.resumeEvent.update((n) => n + 1);
  }

  private push(block: ChatBlock): void {
    // Any new block appearing means the turn has visibly started — clears the "waiting for
    // response" indicator regardless of which kind of block it is (thinking, tool call, or the
    // first assistant text delta all reach here, see appendStreamingDelta/startToolCall).
    this.stopWaiting();
    this.store.update((blocks) => [...blocks, block]);
  }

  private updateToolBlock(toolUseId: string, fn: (block: ToolCallBlock) => ToolCallBlock): void {
    const blockId = this.toolIndex.get(toolUseId);
    if (blockId === undefined) return;
    this.store.update((blocks) => blocks.map((b) => (b.id === blockId && b.kind === "tool" ? fn(b) : b)));
  }

  private appendStreamingDelta(kind: StreamingKind, delta: string): void {
    let blockId = this.activeStreamingId.get(kind);
    if (blockId === undefined) {
      blockId = this.nextId++;
      this.activeStreamingId.set(kind, blockId);
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
    const blockId = this.activeStreamingId.get(kind);
    if (blockId === undefined) return;
    this.activeStreamingId.delete(kind);

    if (!this.typewriters.has(blockId)) {
      // No deltas ever arrived for this block (e.g. empty content) — nothing to animate, finish immediately.
      this.store.update((bs) => bs.map((b) => (b.id === blockId ? { ...b, streaming: false } : b)));
      return;
    }
    this.sdkDone.add(blockId);
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
