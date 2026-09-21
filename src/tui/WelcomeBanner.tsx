import { useSyncExternalStore } from "react";

import type { SessionStatusStore } from "./session-status.ts";
import { CARD_BORDER, GOLD, LOGO_PATH } from "./theme.ts";

function CommandCard({ cmd, desc, onClick }: { cmd: string; desc: string; onClick: (cmd: string) => void }): React.ReactNode {
  return (
    <box
      style={{ border: true, borderStyle: "rounded", borderColor: CARD_BORDER, flexGrow: 1, flexDirection: "column", paddingX: 1 }}
      onMouseDown={() => onClick(cmd)}
    >
      <text content={cmd} style={{ fg: GOLD }} />
      <text content={desc} style={{ fg: "#565f89" }} />
    </box>
  );
}

// Real commands only — the design reference this banner is adapted from also showed a "/diff"
// card, which doesn't exist here; not included since there's nothing behind it to run.
const BANNER_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "/create-feature", desc: "Deterministic feature-build pipeline" },
  { cmd: "/usage", desc: "Token/cost totals and plan rate limits" },
  { cmd: "/model", desc: "Switch the active model" },
  { cmd: "/resume", desc: "Pick a previous session to resume" },
  { cmd: "/exit", desc: "Quit Wangs Code" },
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
  const firstRow = BANNER_COMMANDS.slice(0, 3);
  const secondRow = BANNER_COMMANDS.slice(3);

  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {/* Adapted from a design reference's data-purpose="hero-banner" section — same structure
          (bordered card, boxed icon on the left, title + version badge, tagline, a two-item status
          line with colored bullet dots), with the reference's fictional "PRO-ARCH v2.4" badge and
          "Memory Daemon: Active (L1-KV Cache)" status swapped for this package's real version and
          real Postgres-mirroring state — everything else here is genuine, not decorative.
          borderStyle "rounded" throughout this banner matches the reference's rounded-xl/rounded-lg
          corners as closely as terminal box-drawing characters can. */}
      <box style={{ border: true, borderStyle: "rounded", borderColor: GOLD, flexDirection: "column", paddingX: 2, paddingY: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: "row", alignItems: "center" }}>
          <box style={{ border: true, borderStyle: "rounded", borderColor: GOLD, flexShrink: 0, paddingX: 0, paddingY: 0 }}>
            {/* Forced to "blocks" (the universal colored half-block fallback, not a terminal-specific
                graphics protocol) rather than "auto" — confirmed the logo renders as a clean, correct
                architecture-glyph shape this way; "auto" can pick kitty/sixel depending on the
                terminal, and a real run showed those coming out distorted where "blocks" did not.
                The source PNG is a square 512x512 — height is set to half the width, not equal,
                because each "blocks" character cell stacks 2 vertical pixels (▀/▄) into 1 row but
                only 1 pixel per column, so a terminal cell itself is roughly twice as tall as it is
                wide; height:width 1:2 is what actually renders as a visual square, not 1:1. */}
            <image source={LOGO_PATH} protocol="blocks" fit="fit" style={{ width: 16, height: 8 }} />
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

      <box style={{ flexDirection: "row", marginBottom: 1 }}>
        <text content="╭─ " style={{ fg: GOLD }} />
        <text content="CORE DIRECTIVES & SLASH PIPELINES" style={{ fg: "#94a3b8" }} />
      </box>
      <box style={{ flexDirection: "row", marginBottom: 1 }}>
        {firstRow.map((c) => (
          <CommandCard key={c.cmd} cmd={c.cmd} desc={c.desc} onClick={onCommandClick} />
        ))}
      </box>
      <box style={{ flexDirection: "row" }}>
        {secondRow.map((c) => (
          <CommandCard key={c.cmd} cmd={c.cmd} desc={c.desc} onClick={onCommandClick} />
        ))}
        <box style={{ flexGrow: 1 }} />
      </box>
    </box>
  );
}
