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
import { detectProjectWangsUiVersion, syncWangsUiMcp } from "../mcp-sync.ts";

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
  //   tau: lowered from default so the ramp-up kicks in earlier on a fast swipe
  //   maxMultiplier: raised so a sustained flick gesture actually scrolls far enough to feel fluid
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel({ tau: 80, maxMultiplier: 8 }), []);
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

  // The canUseTool permission overlay — reset to the first option each time a *different* request
  // comes in (identity check via toolName+label, since `permissionRequest` is a fresh object per
  // call) so a previous answer's selection doesn't carry over to the next, unrelated prompt.
  const [permissionSelectedIndex, setPermissionSelectedIndex] = useState(0);
  const lastPermissionKeyRef = useRef<string | null>(null);
  const permissionKey = permissionRequest ? `${permissionRequest.toolName}:${permissionRequest.label}` : null;
  if (permissionKey !== lastPermissionKeyRef.current) {
    lastPermissionKeyRef.current = permissionKey;
    if (permissionKey !== null && permissionSelectedIndex !== 0) setPermissionSelectedIndex(0);
  }
  const permissionOptions = permissionOptionsFor(permissionRequest?.suggestions !== undefined);

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
    const inserted = `${activeFragment.trigger}${suggestion.insertText} `;
    const next = `${before}${inserted}${after}`;
    inputRef.current.setText(next);
    inputRef.current.cursorOffset = before.length + inserted.length;
    inputRef.current.focus();
    setInputText(next); // ends with a trailing space, so the next fragment detection naturally comes back null
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

  const closeSessionPicker = (): void => {
    setSessionPickerOpen(false);
    inputRef.current?.setText("");
    setInputText("");
  };

  const openSessionPicker = (): void => {
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

  const closeMcpPanel = (): void => {
    mcpActionSeqRef.current++;
    setMcpPanelOpen(false);
    setMcpLoading(false);
    inputRef.current?.setText("");
    setInputText("");
  };

  const openMcpPanel = (): void => {
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
      return;
    }

    const session = getSession();
    if (!session) return;

    if (action.startsWith("Update to @wangs-ui/mcp@") || action.startsWith("Install @wangs-ui/mcp@") || action.startsWith("Sync with project")) {
      const seq = ++mcpActionSeqRef.current;
      setMcpLoading(true);
      try {
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

    if (permissionRequest) {
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
    if (sessionPickerOpen || modelPickerOpen || usagePanelOpen || mcpPanelOpen) return;
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
    if (!activePrompt && text === "/mcp") {
      setInputText("");
      openMcpPanel();
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
    inputRouter.submit(text);
  };

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <scrollbox style={{ flexGrow: 1 }} stickyScroll stickyStart="bottom" focused={false} scrollAcceleration={scrollAcceleration}>
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
              }
            }}
          />
        </box>
      ) : (
        <>
          <SuggestionBox suggestions={visibleSuggestions} selectedIndex={selectedIndex} onSelect={acceptSuggestion} />
          {/* Matches code.html's #cli-form: rounded border, near-black bg, gold border (its
              focus-within state — this is effectively always true, since useEffect above steals
              focus back to this input the moment anything else would take it). */}
          <box
            style={{
              border: true,
              borderStyle: "rounded",
              borderColor: GOLD,
              height: 3,
              flexShrink: 0,
              flexDirection: "row",
              alignItems: "center",
              paddingX: 1,
            }}
            title={activePrompt ?? undefined}
          >
            {activePrompt ? null : (
              <box style={{ flexDirection: "row" }}>
                <text content="❯ " style={{ fg: "#38bdf8" }} />
              </box>
            )}
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
