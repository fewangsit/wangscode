import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/react";
import { defaultTextareaKeyBindings, MacOSScrollAccel, type KeyBinding, type Renderable, type TextareaRenderable } from "@opentui/core";
import type { EffortLevel, ModelInfo, Query, SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

import type { ChatStore } from "./chat-store.ts";
import type { InputRouter } from "./input-router.ts";
import type { SessionStatusStore } from "./session-status.ts";
import { detectActiveFragment } from "./autocomplete.ts";
import { listFileMentions } from "./file-mentions.ts";
import { listAvailableCommands, type CommandDescriptor } from "../command-registry.ts";
import { createAppSyntaxStyle } from "./syntax-theme.ts";
import { BG, GOLD } from "./theme.ts";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { renderBlock } from "./BlockRenderers.tsx";
import { SuggestionBox, type Suggestion } from "./SuggestionBox.tsx";
import { clampEffort, ModelPicker } from "./ModelPicker.tsx";
import { UsagePanel } from "./UsagePanel.tsx";
import { StatusBar } from "./StatusBar.tsx";

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
  /** Computed once at startup (see repl.tsx) — `null` outside a git repo or before the first commit. */
  gitBranch: string | null;
  /** The package's own version (from package.json) — shown in the welcome banner's version badge. */
  version: string;
  /** Whether Postgres session mirroring is configured (WANGS_CODE_POSTGRES_URL set) — shown in the welcome banner in place of the design reference's fictional "Memory Daemon" line. */
  sessionStoreActive: boolean;
  /** Read fresh on every autocomplete fetch — the underlying session changes across a /resume restart (see repl.tsx). May be undefined for the brief window before the first session is up. */
  getSession: () => Query | undefined;
}

export function App({
  chatStore,
  sessionStatus,
  inputRouter,
  onExit,
  onInterrupt,
  cwd,
  gitBranch,
  version,
  sessionStoreActive,
  getSession,
}: AppProps): React.ReactNode {
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

  // Clicking a command card in the welcome banner — matches the design reference's stageCommand()
  // (fills the input, doesn't submit it), so the user can still edit/add arguments before sending.
  const insertCommand = (cmd: string): void => {
    const next = `${cmd} `;
    inputRef.current?.setText(next);
    setInputText(next);
    inputRef.current?.focus();
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
        {blocks.some((b) => b.kind === "welcome") ? (
          <WelcomeBanner
            sessionStatus={sessionStatus}
            gitBranch={gitBranch}
            version={version}
            sessionStoreActive={sessionStoreActive}
            onCommandClick={insertCommand}
          />
        ) : null}
        {blocks.filter((b) => b.kind !== "welcome").map((block) => renderBlock(block, syntaxStyle))}
      </scrollbox>
      <SuggestionBox suggestions={visibleSuggestions} selectedIndex={selectedIndex} />
      <box
        style={{ border: ["top", "bottom"], height: 3, flexShrink: 0, flexDirection: "row", alignItems: "center" }}
        title={activePrompt ?? undefined}
      >
        {activePrompt ? null : <text content="wangs-code ❯ " style={{ fg: GOLD }} />}
        <textarea
          ref={inputRef}
          placeholder={activePrompt ?? ""}
          keyBindings={CHAT_INPUT_KEY_BINDINGS}
          onContentChange={handleInputChange}
          onSubmit={handleSubmit}
          style={{ flexGrow: 1 }}
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
