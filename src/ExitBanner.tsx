import { GOLD } from "./tui/theme.ts";

const ANSI_GOLD = `\x1b[38;2;${Number.parseInt(GOLD.slice(1, 3), 16)};${Number.parseInt(GOLD.slice(3, 5), 16)};${Number.parseInt(GOLD.slice(5, 7), 16)}m`;
const ANSI_DIM = "\x1b[38;2;86;95;137m";
const ANSI_RESET = "\x1b[0m";

function gold(text: string): string {
  return `${ANSI_GOLD}${text}${ANSI_RESET}`;
}

function dim(text: string): string {
  return `${ANSI_DIM}${text}${ANSI_RESET}`;
}

const RULE_WIDTH = 78;

/**
 * Printed on the normal terminal after the TUI's own renderer is destroyed (so it's the last
 * thing visible, not something the alt-screen clears away on exit) — `--resume` is a real CLI
 * flag (see cli.ts), so the line shown here is copy-pasteable and actually works.
 */
export function printExitBanner(sessionId: string, packageName: string): void {
  const resumeCmd = `${packageName} --resume ${sessionId}`;

  const lines = [
    "",
    dim("─".repeat(RULE_WIDTH)),
    `  ${gold("Wangs Code")}${dim(" — session ended")}`,
    "",
    `  ${dim("Resume this session with one command:")}`,
    `    ${gold(resumeCmd)}`,
    "",
    `  ${dim(`Session ID: ${sessionId}`)}`,
    dim("─".repeat(RULE_WIDTH)),
    "",
  ];

  console.log(lines.join("\n"));
}
