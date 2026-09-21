import path from "node:path";

import { PACKAGE_ROOT } from "../package-root.ts";

export const LOGO_PATH = path.join(PACKAGE_ROOT, "assets", "wangs-logo.png");

// Gold/amber accent, not blue — the whole palette used to lean on a blue accent (#7aa2f7);
// everywhere that used it now reads GOLD instead.
export const GOLD = "#e0af68";
export const BG = "#1a1b26";
export const CARD_BORDER = "#1f293d";

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
