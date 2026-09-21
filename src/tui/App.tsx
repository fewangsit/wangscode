import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/react";
import {
  defaultTextareaKeyBindings,
  MacOSScrollAccel,
  type KeyBinding,
  type Renderable,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import type { EffortLevel, McpServerStatus, ModelInfo, Query, SDKControlGetUsageResponse, SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

import { spawn } from "node:child_process";

import type { ChatStore } from "./chat-store.ts";
import type { InputRouter } from "./input-router.ts";
import type { SessionStatusStore } from "./session-status.ts";
import type { PermissionRequestStore } from "../permission-prompt.ts";
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
import { permissionOptionsFor, PermissionPrompt } from "./PermissionPrompt.tsx";
import { SessionPicker, type SessionInfo } from "./SessionPicker.tsx";
import { getServerActions, McpPanel, type McpPanelView, type McpServerAction, MCP_SERVER_ACTIONS } from "./McpPanel.tsx";
import { ArtifactsPanel, type ArtifactItem } from "./ArtifactsPanel.tsx";
import { detectProjectWangsUiVersion, syncWangsUiMcp } from "../mcp-sync.ts";
import { clearMcpToolCache, enrichMcpServersWithTools, fetchServerToolDefinitions, type McpTool } from "../mcp-tools.ts";

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
  /** The package's own version (from package.json) — shown in the welcome banner's version badge. */
  version: string;
  /** Whether Postgres session mirroring is configured (WANGS_CODE_POSTGRES_URL set) — shown in the welcome banner in place of the design reference's fictional "Memory Daemon" line. */
  sessionStoreActive: boolean;
  /** Read fresh on every autocomplete fetch — the underlying session changes across a /resume restart (see repl.tsx). May be undefined for the brief window before the first session is up. */
  getSession: () => Query | undefined;
  /** canUseTool requests land here instead of a plain-text askLine() prompt — see permission-prompt.ts. */
  permissionRequestStore: PermissionRequestStore;
  requestResume?: (sessionId: string) => void;
  sessionStore?: SessionStore;
}

export function App({
  chatStore,
  sessionStatus,
  inputRouter,
  onExit,
  onInterrupt,
  cwd,
  version,
  sessionStoreActive,
  getSession,
  permissionRequestStore,
  requestResume,
  sessionStore,
}: AppProps): React.ReactNode {
  const blocks = useSyncExternalStore(chatStore.store.subscribe, chatStore.store.get);
  const activePrompt = useSyncExternalStore(inputRouter.promptStore.subscribe, inputRouter.promptStore.get);
  const permissionRequest = useSyncExternalStore(permissionRequestStore.store.subscribe, permissionRequestStore.store.get);
  const inputRef = useRef<TextareaRenderable>(null);
  const syntaxStyle = useMemo(() => createAppSyntaxStyle(), []);
  // The default scroll behavior has no acceleration curve at all — every wheel tick moves the
  // same fixed amount regardless of how fast the gesture is, which reads as stepped/jerky rather
  // than smooth. MacOSScrollAccel ramps up for quick successive ticks and stays precise for slow
  // ones; memoized once so its own internal velocity-history state persists across scroll events
  // instead of resetting on every render.
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel({ A: 1.2, tau: 3, maxMultiplier: 8 }), []);
  const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // Suspends stickyScroll when the user has scrolled up to read earlier history,
  // preventing streaming output from yanking the viewport back down.
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const renderer = useRenderer();

  const setChatScrollRef = (node: ScrollBoxRenderable | null): void => {
    chatScrollRef.current = node;
    if (!node) return;
    // Strictly disable keyboard handling and focus on the chat scrollbox and all its children
    // so Up/Down arrow keys NEVER scroll the chat history under any circumstances.
    node.focusable = false;
    node.verticalScrollBar.focusable = false;
    node.horizontalScrollBar.focusable = false;
    node.wrapper.focusable = false;
    node.viewport.focusable = false;
    node.content.focusable = false;
    node.handleKeyPress = () => false;
    node.verticalScrollBar.handleKeyPress = () => false;
    node.horizontalScrollBar.handleKeyPress = () => false;
    node.blur();
    node.verticalScrollBar.blur();
    node.horizontalScrollBar.blur();

    const vsb = node.verticalScrollBar as unknown as {
      _onChange?: (position: number) => void;
      _wrappedOnChange?: boolean;
    };
    if (!vsb._wrappedOnChange) {
      const originalOnChange = vsb._onChange;
      vsb._wrappedOnChange = true;
      vsb._onChange = (position: number) => {
        originalOnChange?.(position);
        const maxScrollTop = Math.max(0, node.scrollHeight - node.viewport.height);
        setIsUserScrolledUp(position < maxScrollTop - 1);
      };
    }
  };

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

  // Mirrors the uncontrolled input's text purely to drive the @/-mention overlay below — the
  // ref-based value stays the single source of truth for what actually gets submitted (see
  // handleSubmit), so this mirror being one render tick behind on a fast paste is harmless.
  const [inputText, setInputText] = useState("");
  // Tracks total line count and vertical scroll offset of the chat input textarea to dynamically
  // grow the input box up to 10 lines and show +Nline indicators on top/bottom borders when overflowing.
  const [inputScrollState, setInputScrollState] = useState({ lines: 1, scrollY: 0 });
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

  // The /usage docked overlay — same "handled entirely in App.tsx" reasoning as /model above.
  const [usagePanelOpen, setUsagePanelOpen] = useState(false);
  const [usageData, setUsageData] = useState<SDKControlGetUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  // The interactive /resume session picker overlay — same pattern as /model and /usage.
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [sessionPickerSessions, setSessionPickerSessions] = useState<SessionInfo[]>([]);
  const [sessionPickerIndex, setSessionPickerIndex] = useState(0);
  const [sessionPickerLoading, setSessionPickerLoading] = useState(false);

  // The interactive /mcp overlay — same pattern as /model, /usage, and /resume.
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [mcpPanelView, setMcpPanelView] = useState<McpPanelView>({ kind: "servers", selectedIdx: 0 });
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const mcpToolDetailScrollRef = useRef<ScrollBoxRenderable | null>(null);

  // The interactive /artifacts overlay — same pattern as /mcp, /model, etc.
  const [artifactsPanelOpen, setArtifactsPanelOpen] = useState(false);
  const [artifactsSelectedIndex, setArtifactsSelectedIndex] = useState(0);

  // The canUseTool permission overlay — reset to the first option each time a *different* request
  // comes in (identity check via toolName+label, since `permissionRequest` is a fresh object per
  // call) so a previous answer's selection doesn't carry over to the next, unrelated prompt.
  const [permissionSelectedIndex, setPermissionSelectedIndex] = useState(0);
  const permissionScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const lastPermissionKeyRef = useRef<string | null>(null);
  const permissionKey = permissionRequest ? `${permissionRequest.toolName}:${permissionRequest.label}` : null;
  if (permissionKey !== lastPermissionKeyRef.current) {
    lastPermissionKeyRef.current = permissionKey;
    if (permissionKey !== null && permissionSelectedIndex !== 0) setPermissionSelectedIndex(0);
  }
  useEffect(() => {
    if (permissionScrollRef.current) {
      permissionScrollRef.current.scrollTop = 0;
    }
  }, [permissionKey]);
  const permissionOptions = permissionOptionsFor(permissionRequest?.suggestions !== undefined);

  const isOverlayActive = Boolean(permissionRequest || usagePanelOpen || modelPickerOpen || sessionPickerOpen || mcpPanelOpen || artifactsPanelOpen);

  // When no overlay is active, the chat input is the only real input in the app.
  // Steal focus back to the input if something else (like scrollback) is clicked.
  // When an overlay is active (e.g. /artifacts, /model, /mcp), we do not steal focus.
  useEffect(() => {
    const handleFocusChange = (renderable: Renderable | null): void => {
      if (isOverlayActive) return;
      if (renderable !== inputRef.current) {
        renderable?.blur();
        inputRef.current?.focus();
      }
    };
    renderer.on("focused_renderable", handleFocusChange);
    return () => {
      renderer.off("focused_renderable", handleFocusChange);
    };
  }, [renderer, isOverlayActive]);

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
        apply(matches.map((c) => ({ insertText: c.name.slice(1), label: c.name, description: c.description })));
      });
    }
  }, [activeFragment, cwd, getSession, sessionStatus]);

  const lastScrollYRef = useRef(0);

  const updateInputDimensions = (): void => {
    const read = (): void => {
      const ta = inputRef.current;
      if (!ta) return;
      const text = ta.plainText;
      const rawLineCount = text.length === 0 ? 1 : text.split(/\r?\n/).length;
      const count = Math.max(
        1,
        (ta as unknown as { editorView?: { getTotalVirtualLineCount?: () => number } }).editorView?.getTotalVirtualLineCount?.() ?? 0,
        ta.virtualLineCount || 0,
        ta.lineCount || 0,
        rawLineCount,
      );
      const scrollY = ta.scrollY || 0;
      lastScrollYRef.current = scrollY;
      setInputScrollState((prev) => {
        if (prev.lines === count && prev.scrollY === scrollY) return prev;
        return { lines: count, scrollY };
      });
    };
    read();
    queueMicrotask(read);
  };

  const setInputRef = (node: TextareaRenderable | null): void => {
    const prev = inputRef.current;
    if (prev && prev !== node) {
      prev.blur();
    }
    (inputRef as { current: TextareaRenderable | null }).current = node;
    if (!node) return;

    if (!isOverlayActive) {
      node.focus();
    }

    const ta = node as unknown as {
      handleScroll: (event: unknown) => void;
      onUpdate: (deltaTime: number) => void;
      onMouseEvent?: (event: { type?: string }) => void;
      _wrappedScrollListeners?: boolean;
    };

    if (!ta._wrappedScrollListeners) {
      ta._wrappedScrollListeners = true;

      const origHandleScroll = ta.handleScroll.bind(node);
      ta.handleScroll = (event: unknown) => {
        origHandleScroll(event);
        updateInputDimensions();
      };

      const origSetViewport = node.editorView.setViewport.bind(node.editorView);
      node.editorView.setViewport = (...args: Parameters<typeof origSetViewport>) => {
        origSetViewport(...args);
        updateInputDimensions();
      };

      const origOnUpdate = ta.onUpdate.bind(node);
      ta.onUpdate = (deltaTime: number) => {
        origOnUpdate(deltaTime);
        const scrollY = node.scrollY || 0;
        if (lastScrollYRef.current !== scrollY) {
          lastScrollYRef.current = scrollY;
          updateInputDimensions();
        }
      };

      const origOnMouseEvent = ta.onMouseEvent?.bind(node);
      ta.onMouseEvent = (event: { type?: string }) => {
        origOnMouseEvent?.(event);
        if (event.type === "scroll" || event.type === "drag" || event.type === "up") {
          updateInputDimensions();
        }
      };
    }
  };

  // `<textarea>`'s change event (`ContentChangeEvent`) carries no payload — unlike `<input>`'s
  // `onInput`, which handed back the new value directly — so the current text is read straight off
  // the renderable instead.
  const handleInputChange = (): void => {
    setInputText(inputRef.current?.plainText ?? "");
    setDismissed(false);
    updateInputDimensions();
  };

  const acceptSuggestion = (suggestion: Suggestion): void => {
    if (!activeFragment || !inputRef.current) return;
    const current = inputRef.current.plainText;
    const before = current.slice(0, activeFragment.start);
    const after = current.slice(activeFragment.start + 1 + activeFragment.fragment.length);
    const inserted = `${activeFragment.trigger}${suggestion.insertText} `;
    const next = `${before}${inserted}${after}`;
    inputRef.current.setText(next);
    inputRef.current.cursorOffset = before.length + inserted.length;
    inputRef.current.focus();
    setInputText(next); // ends with a trailing space, so the next fragment detection naturally comes back null
    updateInputDimensions();
  };

  // Clicking a command card in the welcome banner — matches the design reference's stageCommand()
  // (fills the input, doesn't submit it), so the user can still edit/add arguments before sending.
  const insertCommand = (cmd: string): void => {
    const next = `${cmd} `;
    inputRef.current?.setText(next);
    if (inputRef.current) {
      inputRef.current.cursorOffset = next.length;
    }
    setInputText(next);
    inputRef.current?.focus();
    updateInputDimensions();
  };

  const closeModelPicker = (): void => {
    setModelPickerOpen(false);
    setInputText("");
    setInputScrollState({ lines: 1, scrollY: 0 });
    queueMicrotask(() => {
      inputRef.current?.setText("");
      inputRef.current?.focus();
    });
  };

  const closeUsagePanel = (): void => {
    setUsagePanelOpen(false);
    setInputText("");
    setInputScrollState({ lines: 1, scrollY: 0 });
    queueMicrotask(() => {
      inputRef.current?.setText("");
      inputRef.current?.focus();
    });
  };

  const openUsagePanel = (): void => {
    inputRef.current?.blur();
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
    inputRef.current?.blur();
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

  const closeSessionPicker = (): void => {
    setSessionPickerOpen(false);
    setInputText("");
    setInputScrollState({ lines: 1, scrollY: 0 });
    queueMicrotask(() => {
      inputRef.current?.setText("");
      inputRef.current?.focus();
    });
  };

  const openSessionPicker = (): void => {
    inputRef.current?.blur();
    setSessionPickerOpen(true);
    setSessionPickerLoading(true);
    setSessionPickerSessions([]);
    setSessionPickerIndex(0);

    void listSessions({
      dir: cwd,
      ...(sessionStore ? { sessionStore } : {}),
    })
      .then((sessions) => {
        setSessionPickerSessions(sessions);
        setSessionPickerLoading(false);
      })
      .catch((err: unknown) => {
        chatStore.pushHost(`Could not list sessions: ${err instanceof Error ? err.message : String(err)}`);
        setSessionPickerLoading(false);
      });
  };

  const confirmSessionPick = (): void => {
    const picked = sessionPickerSessions[sessionPickerIndex];
    closeSessionPicker();
    if (!picked) return;
    const title = picked.summary || picked.firstPrompt || picked.sessionId;
    chatStore.pushHost(`Resuming session **${title}**...`);
    requestResume?.(picked.sessionId);
  };

  const closeArtifactsPanel = (): void => {
    setArtifactsPanelOpen(false);
    setInputText("");
    setInputScrollState({ lines: 1, scrollY: 0 });
    queueMicrotask(() => {
      inputRef.current?.setText("");
      inputRef.current?.focus();
    });
  };

  const openArtifactsPanel = (): void => {
    inputRef.current?.blur();
    setArtifactsPanelOpen(true);
    setArtifactsSelectedIndex(0);
  };

  const openUrl = (url: string): void => {
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    try {
      spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
    } catch {
      // ignore
    }
  };

  const handleCopyArtifactUrl = (url: string): void => {
    if (renderer.copyToClipboardOSC52(url)) {
      setCopiedVisible(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedVisible(false), 1500);
    }
  };

  const sessionArtifacts = useMemo<ArtifactItem[]>(() => {
    const list: ArtifactItem[] = [];
    const seen = new Set<string>();

    const mdRegex = /\[([^\]]+)\]\((https:\/\/claude\.ai\/(?:code\/)?artifact\/[a-zA-Z0-9_-]+)\)/g;
    const rawRegex = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[a-zA-Z0-9_-]+/g;

    for (const b of blocks) {
      let content = "";
      if (b.kind === "assistant" || b.kind === "host" || b.kind === "user") {
        content = b.text;
      } else if (b.kind === "tool") {
        content = (b.resultText ?? "") + " " + JSON.stringify(b.input ?? "");
      }

      for (const match of content.matchAll(mdRegex)) {
        const title = match[1];
        const url = match[2];
        if (url && !seen.has(url)) {
          seen.add(url);
          list.push({ title, url });
        }
      }

      const rawMatches = content.match(rawRegex);
      if (rawMatches) {
        for (const url of rawMatches) {
          if (!seen.has(url)) {
            seen.add(url);
            list.push({ url });
          }
        }
      }
    }
    return list;
  }, [blocks]);

  const closeMcpPanel = (): void => {
    mcpActionSeqRef.current++;
    setMcpPanelOpen(false);
    setMcpLoading(false);
    setInputText("");
    setInputScrollState({ lines: 1, scrollY: 0 });
    queueMicrotask(() => {
      inputRef.current?.setText("");
      inputRef.current?.focus();
    });
  };

  const openMcpPanel = (): void => {
    inputRef.current?.blur();
    setMcpPanelOpen(true);
    setMcpLoading(true);
    setMcpPanelView({ kind: "servers", selectedIdx: 0 });
    setMcpServers([]);

    const session = getSession();
    if (!session) {
      setMcpLoading(false);
      return;
    }
    void session
      .mcpServerStatus()
      .then((servers) => {
        let list = servers;
        const hasWangsUi = servers.some((s) => s.name === "wangs-ui");
        if (!hasWangsUi) {
          const wangsVersion = cwd ? detectProjectWangsUiVersion(cwd) : null;
          list = [
            ...servers,
            {
              name: "wangs-ui",
              status: "disabled",
              error: wangsVersion ? "Not configured in project .mcp.json" : "Not installed (@wangs-ui not detected in project)",
              scope: "project",
            },
          ];
        }
        setMcpServers(list);
        setMcpLoading(false);

        void enrichMcpServersWithTools(list, cwd).then((enriched) => {
          setMcpServers(enriched);
        });
      })
      .catch((err: unknown) => {
        chatStore.pushHost(`Could not list MCP servers: ${err instanceof Error ? err.message : String(err)}`);
        setMcpLoading(false);
      });
  };

  const mcpActionSeqRef = useRef(0);

  const handleMcpAction = async (serverIdx: number, action: McpServerAction): Promise<void> => {
    const server = mcpServers[serverIdx];
    if (!server) return;

    if (action === "Show Tools") {
      setMcpPanelView({ kind: "tools", serverIdx, selectedIdx: 0 });
      const currentTools = server.tools as McpTool[] | undefined;
      const needsEnrichment = !currentTools || currentTools.length === 0 || currentTools.some((t) => !t.description && !t.inputSchema);
      if (needsEnrichment) {
        void fetchServerToolDefinitions(server, cwd).then((enrichedTools) => {
          if (enrichedTools.length > 0) {
            setMcpServers((prev) => {
              const updated = [...prev];
              const s = updated[serverIdx];
              if (s) {
                updated[serverIdx] = { ...s, tools: enrichedTools };
              }
              return updated;
            });
          }
        });
      }
      return;
    }

    const session = getSession();
    if (!session) return;

    if (action.startsWith("Update to @wangs-ui/mcp@") || action.startsWith("Install @wangs-ui/mcp@") || action.startsWith("Sync with project")) {
      const seq = ++mcpActionSeqRef.current;
      setMcpLoading(true);
      try {
        clearMcpToolCache("wangs-ui");
        const versionMatch = action.match(/@wangs-ui\/mcp@([^ )]+)/);
        const explicitVersion = versionMatch?.[1];

        const res = await syncWangsUiMcp(cwd, session, explicitVersion);
        if (!res.success) {
          chatStore.pushHost(`Could not sync @wangs-ui/mcp: ${res.error}`);
          return;
        }

        // Reconnection runs asynchronously in the subprocess.
        // Poll mcpServerStatus() every 400ms until status becomes "connected"
        const startTime = Date.now();
        const timeoutMs = 10000;
        let lastServers: McpServerStatus[] = [];
        let target: McpServerStatus | undefined;

        while (Date.now() - startTime < timeoutMs) {
          if (mcpActionSeqRef.current !== seq) return;
          await new Promise((r) => setTimeout(r, 400));
          if (mcpActionSeqRef.current !== seq) return;

          lastServers = await session.mcpServerStatus();
          target = lastServers.find((s) => s.name === "wangs-ui");

          setMcpServers(lastServers);
          const newIdx = lastServers.findIndex((s) => s.name === "wangs-ui");
          if (newIdx !== -1) {
            setMcpPanelView((v) => (v.kind === "actions" || v.kind === "tools" || v.kind === "tool-detail" ? { ...v, serverIdx: newIdx } : v));
          }

          if (target?.status === "connected") {
            break;
          }

          if (target?.status === "failed" && Date.now() - startTime > 2000) {
            break;
          }
        }

        if (target?.status === "connected") {
          void fetchServerToolDefinitions(target, cwd).then((enrichedTools) => {
            if (enrichedTools.length > 0) {
              setMcpServers((prev) => {
                const updated = [...prev];
                const newIdx = updated.findIndex((s) => s.name === "wangs-ui");
                if (newIdx !== -1) {
                  updated[newIdx] = { ...updated[newIdx], tools: enrichedTools };
                }
                return updated;
              });
            }
          });
          chatStore.pushHost(`Connected to MCP server **wangs-ui** (@wangs-ui/mcp@${res.targetVersion}, ${target.tools?.length ?? 0} tools).`);
        } else if (target?.error) {
          chatStore.pushHost(`Failed to connect wangs-ui MCP server: ${target.error}`);
        } else {
          chatStore.pushHost(`Configured @wangs-ui/mcp@${res.targetVersion} in .mcp.json.`);
        }
      } catch (err) {
        chatStore.pushHost(`Failed to sync wangs-ui MCP: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (mcpActionSeqRef.current === seq) {
          setMcpLoading(false);
        }
      }
      return;
    }

    if (action === "Reconnect") {
      const seq = ++mcpActionSeqRef.current;
      setMcpLoading(true);
      try {
        clearMcpToolCache(server.name);
        await session.reconnectMcpServer(server.name);

        // Reconnection in the MCP subprocess runs asynchronously.
        // Poll mcpServerStatus() every 400ms until status becomes "connected"
        // or a confirmed failure after at least 2s, with a 10s maximum timeout.
        const startTime = Date.now();
        const timeoutMs = 10000;
        let lastServers: McpServerStatus[] = [];
        let target: McpServerStatus | undefined;

        while (Date.now() - startTime < timeoutMs) {
          if (mcpActionSeqRef.current !== seq) return;
          await new Promise((r) => setTimeout(r, 400));
          if (mcpActionSeqRef.current !== seq) return;

          lastServers = await session.mcpServerStatus();
          target = lastServers.find((s) => s.name === server.name);

          // Update server list state so UI reflects live status
          setMcpServers(lastServers);
          const newIdx = lastServers.findIndex((s) => s.name === server.name);
          if (newIdx !== -1) {
            setMcpPanelView((v) => (v.kind === "actions" || v.kind === "tools" || v.kind === "tool-detail" ? { ...v, serverIdx: newIdx } : v));
          }

          if (target?.status === "connected") {
            break;
          }

          if (target?.status === "failed" && Date.now() - startTime > 2000) {
            break;
          }
        }

        if (target?.status === "connected") {
          void fetchServerToolDefinitions(target, cwd).then((enrichedTools) => {
            if (enrichedTools.length > 0) {
              setMcpServers((prev) => {
                const updated = [...prev];
                const newIdx = updated.findIndex((s) => s.name === server.name);
                if (newIdx !== -1) {
                  updated[newIdx] = { ...updated[newIdx], tools: enrichedTools };
                }
                return updated;
              });
            }
          });
          chatStore.pushHost(`Connected to MCP server **${server.name}** (${target.tools?.length ?? 0} tools).`);
        } else if (target?.error) {
          chatStore.pushHost(`Failed to reconnect **${server.name}**: ${target.error}`);
        }
      } catch (err) {
        chatStore.pushHost(`Failed to reconnect ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (mcpActionSeqRef.current === seq) {
          setMcpLoading(false);
        }
      }
      return;
    }

    if (action === "Toggle") {
      const seq = ++mcpActionSeqRef.current;
      setMcpLoading(true);
      try {
        const enable = server.status === "disabled";
        await session.toggleMcpServer(server.name, enable);

        if (enable) {
          // Enabling a server connects it asynchronously — poll until connected or timeout
          const startTime = Date.now();
          const timeoutMs = 10000;
          let lastServers: McpServerStatus[] = [];
          let target: McpServerStatus | undefined;

          while (Date.now() - startTime < timeoutMs) {
            if (mcpActionSeqRef.current !== seq) return;
            await new Promise((r) => setTimeout(r, 400));
            if (mcpActionSeqRef.current !== seq) return;

            lastServers = await session.mcpServerStatus();
            target = lastServers.find((s) => s.name === server.name);
            setMcpServers(lastServers);
            const newIdx = lastServers.findIndex((s) => s.name === server.name);
            if (newIdx !== -1) {
              setMcpPanelView((v) => (v.kind === "actions" || v.kind === "tools" || v.kind === "tool-detail" ? { ...v, serverIdx: newIdx } : v));
            }

            if (target?.status === "connected" || (target?.status === "failed" && Date.now() - startTime > 2000)) {
              break;
            }
          }
        } else {
          // Disabling is fast — fetch once
          const updated = await session.mcpServerStatus();
          setMcpServers(updated);
        }
      } catch (err) {
        chatStore.pushHost(`Failed to toggle ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (mcpActionSeqRef.current === seq) {
          setMcpLoading(false);
        }
      }
      return;
    }
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      onExit();
      return;
    }

    if (!sessionPickerOpen && !modelPickerOpen && !usagePanelOpen && !mcpPanelOpen && !artifactsPanelOpen && !permissionRequest) {
      updateInputDimensions();
    }

    if (permissionRequest) {
      if (key.name === "pageup" || (key.shift && key.name === "up")) {
        if (permissionScrollRef.current) {
          permissionScrollRef.current.scrollBy(-2);
        }
        return;
      }
      if (key.name === "pagedown" || (key.shift && key.name === "down")) {
        if (permissionScrollRef.current) {
          permissionScrollRef.current.scrollBy(2);
        }
        return;
      }
      if (key.name === "up") {
        setPermissionSelectedIndex((i) => (i - 1 + permissionOptions.length) % permissionOptions.length);
      } else if (key.name === "down") {
        setPermissionSelectedIndex((i) => (i + 1) % permissionOptions.length);
      } else if (key.name === "escape") {
        permissionRequest.resolve({ behavior: "deny", message: "User declined this tool call." });
      } else if (key.name === "return") {
        const picked = permissionOptions[permissionSelectedIndex];
        if (picked?.choice === "deny") {
          permissionRequest.resolve({ behavior: "deny", message: "User declined this tool call." });
        } else if (picked?.choice === "always-allow") {
          permissionRequest.resolve({ behavior: "allow", updatedInput: permissionRequest.input, updatedPermissions: permissionRequest.suggestions });
        } else {
          permissionRequest.resolve({ behavior: "allow", updatedInput: permissionRequest.input });
        }
      }
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

    if (sessionPickerOpen) {
      if (sessionPickerSessions.length > 0 && key.name === "up") {
        setSessionPickerIndex((i) => (i - 1 + sessionPickerSessions.length) % sessionPickerSessions.length);
      } else if (sessionPickerSessions.length > 0 && key.name === "down") {
        setSessionPickerIndex((i) => (i + 1) % sessionPickerSessions.length);
      } else if (key.name === "escape") {
        closeSessionPicker();
      } else if (key.name === "return") {
        confirmSessionPick();
      }
      return;
    }

    if (mcpPanelOpen) {
      if (mcpPanelView.kind === "servers") {
        if (mcpServers.length > 0 && key.name === "up") {
          setMcpPanelView({ ...mcpPanelView, selectedIdx: (mcpPanelView.selectedIdx - 1 + mcpServers.length) % mcpServers.length });
        } else if (mcpServers.length > 0 && key.name === "down") {
          setMcpPanelView({ ...mcpPanelView, selectedIdx: (mcpPanelView.selectedIdx + 1) % mcpServers.length });
        } else if (key.name === "escape") {
          closeMcpPanel();
        } else if (key.name === "return") {
          if (mcpServers.length > 0) {
            setMcpPanelView({ kind: "actions", serverIdx: mcpPanelView.selectedIdx, selectedIdx: 0 });
          }
        }
      } else if (mcpPanelView.kind === "actions") {
        if (mcpLoading) {
          if (key.name === "escape") {
            closeMcpPanel();
          }
          return;
        }
        const server = mcpServers[mcpPanelView.serverIdx];
        const actions = server ? getServerActions(server, cwd) : MCP_SERVER_ACTIONS;
        if (key.name === "up") {
          setMcpPanelView({ ...mcpPanelView, selectedIdx: (mcpPanelView.selectedIdx - 1 + actions.length) % actions.length });
        } else if (key.name === "down") {
          setMcpPanelView({ ...mcpPanelView, selectedIdx: (mcpPanelView.selectedIdx + 1) % actions.length });
        } else if (key.name === "escape") {
          setMcpPanelView({ kind: "servers", selectedIdx: mcpPanelView.serverIdx });
        } else if (key.name === "return") {
          const action = actions[mcpPanelView.selectedIdx];
          if (action) {
            void handleMcpAction(mcpPanelView.serverIdx, action);
          }
        }
      } else if (mcpPanelView.kind === "tools") {
        const server = mcpServers[mcpPanelView.serverIdx];
        const tools = server?.tools ?? [];
        if (tools.length > 0 && key.name === "up") {
          setMcpPanelView({ ...mcpPanelView, selectedIdx: (mcpPanelView.selectedIdx - 1 + tools.length) % tools.length });
        } else if (tools.length > 0 && key.name === "down") {
          setMcpPanelView({ ...mcpPanelView, selectedIdx: (mcpPanelView.selectedIdx + 1) % tools.length });
        } else if (key.name === "escape") {
          setMcpPanelView({ kind: "actions", serverIdx: mcpPanelView.serverIdx, selectedIdx: 0 });
        } else if (key.name === "return") {
          if (tools.length > 0) {
            setMcpPanelView({ kind: "tool-detail", serverIdx: mcpPanelView.serverIdx, toolIdx: mcpPanelView.selectedIdx });
            const s = mcpServers[mcpPanelView.serverIdx];
            const currentTools = s?.tools as McpTool[] | undefined;
            const needsEnrichment = !currentTools || currentTools.length === 0 || currentTools.some((t) => !t.description && !t.inputSchema);
            if (s && needsEnrichment) {
              void fetchServerToolDefinitions(s, cwd).then((enrichedTools) => {
                if (enrichedTools.length > 0) {
                  setMcpServers((prev) => {
                    const updated = [...prev];
                    const target = updated[mcpPanelView.serverIdx];
                    if (target) {
                      updated[mcpPanelView.serverIdx] = { ...target, tools: enrichedTools };
                    }
                    return updated;
                  });
                }
              });
            }
          }
        }
      } else if (mcpPanelView.kind === "tool-detail") {
        if (key.name === "up") {
          if (mcpToolDetailScrollRef.current) {
            mcpToolDetailScrollRef.current.scrollTop = Math.max(0, mcpToolDetailScrollRef.current.scrollTop - 2);
          }
        } else if (key.name === "down") {
          if (mcpToolDetailScrollRef.current) {
            mcpToolDetailScrollRef.current.scrollTop += 2;
          }
        } else if (key.name === "escape") {
          setMcpPanelView({ kind: "tools", serverIdx: mcpPanelView.serverIdx, selectedIdx: mcpPanelView.toolIdx });
        }
      }
      return;
    }

    if (artifactsPanelOpen) {
      const defaultUrl = "https://claude.ai/code/artifacts";
      const selectedItem = sessionArtifacts[artifactsSelectedIndex];
      const activeUrl = selectedItem?.url ?? defaultUrl;

      if (sessionArtifacts.length > 0 && key.name === "up") {
        setArtifactsSelectedIndex((i) => (i - 1 + sessionArtifacts.length) % sessionArtifacts.length);
      } else if (sessionArtifacts.length > 0 && key.name === "down") {
        setArtifactsSelectedIndex((i) => (i + 1) % sessionArtifacts.length);
      } else if (key.name === "escape") {
        closeArtifactsPanel();
      } else if (key.name === "return" || key.name === "o") {
        openUrl(activeUrl);
      } else if (key.name === "c") {
        handleCopyArtifactUrl(activeUrl);
      } else if (key.name === "g") {
        openUrl(defaultUrl);
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
      } else if (key.name === "tab") {
        key.preventDefault?.();
        key.stopPropagation?.();
        if (key.shift) {
          setSelectedIndex((i) => (i - 1 + visibleSuggestions.length) % visibleSuggestions.length);
        } else {
          const picked = visibleSuggestions[selectedIndex];
          if (picked) acceptSuggestion(picked);
        }
      } else if (key.name === "escape") {
        setDismissed(true);
      }
      return;
    }

    // Keyboard scrolling for chat scrollbox when no modals/pickers/suggestions are active
    if (key.name === "pageup") {
      if (chatScrollRef.current) {
        const halfPage = Math.max(5, Math.floor((chatScrollRef.current.viewport.height || 20) / 2));
        chatScrollRef.current.scrollBy(-halfPage);
        setIsUserScrolledUp(true);
      }
      return;
    }
    if (key.name === "pagedown") {
      if (chatScrollRef.current) {
        const halfPage = Math.max(5, Math.floor((chatScrollRef.current.viewport.height || 20) / 2));
        chatScrollRef.current.scrollBy(halfPage);
        const maxScrollTop = Math.max(0, chatScrollRef.current.scrollHeight - chatScrollRef.current.viewport.height);
        if (chatScrollRef.current.scrollTop >= maxScrollTop - 1) {
          setIsUserScrolledUp(false);
        }
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
    if (sessionPickerOpen || modelPickerOpen || usagePanelOpen || mcpPanelOpen || artifactsPanelOpen) return;
    if (visibleSuggestions.length > 0) {
      acceptSuggestion(visibleSuggestions[selectedIndex]!);
      return;
    }
    const text = (inputRef.current?.plainText ?? "").trim();
    inputRef.current?.setText("");
    setInputScrollState({ lines: 1, scrollY: 0 });
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
    if (!activePrompt && text === "/mcp") {
      setInputText("");
      openMcpPanel();
      return;
    }
    if (!activePrompt && text === "/artifacts") {
      setInputText("");
      openArtifactsPanel();
      return;
    }
    if (!activePrompt && (text === "/resume" || text.startsWith("/resume "))) {
      const arg = text.slice("/resume".length).trim();
      setInputText("");
      if (arg.length > 0) {
        chatStore.pushHost(`Resuming session ${arg}...`);
        requestResume?.(arg);
        return;
      }
      openSessionPicker();
      return;
    }
    setIsUserScrolledUp(false);
    chatScrollRef.current?.scrollTo(chatScrollRef.current.scrollHeight);
    inputRouter.submit(text);
  };

  const isStreaming = useMemo(
    () => blocks.some((b) => ((b.kind === "assistant" || b.kind === "thinking") && b.streaming) || (b.kind === "tool" && b.status === "running")),
    [blocks],
  );

  const visibleLines = Math.min(10, Math.max(1, inputScrollState.lines));
  const linesAbove = Math.max(0, inputScrollState.scrollY);
  const linesBelow = Math.max(0, inputScrollState.lines - (inputScrollState.scrollY + visibleLines));

  const topTitle = activePrompt
    ? linesAbove > 0
      ? `${activePrompt}  +${linesAbove}line`
      : activePrompt
    : linesAbove > 0
      ? `+${linesAbove}line`
      : undefined;

  const topTitleAlignment: "left" | "right" = activePrompt && linesAbove === 0 ? "left" : "right";
  const bottomTitle = linesBelow > 0 ? `+${linesBelow}line` : undefined;

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <scrollbox
        ref={setChatScrollRef}
        style={{ flexGrow: 1 }}
        stickyScroll={isStreaming && !isUserScrolledUp}
        stickyStart="bottom"
        focused={false}
        focusable={false}
        scrollAcceleration={scrollAcceleration}
        scrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
        viewportCulling={false}
      >
        {blocks.some((b) => b.kind === "welcome") ? (
          <WelcomeBanner
            sessionStatus={sessionStatus}
            version={version}
            sessionStoreActive={sessionStoreActive}
            cwd={cwd}
            onCommandClick={insertCommand}
          />
        ) : null}
        {blocks.filter((b) => b.kind !== "welcome").map((block) => renderBlock(block, syntaxStyle))}
      </scrollbox>

      {permissionRequest ? (
        <box style={{ flexShrink: 0 }}>
          <PermissionPrompt
            label={permissionRequest.label}
            mcpServerName={permissionRequest.mcpServerName}
            options={permissionOptions}
            selectedIndex={permissionSelectedIndex}
            maxContentHeight={Math.max(3, Math.min(10, Math.floor((renderer.height || 24) * 0.35)))}
            scrollRef={permissionScrollRef}
            onDeny={() => permissionRequest.resolve({ behavior: "deny", message: "User declined this tool call." })}
            onSelect={(idx) => {
              const picked = permissionOptions[idx];
              if (picked?.choice === "deny") {
                permissionRequest.resolve({ behavior: "deny", message: "User declined this tool call." });
              } else if (picked?.choice === "always-allow") {
                permissionRequest.resolve({
                  behavior: "allow",
                  updatedInput: permissionRequest.input,
                  updatedPermissions: permissionRequest.suggestions,
                });
              } else {
                permissionRequest.resolve({ behavior: "allow", updatedInput: permissionRequest.input });
              }
            }}
          />
        </box>
      ) : usagePanelOpen ? (
        <box style={{ flexShrink: 0 }}>
          <UsagePanel loading={usageLoading} error={usageError} data={usageData} onBack={closeUsagePanel} />
        </box>
      ) : modelPickerOpen ? (
        <box style={{ flexShrink: 0 }}>
          <ModelPicker
            models={modelPickerModels}
            selectedIndex={modelPickerIndex}
            loading={modelPickerLoading}
            currentModel={sessionStatus.store.get().model}
            effort={modelPickerEffort}
            onCancel={closeModelPicker}
            onSelect={(idx) => {
              setModelPickerIndex(idx);
              confirmModelPick();
            }}
          />
        </box>
      ) : sessionPickerOpen ? (
        <box style={{ flexShrink: 0 }}>
          <SessionPicker
            sessions={sessionPickerSessions}
            selectedIndex={sessionPickerIndex}
            loading={sessionPickerLoading}
            onCancel={closeSessionPicker}
            onSelect={(idx) => {
              setSessionPickerIndex(idx);
              confirmSessionPick();
            }}
          />
        </box>
      ) : mcpPanelOpen ? (
        <box style={{ flexShrink: 0 }}>
          <McpPanel
            view={mcpPanelView}
            servers={mcpServers}
            loading={mcpLoading}
            cwd={cwd}
            toolDetailScrollRef={mcpToolDetailScrollRef}
            onClose={closeMcpPanel}
            onBack={() => {
              if (mcpPanelView.kind === "tool-detail") {
                setMcpPanelView({ kind: "tools", serverIdx: mcpPanelView.serverIdx, selectedIdx: mcpPanelView.toolIdx });
              } else if (mcpPanelView.kind === "tools") {
                setMcpPanelView({ kind: "actions", serverIdx: mcpPanelView.serverIdx, selectedIdx: 0 });
              } else if (mcpPanelView.kind === "actions") {
                setMcpPanelView({ kind: "servers", selectedIdx: mcpPanelView.serverIdx });
              } else {
                closeMcpPanel();
              }
            }}
            onSelectServer={(idx) => {
              setMcpPanelView({ kind: "actions", serverIdx: idx, selectedIdx: 0 });
            }}
            onSelectAction={(serverIdx, action) => {
              void handleMcpAction(serverIdx, action);
            }}
            onSelectTool={(toolIdx) => {
              if (mcpPanelView.kind === "tools") {
                setMcpPanelView({ kind: "tool-detail", serverIdx: mcpPanelView.serverIdx, toolIdx });
                const s = mcpServers[mcpPanelView.serverIdx];
                const currentTools = s?.tools as McpTool[] | undefined;
                const needsEnrichment = !currentTools || currentTools.length === 0 || currentTools.some((t) => !t.description && !t.inputSchema);
                if (s && needsEnrichment) {
                  void fetchServerToolDefinitions(s, cwd).then((enrichedTools) => {
                    if (enrichedTools.length > 0) {
                      setMcpServers((prev) => {
                        const updated = [...prev];
                        const target = updated[mcpPanelView.serverIdx];
                        if (target) {
                          updated[mcpPanelView.serverIdx] = { ...target, tools: enrichedTools };
                        }
                        return updated;
                      });
                    }
                  });
                }
              }
            }}
          />
        </box>
      ) : artifactsPanelOpen ? (
        <box style={{ flexShrink: 0 }}>
          <ArtifactsPanel
            artifacts={sessionArtifacts}
            selectedIndex={artifactsSelectedIndex}
            onOpen={openUrl}
            onClose={closeArtifactsPanel}
            onSelect={(idx) => setArtifactsSelectedIndex(idx)}
          />
        </box>
      ) : (
        <>
          <SuggestionBox suggestions={visibleSuggestions} selectedIndex={selectedIndex} onSelect={acceptSuggestion} />
          {/* Matches code.html's #cli-form: rounded border, near-black bg, gold border.
              Dynamically expands up to 10 lines of text (height: visibleLines + 2).
              When text overflows beyond 10 lines, displays `+Nline` on the top border (linesAbove)
              and/or on the bottom border (linesBelow). */}
          <box
            style={{
              border: true,
              borderStyle: "rounded",
              borderColor: GOLD,
              height: visibleLines + 2,
              flexShrink: 0,
              flexDirection: "row",
              paddingX: 1,
            }}
            title={topTitle}
            titleAlignment={topTitleAlignment}
            titleColor={GOLD}
            bottomTitle={bottomTitle}
            bottomTitleAlignment="right"
          >
            {activePrompt ? null : (
              <box style={{ flexDirection: "row", alignSelf: "flex-start" }}>
                <text content="❯ " style={{ fg: "#38bdf8" }} />
              </box>
            )}
            <textarea
              ref={setInputRef}
              placeholder={activePrompt ?? ""}
              keyBindings={CHAT_INPUT_KEY_BINDINGS}
              onContentChange={handleInputChange}
              onCursorChange={updateInputDimensions}
              onSubmit={handleSubmit}
              style={{ flexGrow: 1 }}
              focused
            />
          </box>
        </>
      )}
      <StatusBar sessionStatus={sessionStatus} />
      {copiedVisible ? (
        <box style={{ position: "absolute", top: 0, right: 0, zIndex: 20 }}>
          <text content=" Copied " style={{ fg: BG, bg: GOLD }} />
        </box>
      ) : null}
    </box>
  );
}
