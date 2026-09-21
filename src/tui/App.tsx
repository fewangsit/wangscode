import path from "node:path";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/react";
import {
  defaultTextareaKeyBindings,
  MacOSScrollAccel,
  type KeyBinding,
  type Renderable,
  type SyntaxStyle,
  type TextareaRenderable,
} from "@opentui/core";
import type { EffortLevel, ModelInfo, Query, SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

import type { ChatBlock } from "./chat-store.ts";
import type { ChatStore } from "./chat-store.ts";
import type { InputRouter } from "./input-router.ts";
import type { SessionStatusStore } from "./session-status.ts";
import { detectActiveFragment } from "./autocomplete.ts";
import { listFileMentions } from "./file-mentions.ts";
import { listAvailableCommands, type CommandDescriptor } from "../command-registry.ts";
import { createAppSyntaxStyle } from "./syntax-theme.ts";
import { PACKAGE_ROOT } from "../package-root.ts";

const LOGO_PATH = path.join(PACKAGE_ROOT, "assets", "wangs-logo.png");

// Gold/amber accent, not blue — the whole palette used to lean on a blue accent (#7aa2f7);
// everywhere that used it now reads GOLD instead.
const GOLD = "#e0af68";
const BG = "#1a1b26";

const ROLE_COLOR: Record<string, string> = {
  user: GOLD,
  host: "#e0af68",
  footer: "#565f89",
};

const TOOL_STATUS_GLYPH: Record<string, string> = {
  running: "◌",
  done: "✓",
  error: "✗",
};

const TOOL_STATUS_COLOR: Record<string, string> = {
  running: "#e0af68",
  done: "#9ece6a",
  error: "#f7768e",
};

// Plain Enter submits (like the old single-line <input>), Option/Alt+Enter inserts a newline
// instead — the opposite of Textarea's own default table (return=newline, meta+return=submit),
// so the defaults for "return" specifically are dropped and replaced; every other default binding
// (arrows, backspace, home/end, word-jump, ...) is kept as-is.
const CHAT_INPUT_KEY_BINDINGS: KeyBinding[] = [
  ...defaultTextareaKeyBindings.filter((b) => b.name !== "return"),
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
];

export interface AppProps {
  chatStore: ChatStore;
  sessionStatus: SessionStatusStore;
  inputRouter: InputRouter;
  onExit: () => void;
  /** Escape stops/interrupts the running turn — see repl.tsx, which wires this to the live session's `interrupt()`. */
  onInterrupt: () => void;
  cwd: string;
  /** Read fresh on every autocomplete fetch — the underlying session changes across a /resume restart (see repl.tsx). May be undefined for the brief window before the first session is up. */
  getSession: () => Query | undefined;
}

interface Suggestion {
  /** What actually gets spliced into the input after the trigger char. */
  insertText: string;
  /** What the suggestion row displays. */
  label: string;
}

function WelcomeBanner({ sessionStatus }: { sessionStatus: SessionStatusStore }): React.ReactNode {
  const { cwd, model } = useSyncExternalStore(sessionStatus.store.subscribe, sessionStatus.store.get);
  return (
    <box style={{ border: true, borderColor: GOLD, flexDirection: "column", paddingX: 2, paddingY: 1, marginBottom: 1 }}>
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        {/* Forced to "blocks" (the universal colored half-block fallback, not a terminal-specific
            graphics protocol) rather than "auto" — confirmed the logo renders as a clean, correct
            crown shape this way; "auto" can pick kitty/sixel depending on the terminal, and a real
            run showed those coming out distorted where "blocks" did not. */}
        <image source={LOGO_PATH} protocol="blocks" fit="fit" style={{ width: 16, height: 8 }} />
        <box style={{ flexDirection: "column", marginLeft: 2 }}>
          <ascii-font text="Wangs Code" font="tiny" color={GOLD} />
          <text content="Standalone coding assistant for Wangs Foundation projects." style={{ fg: "#565f89" }} />
        </box>
      </box>
      <text content={`cwd: ${cwd ?? "(unknown)"}`} style={{ fg: "#565f89", marginTop: 1 }} />
      <text content={`model: ${model ?? "(connecting...)"}`} style={{ fg: "#565f89" }} />
      <text content="/create-feature — deterministic feature-build pipeline" style={{ fg: "#565f89", marginTop: 1 }} />
      <text content="/usage — token/cost totals   /model — switch model   /resume — pick a past session   /exit — quit" style={{ fg: "#565f89" }} />
    </box>
  );
}

function ToolCallRow({ block, syntaxStyle }: { block: Extract<ChatBlock, { kind: "tool" }>; syntaxStyle: SyntaxStyle }): React.ReactNode {
  const glyph = TOOL_STATUS_GLYPH[block.status];
  const color = TOOL_STATUS_COLOR[block.status];
  const label = block.isSkill ? `Using skill: ${(block.input as { skill?: string })?.skill ?? block.name}` : block.name;

  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <text content={`${glyph} ${label}`} style={{ fg: color }} />
      {block.input !== null ? <code content={JSON.stringify(block.input, null, 2)} filetype="json" syntaxStyle={syntaxStyle} /> : null}
      {block.resultText ? <text content={block.resultText} style={{ fg: "#565f89" }} /> : null}
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

function renderBlock(block: ChatBlock, syntaxStyle: SyntaxStyle, sessionStatus: SessionStatusStore): React.ReactNode {
  switch (block.kind) {
    case "welcome":
      return <WelcomeBanner key={block.id} sessionStatus={sessionStatus} />;
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

function SuggestionBox({ suggestions, selectedIndex }: { suggestions: Suggestion[]; selectedIndex: number }): React.ReactNode {
  if (suggestions.length === 0) return null;
  return (
    <box style={{ border: true, flexShrink: 0, flexDirection: "column" }}>
      {suggestions.map((s, i) => (
        <text key={s.insertText} content={s.label} style={i === selectedIndex ? { fg: BG, bg: GOLD } : { fg: "#c0caf5" }} />
      ))}
    </box>
  );
}

/** Picks a sensible default effort level out of a model's supported set — "high" if it's offered
 *  (matches Claude Code's own default), otherwise whatever the model does support. */
function defaultEffortFor(levels: readonly EffortLevel[]): EffortLevel {
  return levels.includes("high") ? "high" : (levels[0] ?? "high");
}

/** Keeps a candidate effort level valid for whichever model row is currently highlighted — moving
 *  to a model with a different supported set (or none at all) shouldn't leave a stale, invalid
 *  selection sitting around. */
function clampEffort(effort: EffortLevel, levels: readonly EffortLevel[] | undefined): EffortLevel {
  if (!levels || levels.length === 0) return effort;
  return levels.includes(effort) ? effort : defaultEffortFor(levels);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function ModelPicker({
  models,
  selectedIndex,
  loading,
  currentModel,
  effort,
}: {
  models: ModelInfo[];
  selectedIndex: number;
  loading: boolean;
  currentModel: string | null;
  effort: EffortLevel;
}): React.ReactNode {
  const highlighted = models[selectedIndex];
  return (
    <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Select model">
      {loading ? (
        <text content="Loading models..." style={{ fg: "#565f89" }} />
      ) : models.length === 0 ? (
        <text content="No models reported by this session." style={{ fg: "#565f89" }} />
      ) : (
        models.map((m, i) => {
          const isCurrent = m.value === currentModel || m.resolvedModel === currentModel;
          const label = `${isCurrent ? "✔" : " "} ${m.displayName} — ${m.description}`;
          return <text key={m.value} content={label} style={i === selectedIndex ? { fg: BG, bg: GOLD } : { fg: "#c0caf5" }} />;
        })
      )}
      {highlighted?.supportsEffort ? (
        <text content={`● ${capitalize(effort)} effort   ←/→ to adjust`} style={{ fg: "#e0af68", marginTop: 1 }} />
      ) : null}
      <text content="This session only — Enter to select · Esc to cancel" style={{ fg: "#565f89", marginTop: 1 }} />
    </box>
  );
}

function StatusBar({ sessionStatus }: { sessionStatus: SessionStatusStore }): React.ReactNode {
  const status = useSyncExternalStore(sessionStatus.store.subscribe, sessionStatus.store.get);
  const left = `${status.model ?? "connecting..."}  ·  ${status.cwd ?? ""}`;
  const right = status.effort ? `${capitalize(status.effort)} effort` : "";
  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
      <text content={left} style={{ fg: "#414868" }} />
      <text content={right} style={{ fg: "#414868" }} />
    </box>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatResetTime(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

const USAGE_BAR_WIDTH = 40;

function renderUsageBar(utilization: number | null | undefined): string {
  if (utilization === null || utilization === undefined) return "(not available)";
  const pct = Math.max(0, Math.min(100, utilization));
  const filled = Math.round((pct / 100) * USAGE_BAR_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(USAGE_BAR_WIDTH - filled)} ${pct.toFixed(0)}% used`;
}

function UsageWindow({
  title,
  window,
}: {
  title: string;
  window: { utilization: number | null; resets_at: string | null } | null | undefined;
}): React.ReactNode {
  if (window === null || window === undefined) return null;
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <text content={title} style={{ fg: GOLD }} />
      <text content={renderUsageBar(window.utilization)} style={{ fg: "#c0caf5" }} />
      <text content={`Resets ${formatResetTime(window.resets_at)}`} style={{ fg: "#565f89" }} />
    </box>
  );
}

function UsagePanel({ loading, error, data }: { loading: boolean; error: string | null; data: SDKControlGetUsageResponse | null }): React.ReactNode {
  if (loading) {
    return (
      <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Usage">
        <text content="Loading usage..." style={{ fg: "#565f89" }} />
      </box>
    );
  }
  if (error || !data) {
    return (
      <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Usage">
        <text content={`Could not load usage: ${error ?? "no data"}`} style={{ fg: "#f7768e" }} />
        <text content="Esc to close" style={{ fg: "#565f89", marginTop: 1 }} />
      </box>
    );
  }

  const { session, rate_limits_available, rate_limits } = data;
  const modelUsageEntries = Object.values(session.model_usage);
  const totalInput = modelUsageEntries.reduce((sum, u) => sum + u.inputTokens, 0);
  const totalOutput = modelUsageEntries.reduce((sum, u) => sum + u.outputTokens, 0);
  const totalCacheRead = modelUsageEntries.reduce((sum, u) => sum + u.cacheReadInputTokens, 0);
  const totalCacheWrite = modelUsageEntries.reduce((sum, u) => sum + u.cacheCreationInputTokens, 0);

  return (
    <box style={{ border: ["top"], flexGrow: 1, flexDirection: "column", paddingX: 2, paddingY: 1 }} title="Usage">
      <text content="Session" style={{ fg: GOLD }} />
      <text content={`Total cost: $${session.total_cost_usd.toFixed(4)}`} style={{ fg: "#c0caf5", marginTop: 1 }} />
      <text
        content={`Total duration (API): ${formatDuration(session.total_api_duration_ms)} · duration (wall): ${formatDuration(session.total_duration_ms)}`}
        style={{ fg: "#c0caf5" }}
      />
      <text
        content={`Total code changes: ${session.total_lines_added} lines added, ${session.total_lines_removed} lines removed`}
        style={{ fg: "#c0caf5" }}
      />
      <text
        content={`Usage: ${totalInput.toLocaleString()} input, ${totalOutput.toLocaleString()} output, ${totalCacheRead.toLocaleString()} cache read, ${totalCacheWrite.toLocaleString()} cache write`}
        style={{ fg: "#c0caf5" }}
      />
      {rate_limits_available && rate_limits ? (
        <>
          <UsageWindow title="Current session" window={rate_limits.five_hour} />
          <UsageWindow title="Current week (all models)" window={rate_limits.seven_day} />
        </>
      ) : (
        <text
          content="Plan rate limits are not available for this session (API key / third-party provider)."
          style={{ fg: "#565f89", marginTop: 1 }}
        />
      )}
      <text content="Esc to close" style={{ fg: "#565f89", marginTop: 1 }} />
    </box>
  );
}

export function App({ chatStore, sessionStatus, inputRouter, onExit, onInterrupt, cwd, getSession }: AppProps): React.ReactNode {
  const blocks = useSyncExternalStore(chatStore.store.subscribe, chatStore.store.get);
  const activePrompt = useSyncExternalStore(inputRouter.promptStore.subscribe, inputRouter.promptStore.get);
  const inputRef = useRef<TextareaRenderable>(null);
  const syntaxStyle = useMemo(() => createAppSyntaxStyle(), []);
  // The default scroll behavior has no acceleration curve at all — every wheel tick moves the
  // same fixed amount regardless of how fast the gesture is, which reads as stepped/jerky rather
  // than smooth. MacOSScrollAccel ramps up for quick successive ticks and stays precise for slow
  // ones; memoized once so its own internal velocity-history state persists across scroll events
  // instead of resetting on every render.
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel(), []);
  const renderer = useRenderer();

  const [copiedVisible, setCopiedVisible] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopiedTextRef = useRef<string | null>(null);

  // Auto-copies a selection to the system clipboard (via OSC 52 — works over SSH, no pbcopy/xclip
  // needed) the moment a mouse drag finishes, instead of requiring an explicit Ctrl+C/Cmd+C the
  // terminal itself can't see (this app captures mouse events for its own text-selection tracking,
  // the same reason native terminal selection doesn't work here either). Cleared on `isDragging`
  // so a fresh drag that happens to land on the same text still notifies again.
  useSelectionHandler((selection) => {
    if (selection.isDragging) {
      lastCopiedTextRef.current = null;
      return;
    }
    const text = selection.getSelectedText();
    if (!text || text.trim().length === 0) return;
    if (lastCopiedTextRef.current === text) return;
    lastCopiedTextRef.current = text;

    if (!renderer.copyToClipboardOSC52(text)) return;
    setCopiedVisible(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedVisible(false), 1500);
  });

  // This is the only real input in the whole app (the scrollbox is explicitly `focused={false}`),
  // so nothing else should ever end up holding focus — a click on the scrollback area, or any
  // empty spot, blurs the input (the renderer emits "focused_renderable" with the new target, or
  // null) without moving focus anywhere useful, which is exactly the "have to click the input box
  // again" friction reported. Steal focus straight back whenever the target isn't already us.
  useEffect(() => {
    const handleFocusChange = (renderable: Renderable | null): void => {
      if (renderable !== inputRef.current) inputRef.current?.focus();
    };
    renderer.on("focused_renderable", handleFocusChange);
    return () => {
      renderer.off("focused_renderable", handleFocusChange);
    };
  }, [renderer]);

  // Mirrors the uncontrolled input's text purely to drive the @/-mention overlay below — the
  // ref-based value stays the single source of truth for what actually gets submitted (see
  // handleSubmit), so this mirror being one render tick behind on a fast paste is harmless.
  const [inputText, setInputText] = useState("");
  // Escape dismisses the overlay without touching the typed text — tracked separately from
  // `inputText` (a plain event-driven flag, not derived) and reset the moment the user types
  // again, via `handleInputChange` below rather than an effect.
  const [dismissed, setDismissed] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestionSeqRef = useRef(0);
  const commandsCacheRef = useRef<{ sessionId: string | null; commands: CommandDescriptor[] } | null>(null);

  // The interactive /model picker overlay — a UI-only interaction (arrow keys, no chat
  // scrollback involvement), so it's handled entirely here rather than going through
  // command-registry.ts's text-based dispatch (see that file's comment on "/model").
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerModels, setModelPickerModels] = useState<ModelInfo[]>([]);
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [modelPickerLoading, setModelPickerLoading] = useState(false);
  const [modelPickerEffort, setModelPickerEffort] = useState<EffortLevel>("high");

  // The /usage full-screen overlay — same "handled entirely in App.tsx" reasoning as /model above.
  const [usagePanelOpen, setUsagePanelOpen] = useState(false);
  const [usageData, setUsageData] = useState<SDKControlGetUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  // Pure derivation from `inputText` — computed during render, not stored as its own state (an
  // earlier version set this from inside the effect below via `setState`, which oxlint correctly
  // flagged: deriving during render avoids an extra cascading render for something that's a
  // straightforward function of state already held).
  const activeFragment = useMemo(() => detectActiveFragment(inputText), [inputText]);
  const visibleSuggestions = activeFragment && !dismissed ? suggestions : [];

  // The async fetch itself is a legitimate effect (synchronizing with the filesystem / SDK
  // control connection); it only ever calls setState from inside its own `.then()` callback, not
  // synchronously in the effect body, so there's no cascading-render footgun here.
  useEffect(() => {
    if (!activeFragment) return;

    const seq = ++suggestionSeqRef.current;
    const apply = (list: Suggestion[]): void => {
      if (suggestionSeqRef.current !== seq) return;
      setSuggestions(list);
      setSelectedIndex(0);
    };

    if (activeFragment.trigger === "@") {
      void listFileMentions(cwd, activeFragment.fragment).then((files) => apply(files.map((f) => ({ insertText: f, label: f }))));
    } else {
      const sessionId = sessionStatus.store.get().sessionId;
      const cached = commandsCacheRef.current;
      const commandsPromise =
        cached && cached.sessionId === sessionId
          ? Promise.resolve(cached.commands)
          : listAvailableCommands(getSession()).then((commands) => {
              commandsCacheRef.current = { sessionId, commands };
              return commands;
            });

      void commandsPromise.then((commands) => {
        const needle = activeFragment.fragment.toLowerCase();
        const matches = commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(needle)).slice(0, 10);
        apply(matches.map((c) => ({ insertText: c.name.slice(1), label: `${c.name} — ${c.description}` })));
      });
    }
  }, [activeFragment, cwd, getSession, sessionStatus]);

  // `<textarea>`'s change event (`ContentChangeEvent`) carries no payload — unlike `<input>`'s
  // `onInput`, which handed back the new value directly — so the current text is read straight off
  // the renderable instead.
  const handleInputChange = (): void => {
    setInputText(inputRef.current?.plainText ?? "");
    setDismissed(false);
  };

  const acceptSuggestion = (suggestion: Suggestion): void => {
    if (!activeFragment || !inputRef.current) return;
    const current = inputRef.current.plainText;
    const before = current.slice(0, activeFragment.start);
    const after = current.slice(activeFragment.start + 1 + activeFragment.fragment.length);
    const next = `${before}${activeFragment.trigger}${suggestion.insertText} ${after}`;
    inputRef.current.setText(next);
    setInputText(next); // ends with a trailing space, so the next fragment detection naturally comes back null
  };

  const closeModelPicker = (): void => {
    setModelPickerOpen(false);
    inputRef.current?.setText("");
    setInputText("");
  };

  const closeUsagePanel = (): void => {
    setUsagePanelOpen(false);
    inputRef.current?.setText("");
    setInputText("");
  };

  const openUsagePanel = (): void => {
    setUsagePanelOpen(true);
    setUsageLoading(true);
    setUsageError(null);
    setUsageData(null);

    const session = getSession();
    if (!session) {
      setUsageLoading(false);
      setUsageError("No active session yet.");
      return;
    }
    void session
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      .then((data) => {
        setUsageData(data);
        setUsageLoading(false);
      })
      .catch((err: unknown) => {
        setUsageError(err instanceof Error ? err.message : String(err));
        setUsageLoading(false);
      });
  };

  const openModelPicker = (): void => {
    setModelPickerOpen(true);
    setModelPickerLoading(true);
    setModelPickerModels([]);
    setModelPickerIndex(0);

    const session = getSession();
    if (!session) {
      setModelPickerLoading(false);
      return;
    }
    void session.supportedModels().then((allModels) => {
      // The "default" row is an alias for whatever the current default model already is (same
      // `resolvedModel` as its own named row, confirmed via a real supportedModels() call — e.g.
      // {value:"default", resolvedModel:"claude-sonnet-5", displayName:"Default (recommended)"}
      // alongside a separate {value:"sonnet", resolvedModel:"claude-sonnet-5", ...} row) — picking
      // the named model directly is equivalent and less confusing without the duplicate entry.
      const models = allModels.filter((m) => m.value !== "default");
      setModelPickerModels(models);
      const status = sessionStatus.store.get();
      const currentIdx = models.findIndex((m) => m.value === status.model || m.resolvedModel === status.model);
      const idx = currentIdx >= 0 ? currentIdx : 0;
      setModelPickerIndex(idx);
      setModelPickerEffort(clampEffort(status.effort ?? "high", models[idx]?.supportedEffortLevels));
      setModelPickerLoading(false);
    });
  };

  const confirmModelPick = (): void => {
    const picked = modelPickerModels[modelPickerIndex];
    const effort = modelPickerEffort;
    closeModelPicker();
    if (!picked) return;

    const session = getSession();
    if (!session) return;

    const applyEffort = picked.supportsEffort ? session.applyFlagSettings({ effortLevel: effort }) : Promise.resolve();

    void Promise.all([session.setModel(picked.value), applyEffort])
      .then(() => {
        sessionStatus.setModel(picked.resolvedModel ?? picked.value);
        if (picked.supportsEffort) sessionStatus.setEffort(effort);
        const effortNote = picked.supportsEffort ? ` (${effort} effort)` : "";
        chatStore.pushHost(`Switched model to **${picked.displayName}**${effortNote}.`);
      })
      .catch((err: unknown) => {
        chatStore.pushHost(`Could not switch model: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      onExit();
      return;
    }

    if (modelPickerOpen) {
      if (modelPickerModels.length > 0 && key.name === "up") {
        setModelPickerIndex((i) => {
          const next = (i - 1 + modelPickerModels.length) % modelPickerModels.length;
          setModelPickerEffort((e) => clampEffort(e, modelPickerModels[next]?.supportedEffortLevels));
          return next;
        });
      } else if (modelPickerModels.length > 0 && key.name === "down") {
        setModelPickerIndex((i) => {
          const next = (i + 1) % modelPickerModels.length;
          setModelPickerEffort((e) => clampEffort(e, modelPickerModels[next]?.supportedEffortLevels));
          return next;
        });
      } else if (key.name === "left" || key.name === "right") {
        const levels = modelPickerModels[modelPickerIndex]?.supportedEffortLevels;
        if (levels && levels.length > 0) {
          setModelPickerEffort((e) => {
            const idx = levels.indexOf(e);
            const delta = key.name === "left" ? -1 : 1;
            return levels[(idx + delta + levels.length) % levels.length]!;
          });
        }
      } else if (key.name === "escape") {
        closeModelPicker();
      } else if (key.name === "return") {
        // handleSubmit (the input's own onSubmit) is guarded to no-op while the picker is open —
        // see that guard's own comment for why Enter is handled here instead.
        confirmModelPick();
      }
      return;
    }

    if (usagePanelOpen) {
      if (key.name === "escape") closeUsagePanel();
      return;
    }

    if (visibleSuggestions.length > 0) {
      if (key.name === "up") {
        setSelectedIndex((i) => (i - 1 + visibleSuggestions.length) % visibleSuggestions.length);
      } else if (key.name === "down") {
        setSelectedIndex((i) => (i + 1) % visibleSuggestions.length);
      } else if (key.name === "escape") {
        setDismissed(true);
      }
      return;
    }

    // Nothing else claimed Escape (no picker, no panel, no suggestion box) — it stops/interrupts
    // whatever the session is currently doing, matching Claude Code's own Escape behavior.
    if (key.name === "escape") onInterrupt();
  });

  // Deliberately uncontrolled (no `value=` feeding React state back into the renderable) —
  // confirmed by direct testing (testRender + mockInput) that a controlled `<input value={...}>`
  // here makes `onSubmit` close over a stale `value` frozen at mount, always empty, because the
  // reconciler doesn't re-bind `onSubmit` on every render the way `onInput` gets re-bound. Reading
  // `inputRef.current.plainText` inside `onSubmit` instead is always current since it asks the
  // renderable directly rather than trusting a React closure. Enter is handled here rather than in
  // `useKeyboard` above so accepting a suggestion never also submits the un-accepted raw text —
  // both `useKeyboard`'s handler and the focused input's own keypress handling would otherwise see
  // the same "return" keypress (they subscribe to the same underlying event), and only this one
  // spot decides whether Enter means "accept suggestion" or "send message."
  const handleSubmit = (): void => {
    // Both overlays sit on top of the chat column rather than replacing it — the input stays
    // mounted and focused underneath them, so without this guard its own onSubmit would fire
    // alongside useKeyboard's "return" handler for confirmModelPick()/closeUsagePanel(), the same
    // double-firing hazard the suggestion box's comment above describes for the same underlying
    // reason (both subscribe to the same keypress). The overlay owns Enter entirely while it's open.
    if (modelPickerOpen || usagePanelOpen) return;
    if (visibleSuggestions.length > 0) {
      acceptSuggestion(visibleSuggestions[selectedIndex]!);
      return;
    }
    const text = (inputRef.current?.plainText ?? "").trim();
    inputRef.current?.setText("");
    if (text.length === 0) return;
    if (!activePrompt && text === "/model") {
      setInputText("");
      openModelPicker();
      return;
    }
    if (!activePrompt && text === "/usage") {
      setInputText("");
      openUsagePanel();
      return;
    }
    inputRouter.submit(text);
  };

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <scrollbox style={{ flexGrow: 1 }} stickyScroll stickyStart="bottom" focused={false} scrollAcceleration={scrollAcceleration}>
        {blocks.map((block) => renderBlock(block, syntaxStyle, sessionStatus))}
      </scrollbox>
      <SuggestionBox suggestions={visibleSuggestions} selectedIndex={selectedIndex} />
      <box style={{ border: ["top", "bottom"], height: 3, flexShrink: 0 }} title={activePrompt ?? undefined}>
        <textarea
          ref={inputRef}
          placeholder={activePrompt ?? ""}
          keyBindings={CHAT_INPUT_KEY_BINDINGS}
          onContentChange={handleInputChange}
          onSubmit={handleSubmit}
          focused
        />
      </box>
      <StatusBar sessionStatus={sessionStatus} />
      {modelPickerOpen || usagePanelOpen ? (
        // Absolutely positioned on top of the whole column, at a higher zIndex — this covers the
        // chat visually (matching Claude Code's own /model and /usage taking over the screen)
        // WITHOUT ever unmounting the scrollbox above: chat history was always safe either way
        // (chatStore's data lives outside React, independent of what's currently mounted), but this
        // also keeps the scrollbox's own component instance alive, so there's no remount/flicker
        // when the overlay closes.
        // A border alone doesn't occlude what's behind it — confirmed via a real headless render
        // where the welcome banner's text visibly bled through, interleaved character-by-character
        // with the picker's own rows. `backgroundColor` is what actually makes this an opaque
        // layer instead of a transparent one that merely draws borders on top of the same cells.
        <box
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 10,
            flexDirection: "column",
            backgroundColor: BG,
          }}
        >
          {modelPickerOpen ? (
            <ModelPicker
              models={modelPickerModels}
              selectedIndex={modelPickerIndex}
              loading={modelPickerLoading}
              currentModel={sessionStatus.store.get().model}
              effort={modelPickerEffort}
            />
          ) : (
            <UsagePanel loading={usageLoading} error={usageError} data={usageData} />
          )}
        </box>
      ) : null}
      {copiedVisible ? (
        <box style={{ position: "absolute", top: 0, right: 0, zIndex: 20 }}>
          <text content=" Copied " style={{ fg: BG, bg: GOLD }} />
        </box>
      ) : null}
    </box>
  );
}
