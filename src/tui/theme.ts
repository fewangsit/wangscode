import path from "node:path";

import { PACKAGE_ROOT } from "../package-root.ts";

export const LOGO_PATH = path.join(PACKAGE_ROOT, "assets", "wangs-logo.png");

// Gold/amber accent, not blue — the whole palette used to lean on a blue accent (#7aa2f7);
// everywhere that used it now reads GOLD instead.
export const GOLD = "#e0af68";
export const BG = "#1a1b26";
export const CARD_BORDER = "#1f293d";
// From code.html's tui.rose — code.html's one command card styled as a destructive action
// (/exit), not the gold the rest use.
export const ROSE = "#fb7185";
// code.html's hero banner border is `border-tui-gold/40`; its icon box border is
// `border-tui-gold/60`. No backgroundColor is set on either box here (left transparent, so the
// banner follows the user's own terminal background) — these two are the border-only, pre-blended
// approximation of that opacity (0.4×gold + 0.6×code.html's own dark panel bg, computed once
// rather than guessed), which still reads correctly against any background.
export const HERO_BORDER = "#665129";
export const ICON_BORDER = "#8d6a2a";
// Pulse trough for the turn-status indicator's animated star/verb (BlockRenderers.tsx) — GOLD
// blended ~55% toward BG, same pre-blended-solid-color approach as HERO_BORDER/ICON_BORDER above
// (OpenTUI has no real alpha/gradient support — confirmed no per-side opacity on Renderable —
// so "dimmer gold" has to be a second precomputed hex, not GOLD at reduced opacity).
export const GOLD_DIM = "#876c4a";

// Full-row diff line highlighting (EditDiffView, BlockRenderers.tsx) — a git/editor-style
// background band behind each +/- line, not just colored text, so a removed/added line reads at a
// glance the way GitHub/VS Code diffs do. Same pre-blended-solid-color approach as GOLD_DIM: the
// real GitHub dark-theme diff tints are translucent (~15% green/red over the panel bg), and
// OpenTUI has no alpha, so these are that same blend computed once against BG rather than a guess.
export const DIFF_ADD_BG = "#1c3324";
export const DIFF_DEL_BG = "#3a2130";

export const ROLE_COLOR: Record<string, string> = {
  user: GOLD,
  host: "#e0af68",
  footer: "#565f89",
};

export const TOOL_STATUS_GLYPH: Record<string, string> = {
  running: "◌",
  done: "✓",
  error: "✗",
};

export const TOOL_STATUS_COLOR: Record<string, string> = {
  running: "#e0af68",
  done: "#9ece6a",
  error: "#f7768e",
};
