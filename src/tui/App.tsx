import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SyntaxStyle, type InputRenderable, type Renderable } from "@opentui/core";
import type { EffortLevel, ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk";

import type { ChatBlock } from "./chat-store.ts";
import type { ChatStore } from "./chat-store.ts";
import type { InputRouter } from "./input-router.ts";
import type { SessionStatusStore } from "./session-status.ts";
import { detectActiveFragment } from "./autocomplete.ts";
import { listFileMentions } from "./file-mentions.ts";
import { listAvailableCommands, type CommandDescriptor } from "../command-registry.ts";

const ROLE_COLOR: Record<string, string> = {
  user: "#7aa2f7",
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

export interface AppProps {
  chatStore: ChatStore;
  sessionStatus: SessionStatusStore;
  inputRouter: InputRouter;
  onExit: () => void;
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
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <ascii-font text="wangs-agent" font="tiny" color="#7aa2f7" />
      <text content="Standalone coding assistant for Wangs Foundation projects." style={{ fg: "#565f89" }} />
      <text content={`cwd: ${cwd ?? "(unknown)"}`} style={{ fg: "#565f89" }} />
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
      return <text key={block.id} content={`💭 ${block.text}`} style={{ fg: "#565f89", marginBottom: block.streaming ? 0 : 1 }} />;
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
        <text key={s.insertText} content={s.label} style={i === selectedIndex ? { fg: "#1a1b26", bg: "#7aa2f7" } : { fg: "#c0caf5" }} />
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
    <box style={{ border: true, flexGrow: 1, flexDirection: "column" }} title="Select model">
      {loading ? (
        <text content="Loading models..." style={{ fg: "#565f89" }} />
      ) : models.length === 0 ? (
        <text content="No models reported by this session." style={{ fg: "#565f89" }} />
      ) : (
        models.map((m, i) => {
          const isCurrent = m.value === currentModel || m.resolvedModel === currentModel;
          const label = `${isCurrent ? "✔" : " "} ${m.displayName} — ${m.description}`;
          return <text key={m.value} content={label} style={i === selectedIndex ? { fg: "#1a1b26", bg: "#7aa2f7" } : { fg: "#c0caf5" }} />;
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
  return <text content={`${status.model ?? "connecting..."} · ${status.permissionMode ?? ""} · ${status.cwd ?? ""}`} style={{ fg: "#414868" }} />;
}

export function App({ chatStore, sessionStatus, inputRouter, onExit, cwd, getSession }: AppProps): React.ReactNode {
  const blocks = useSyncExternalStore(chatStore.store.subscribe, chatStore.store.get);
  const activePrompt = useSyncExternalStore(inputRouter.promptStore.subscribe, inputRouter.promptStore.get);
  const inputRef = useRef<InputRenderable>(null);
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);
  const renderer = useRenderer();

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

  const handleInputChange = (value: string): void => {
    setInputText(value);
    setDismissed(false);
  };

  const acceptSuggestion = (suggestion: Suggestion): void => {
    if (!activeFragment || !inputRef.current) return;
    const current = inputRef.current.value;
    const before = current.slice(0, activeFragment.start);
    const after = current.slice(activeFragment.start + 1 + activeFragment.fragment.length);
    const next = `${before}${activeFragment.trigger}${suggestion.insertText} ${after}`;
    inputRef.current.value = next;
    setInputText(next); // ends with a trailing space, so the next fragment detection naturally comes back null
  };

  const closeModelPicker = (): void => {
    setModelPickerOpen(false);
    if (inputRef.current) inputRef.current.value = "";
    setInputText("");
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
    void session.supportedModels().then((models) => {
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
        // The chat column and input row are unmounted entirely while the picker is open (see the
        // early return in the JSX below, matching Claude Code's own full-screen picker) — there's
        // no focused `<input>` left to fire `onSubmit` through, so Enter is handled directly here
        // instead of going through handleSubmit like every other case in this app.
        confirmModelPick();
      }
      return;
    }

    if (visibleSuggestions.length === 0) return;
    if (key.name === "up") {
      setSelectedIndex((i) => (i - 1 + visibleSuggestions.length) % visibleSuggestions.length);
    } else if (key.name === "down") {
      setSelectedIndex((i) => (i + 1) % visibleSuggestions.length);
    } else if (key.name === "escape") {
      setDismissed(true);
    }
  });

  // Deliberately uncontrolled (no `value=` feeding React state back into the renderable) —
  // confirmed by direct testing (testRender + mockInput) that a controlled `<input value={...}>`
  // here makes `onSubmit` close over a stale `value` frozen at mount, always empty, because the
  // reconciler doesn't re-bind `onSubmit` on every render the way `onInput` gets re-bound. Reading
  // `inputRef.current.value` inside `onSubmit` instead is always current since it asks the
  // renderable directly rather than trusting a React closure. Enter is handled here rather than in
  // `useKeyboard` above so accepting a suggestion never also submits the un-accepted raw text —
  // both `useKeyboard`'s handler and the focused input's own keypress handling would otherwise see
  // the same "return" keypress (they subscribe to the same underlying event), and only this one
  // spot decides whether Enter means "accept suggestion" or "send message."
  const handleSubmit = (): void => {
    if (visibleSuggestions.length > 0) {
      acceptSuggestion(visibleSuggestions[selectedIndex]!);
      return;
    }
    const text = (inputRef.current?.value ?? "").trim();
    if (inputRef.current) inputRef.current.value = "";
    if (text.length === 0) return;
    if (!activePrompt && text === "/model") {
      setInputText("");
      openModelPicker();
      return;
    }
    inputRouter.submit(text);
  };

  // Matches Claude Code's own /model UI: the picker takes over the whole screen — chat column,
  // status bar and the input row are all gone while it's open, not just an overlay on top of
  // them. Enter/Up/Down/Left/Right/Escape are all handled by `useKeyboard` above regardless (a
  // renderer-wide keypress subscription, independent of which widget — if any — is focused), so
  // there's no functional loss from the `<input>` itself being unmounted here.
  if (modelPickerOpen) {
    return (
      <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
        <ModelPicker
          models={modelPickerModels}
          selectedIndex={modelPickerIndex}
          loading={modelPickerLoading}
          currentModel={sessionStatus.store.get().model}
          effort={modelPickerEffort}
        />
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <scrollbox style={{ flexGrow: 1 }} stickyScroll stickyStart="bottom" focused={false}>
        {blocks.map((block) => renderBlock(block, syntaxStyle, sessionStatus))}
      </scrollbox>
      <StatusBar sessionStatus={sessionStatus} />
      <SuggestionBox suggestions={visibleSuggestions} selectedIndex={selectedIndex} />
      <box style={{ border: true, height: 3, flexShrink: 0 }} title={activePrompt ?? undefined}>
        <input
          ref={inputRef}
          placeholder={activePrompt ?? "Type a message, or /create-feature — Ctrl+C to exit"}
          onInput={handleInputChange}
          onSubmit={handleSubmit}
          focused
        />
      </box>
    </box>
  );
}
