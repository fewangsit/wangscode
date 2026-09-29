import { Store } from "./store.ts";
import { Typewriter } from "./typewriter.ts";
import { inferSubagentType } from "./format.ts";

export interface SubagentChildEvent {
  id: string;
  type: "thinking" | "tool_call" | "text";
  name?: string;
  content: string;
  status?: "running" | "done" | "error";
  timestamp: number;
}

export interface ToolCallBlock {
  id: number;
  kind: "tool";
  toolUseId: string;
  name: string;
  input: unknown | null;
  status: "running" | "done" | "error";
  resultText?: string;
  isSkill: boolean;
  isSubagent?: boolean;
  subagentType?: string;
  subagentPrompt?: string;
  subagentDescription?: string;
  startedAt?: number;
  completedAt?: number;
  childSessionId?: string;
  subagentEvents?: SubagentChildEvent[];
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
    if (this.toolIndex.has(toolUseId)) {
      return;
    }
    const id = this.nextId++;
    this.toolIndex.set(toolUseId, id);
    const isSubagent =
      name.toLowerCase() === "agent" ||
      name.toLowerCase() === "subagent" ||
      name.toLowerCase() === "task";
    this.push({
      id,
      kind: "tool",
      toolUseId,
      name,
      input: null,
      status: "running",
      isSkill: name === "Skill",
      isSubagent,
      startedAt: Date.now(),
      subagentEvents: isSubagent ? [] : undefined,
    });
  }

  appendToolInputDelta(toolUseId: string, partialJson: string): void {
    let raw = (this.toolInputBuffers.get(toolUseId) ?? "") + partialJson;
    const trimmed = partialJson.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        JSON.parse(trimmed);
        raw = trimmed;
      } catch {
        // Fall back to accumulated raw
      }
    }
    this.toolInputBuffers.set(toolUseId, raw);

    let parsed: unknown = null;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      // Incomplete streaming JSON — attempt to parse inner object if multiple were concatenated
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try {
          parsed = JSON.parse(raw.slice(first, last + 1));
        } catch {
          // Incomplete streaming JSON — fall back to regex extraction
        }
      }
    }

    let inputObj = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    if (!inputObj && raw.length > 0) {
      const subagentMatch =
        raw.match(/"subagent_type"\s*:\s*"([^"]+)"/) ||
        raw.match(/"subagent"\s*:\s*"([^"]+)"/) ||
        raw.match(/"agent"\s*:\s*"([^"]+)"/) ||
        raw.match(/"name"\s*:\s*"([^"]+)"/);
      const descMatch = raw.match(/"description"\s*:\s*"([^"]+)"/) || raw.match(/"task"\s*:\s*"([^"]+)"/);
      const promptMatch = raw.match(/"prompt"\s*:\s*"([^"]+)"/) || raw.match(/"instructions"\s*:\s*"([^"]+)"/);

      if (subagentMatch || descMatch || promptMatch) {
        inputObj = {
          subagent_type: subagentMatch?.[1],
          description: descMatch?.[1],
          prompt: promptMatch?.[1],
        };
      }
    }

    if (inputObj) {
      const inferredType = inferSubagentType(inputObj);
      const subagentType =
        (inferredType !== "subagent" ? inferredType : undefined) ||
        (typeof inputObj.subagent_type === "string" ? inputObj.subagent_type : undefined) ||
        (typeof inputObj.subagent === "string" ? inputObj.subagent : undefined) ||
        (typeof inputObj.agent === "string" ? inputObj.agent : undefined) ||
        (typeof inputObj.category === "string" ? inputObj.category : undefined) ||
        (typeof inputObj.type === "string" && inputObj.type !== "task" ? inputObj.type : undefined) ||
        (typeof inputObj.name === "string" ? inputObj.name : undefined);

      const description =
        (typeof inputObj.description === "string" && inputObj.description ? inputObj.description : undefined) ||
        (typeof inputObj.task === "string" && inputObj.task ? inputObj.task : undefined) ||
        (typeof inputObj.title === "string" && inputObj.title ? inputObj.title : undefined) ||
        (typeof inputObj.summary === "string" && inputObj.summary ? inputObj.summary : undefined);

      const prompt =
        (typeof inputObj.prompt === "string" && inputObj.prompt ? inputObj.prompt : undefined) ||
        (typeof inputObj.task === "string" && inputObj.task ? inputObj.task : undefined) ||
        (typeof inputObj.instructions === "string" && inputObj.instructions ? inputObj.instructions : undefined) ||
        (typeof inputObj.query === "string" && inputObj.query ? inputObj.query : undefined) ||
        description;

      const isSub = Boolean(
        (subagentType && subagentType !== "subagent") ||
          description ||
          prompt ||
          inputObj.subagent_type ||
          inputObj.subagent ||
          inputObj.agent
      );

      this.updateToolBlock(toolUseId, (block) => {
        const isSubagent = block.isSubagent || isSub;
        return {
          ...block,
          input: parsed ?? block.input ?? inputObj,
          isSubagent,
          subagentType: subagentType ?? block.subagentType,
          subagentPrompt: prompt ?? block.subagentPrompt,
          subagentDescription: description ?? block.subagentDescription,
          subagentEvents: block.subagentEvents ?? (isSubagent ? [] : undefined),
        };
      });
    }
  }

  finishToolInput(toolUseId: string): void {
    const raw = this.toolInputBuffers.get(toolUseId);
    this.toolInputBuffers.delete(toolUseId);
    if (raw === undefined) return;

    let parsed: unknown = null;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try {
          parsed = JSON.parse(raw.slice(first, last + 1));
        } catch {
          // ignore
        }
      }
      if (!parsed) {
        parsed = raw;
      }
    }

    const inputObj = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    const inferredType = inferSubagentType(inputObj);
    const subagentType =
      (inferredType !== "subagent" ? inferredType : undefined) ||
      (typeof inputObj?.subagent_type === "string" ? inputObj.subagent_type : undefined) ||
      (typeof inputObj?.subagent === "string" ? inputObj.subagent : undefined) ||
      (typeof inputObj?.agent === "string" ? inputObj.agent : undefined) ||
      (typeof inputObj?.category === "string" ? inputObj.category : undefined) ||
      (typeof inputObj?.type === "string" && inputObj.type !== "task" ? inputObj.type : undefined) ||
      (typeof inputObj?.name === "string" ? inputObj.name : undefined);

    const description =
      (typeof inputObj?.description === "string" && inputObj.description ? inputObj.description : undefined) ||
      (typeof inputObj?.task === "string" && inputObj.task ? inputObj.task : undefined) ||
      (typeof inputObj?.title === "string" && inputObj.title ? inputObj.title : undefined) ||
      (typeof inputObj?.summary === "string" && inputObj.summary ? inputObj.summary : undefined);

    const prompt =
      (typeof inputObj?.prompt === "string" && inputObj.prompt ? inputObj.prompt : undefined) ||
      (typeof inputObj?.task === "string" && inputObj.task ? inputObj.task : undefined) ||
      (typeof inputObj?.instructions === "string" && inputObj.instructions ? inputObj.instructions : undefined) ||
      (typeof inputObj?.query === "string" && inputObj.query ? inputObj.query : undefined) ||
      description;

    const isSub = Boolean(
      (subagentType && subagentType !== "subagent") ||
        description ||
        prompt ||
        inputObj?.subagent_type ||
        inputObj?.subagent ||
        inputObj?.agent
    );

    this.updateToolBlock(toolUseId, (block) => {
      const isSubagent = block.isSubagent || isSub;
      return {
        ...block,
        input: parsed,
        isSubagent,
        subagentType: subagentType ?? block.subagentType,
        subagentPrompt: prompt ?? block.subagentPrompt,
        subagentDescription: description ?? block.subagentDescription,
        subagentEvents: block.subagentEvents ?? (isSubagent ? [] : undefined),
      };
    });
  }

  completeToolCall(toolUseId: string, resultText: string, isError: boolean): void {
    this.updateToolBlock(toolUseId, (block) => ({
      ...block,
      status: isError ? "error" : "done",
      resultText,
      completedAt: Date.now(),
    }));
  }

  appendSubagentEvent(toolUseId: string, event: SubagentChildEvent): void {
    this.updateToolBlock(toolUseId, (block) => {
      const existing = block.subagentEvents ?? [];
      const idx = event.id ? existing.findIndex((e) => e.id === event.id) : -1;
      let nextEvents: SubagentChildEvent[];
      if (idx !== -1) {
        nextEvents = [...existing];
        nextEvents[idx] = {
          ...existing[idx]!,
          ...event,
          name: event.name ?? existing[idx]!.name,
          content: event.content || existing[idx]!.content,
          status: event.status ?? existing[idx]!.status,
        };
      } else {
        nextEvents = [...existing, event];
      }
      return {
        ...block,
        isSubagent: true,
        subagentEvents: nextEvents,
      };
    });
  }

  setChildSessionId(toolUseId: string, childSessionId: string): void {
    this.updateToolBlock(toolUseId, (block) => ({
      ...block,
      childSessionId,
    }));
  }

  /** Reveals all buffered typing animation immediately — used on shutdown/interrupt, not normal flow. */
  flushAll(): void {
    this.finalizeTurn(true);
  }

  /**
   * Finalizes the current turn cleanly:
   * 1. Resolves any orphan tools still marked 'running' to 'done' (or 'error').
   * 2. Flushes all pending typewriters and marks streaming as false.
   * 3. Clears waitingStore and ends the turn.
   */
  finalizeTurn(isError = false): void {
    this.store.update((blocks) =>
      blocks.map((block) => {
        if (block.kind === "tool" && block.status === "running") {
          return {
            ...block,
            status: isError ? "error" : "done",
            completedAt: block.completedAt ?? Date.now(),
          };
        }
        if (block.kind === "assistant" || block.kind === "thinking") {
          const tw = this.typewriters.get(block.id);
          const rest = tw ? tw.flush() : "";
          this.typewriters.delete(block.id);
          this.sdkDone.delete(block.id);
          return { ...block, text: block.text + rest, streaming: false };
        }
        return block;
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
