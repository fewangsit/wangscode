import type { EffortLevel, ModelUsage } from "../engine/index.ts";

import { Store } from "./store.ts";

export interface SessionStatus {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  cwd: string | null;
  /** The effort level the session will send on its next request — `null` when the current model
   *  doesn't support one, or it isn't known yet. See `SDKSystemMessage.effort`'s own doc comment. */
  effort: EffortLevel | null;
  /** Running per-model totals accumulated from each `result` message's `modelUsage` (the SDK's
   *  own docs recommend this over the main-loop-only `usage` field — it includes subagents/sidechains). */
  modelUsage: Record<string, ModelUsage>;
}

const EMPTY_STATUS: SessionStatus = { sessionId: null, model: null, permissionMode: null, cwd: null, effort: null, modelUsage: {} };

/**
 * Session metadata captured from the SDK's `system`/`init` message (fired at the start of each
 * turn) — read by the status bar and welcome banner (Stage 1), and by `/usage`/`/model` (Stage 3).
 */
export class SessionStatusStore {
  readonly store = new Store<SessionStatus>(EMPTY_STATUS);

  /**
   * Fills in cwd/model/permissionMode immediately at startup from values the REPL already knows
   * (what it's about to request via `buildSessionOptions`) — the SDK's own `system`/`init`
   * message confirming these doesn't arrive until the first turn actually runs, not merely on
   * `query()` being called, so waiting for it left the status bar showing "(connecting...)" for
   * the entire time before the user's first message. `applyInit` below still overwrites these
   * once the real confirmation lands (e.g. a canonicalized model name), so this is only ever a
   * head start, never a value the UI is stuck with if it turns out to be wrong.
   */
  seedKnownConfig(info: { cwd: string; model: string; permissionMode: string }): void {
    this.store.update((prev) => ({ ...prev, cwd: info.cwd, model: info.model, permissionMode: info.permissionMode }));
  }

  applyInit(info: { session_id: string; model: string; permissionMode: string; cwd: string; effort?: EffortLevel | null }): void {
    this.store.update((prev) => ({
      ...prev,
      sessionId: info.session_id,
      model: info.model,
      permissionMode: info.permissionMode,
      cwd: info.cwd,
      effort: info.effort ?? prev.effort,
    }));
  }

  /** Optimistic update after a successful `session.setModel()` call (the model picker) — same
   *  reasoning as `seedKnownConfig`: we already know the answer since we're the one who just set
   *  it, no reason to wait for a fresh `system`/`init` round-trip that may not even arrive. */
  setModel(model: string): void {
    this.store.update((prev) => ({ ...prev, model }));
  }

  /** Optimistic update after a successful `session.applyFlagSettings({effortLevel})` call. */
  setEffort(effort: EffortLevel): void {
    this.store.update((prev) => ({ ...prev, effort }));
  }

  /** Resets session id and usage totals for a fresh session while keeping model, cwd, and effort. */
  resetForNewSession(): void {
    this.store.update((prev) => ({
      ...prev,
      sessionId: null,
      modelUsage: {},
    }));
  }

  /** `result` messages carry per-turn totals, not cumulative ones — sum them here across the session. */
  accumulateUsage(modelUsage: Record<string, ModelUsage>): void {
    this.store.update((prev) => {
      const merged: Record<string, ModelUsage> = { ...prev.modelUsage };
      for (const [model, usage] of Object.entries(modelUsage)) {
        const existing = merged[model];
        merged[model] = existing
          ? {
              ...usage,
              inputTokens: existing.inputTokens + usage.inputTokens,
              outputTokens: existing.outputTokens + usage.outputTokens,
              thinkingTokens: (existing.thinkingTokens ?? 0) + (usage.thinkingTokens ?? 0),
              cacheReadInputTokens: existing.cacheReadInputTokens + usage.cacheReadInputTokens,
              cacheCreationInputTokens: existing.cacheCreationInputTokens + usage.cacheCreationInputTokens,
              webSearchRequests: existing.webSearchRequests + usage.webSearchRequests,
              costUSD: existing.costUSD + usage.costUSD,
            }
          : usage;
      }
      return { ...prev, modelUsage: merged };
    });
  }
}
