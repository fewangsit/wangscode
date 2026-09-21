import { useSyncExternalStore } from "react";

import type { SessionStatusStore } from "./session-status.ts";
import { CARD_BORDER, GOLD, HERO_BORDER, ICON_BORDER, LOGO_PATH, ROSE } from "./theme.ts";

function CommandCard({
  cmd,
  desc,
  accent,
  onClick,
}: {
  cmd: string;
  desc: string;
  accent?: string;
  onClick: (cmd: string) => void;
}): React.ReactNode {
  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: CARD_BORDER,
        flexGrow: 1,
        flexDirection: "column",
        justifyContent: "space-between",
        paddingX: 1,
      }}
      onMouseDown={() => onClick(cmd)}
    >
      <text content={cmd} style={{ fg: accent ?? GOLD }} />
      <text content={desc} style={{ fg: "#94a3b8" }} />
    </box>
  );
}

// Real commands only — code.html's own command-card grid also shows a "/diff" card, which
// doesn't exist here; not included since there's nothing behind it to run. `/exit` keeps
// code.html's rose accent (its one card styled as a destructive action, not the gold the rest use).
const BANNER_COMMANDS: { cmd: string; desc: string; accent?: string }[] = [
  { cmd: "/create-feature", desc: "Deterministic feature-build pipeline" },
  { cmd: "/usage", desc: "Token/cost totals and plan rate limits" },
  { cmd: "/model", desc: "Switch the active model" },
  { cmd: "/resume", desc: "Pick a previous session to resume" },
  { cmd: "/exit", desc: "Quit Wangs Code", accent: ROSE },
];

export function WelcomeBanner({
  sessionStatus,
  version,
  sessionStoreActive,
  onCommandClick,
}: {
  sessionStatus: SessionStatusStore;
  version: string;
  sessionStoreActive: boolean;
  onCommandClick: (cmd: string) => void;
}): React.ReactNode {
  const { model } = useSyncExternalStore(sessionStatus.store.subscribe, sessionStatus.store.get);

  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {/* Adapted from code.html's data-purpose="hero-banner" section — same structure (bordered
          card, boxed icon on the left, title + version badge, tagline, a two-item status line with
          colored bullet dots), with its fictional "PRO-ARCH v2.4" badge and "Memory Daemon: Active
          (L1-KV Cache)" status swapped for this package's real version and real Postgres-mirroring
          state — everything else here is genuine, not decorative.
          borderStyle "rounded" matches code.html's rounded-xl corners as closely as terminal
          box-drawing characters can. No backgroundColor — left transparent so the banner follows
          whatever background the user's own terminal is set to, rather than imposing a fixed dark
          panel color that could clash with it; HERO_BORDER/ICON_BORDER (pre-blended as if gold sat
          at 40%/60% opacity over code.html's dark panel bg) are kept since a border still reads
          fine over any terminal background. code.html's `shadow-glow-gold` blur is dropped outright
          rather than faked — box-shadow blur has no terminal-cell analog worth approximating. */}
      <box
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: HERO_BORDER,
          flexDirection: "column",
          paddingX: 2,
          paddingY: 1,
          marginBottom: 1,
        }}
      >
        <box style={{ flexDirection: "row", alignItems: "center" }}>
          <box
            style={{
              border: true,
              borderStyle: "rounded",
              borderColor: ICON_BORDER,
              flexShrink: 0,
              paddingX: 0,
              paddingY: 0,
            }}
          >
            {/* Forced to "blocks" (the universal colored half-block fallback, not a terminal-specific
                graphics protocol) rather than "auto" — confirmed the logo renders as a clean, correct
                architecture-glyph shape this way; "auto" can pick kitty/sixel depending on the
                terminal, and a real run showed those coming out distorted where "blocks" did not.
                The source PNG is a square 512x512 — height is set to half the width, not equal,
                because each "blocks" character cell stacks 2 vertical pixels (▀/▄) into 1 row but
                only 1 pixel per column, so a terminal cell itself is roughly twice as tall as it is
                wide; height:width 1:2 is what actually renders as a visual square, not 1:1. */}
            <image source={LOGO_PATH} protocol="blocks" fit="cover" style={{ width: 14, height: 6 }} />
          </box>
          <box style={{ flexDirection: "column", marginLeft: 2, flexGrow: 1 }}>
            <box style={{ flexDirection: "row", alignItems: "center" }}>
              <ascii-font text="Wangs Code" font="tiny" color={GOLD} />
              <box style={{ border: true, borderStyle: "rounded", borderColor: GOLD, paddingX: 1, marginLeft: 2 }}>
                <text content={`v${version}`} style={{ fg: "#fcd34d" }} />
              </box>
            </box>
            <text
              content="Autonomous architectural intelligence for Wangs Foundation monorepos. Deterministic code generation, multi-stage pipelines, and system orchestrations."
              style={{ fg: "#94a3b8", marginTop: 1 }}
            />
            <box style={{ flexDirection: "row", marginTop: 1 }}>
              <text content="● " style={{ fg: "#9ece6a" }} />
              <text content="Engine: " style={{ fg: "#565f89" }} />
              <text content={model ?? "connecting..."} style={{ fg: "#c0caf5" }} />
              <text content="   •   " style={{ fg: "#414868" }} />
              <text content="● " style={{ fg: sessionStoreActive ? "#38bdf8" : "#565f89" }} />
              <text content="Session Storage: " style={{ fg: "#565f89" }} />
              <text content={sessionStoreActive ? "Postgres (mirrored)" : "local only"} style={{ fg: "#c0caf5" }} />
            </box>
          </box>
        </box>
      </box>

      <box style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }}>
        <box style={{ flexDirection: "row" }}>
          <text content="╭─ " style={{ fg: GOLD }} />
          <text content="CORE DIRECTIVES & SLASH PIPELINES" style={{ fg: "#94a3b8" }} />
        </box>
        {/* code.html's own hint reads "Press hotkey or click to stage prompt" — hotkey badges
            aren't implemented yet, so this only names the part that's real: clicking a card. */}
        <text content="Click a command to stage it" style={{ fg: "#64748b" }} />
      </box>
      {/* A real wrapping grid (flexWrap, not two hand-sliced rows) — matches code.html's own
          `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`: 3 per row, wrapping to however many
          rows the command count needs, instead of a layout that only works for exactly 5 items. */}
      <box style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {BANNER_COMMANDS.map((c) => (
          <box key={c.cmd} style={{ width: "33%", paddingRight: 1, paddingBottom: 1 }}>
            <CommandCard cmd={c.cmd} desc={c.desc} accent={c.accent} onClick={onCommandClick} />
          </box>
        ))}
      </box>
    </box>
  );
}
