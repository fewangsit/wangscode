import { SyntaxStyle, type ThemeTokenStyle } from "@opentui/core";

// `SyntaxStyle.create()` starts with zero registered styles — code/markdown fences render but
// nothing gets colored, since there's nothing for the tree-sitter highlighter to look styles up
// under. OpenTUI ships no built-in theme, so this maps the standard tree-sitter highlight capture
// names (the same ones nvim-treesitter/Helix/Zed themes use — not OpenTUI-specific) to this app's
// own gold/amber-accented palette, matching the rest of the TUI rather than a generic default.
const THEME: ThemeTokenStyle[] = [
  { scope: ["comment"], style: { foreground: "#565f89", italic: true } },
  { scope: ["string", "string.escape", "character"], style: { foreground: "#9ece6a" } },
  { scope: ["number", "float", "boolean", "constant", "constant.builtin", "constant.numeric"], style: { foreground: "#ff9e64" } },
  {
    scope: ["keyword", "keyword.function", "keyword.operator", "keyword.return", "conditional", "repeat", "include", "namespace"],
    style: { foreground: "#e0af68", bold: true },
  },
  { scope: ["function", "function.method", "function.builtin", "constructor"], style: { foreground: "#e0af68" } },
  { scope: ["type", "type.builtin"], style: { foreground: "#c3a6ff" } },
  { scope: ["variable", "variable.builtin", "variable.parameter", "property"], style: { foreground: "#c0caf5" } },
  { scope: ["operator", "punctuation.bracket", "punctuation.delimiter"], style: { foreground: "#89a1b0" } },
  { scope: ["tag", "attribute", "label"], style: { foreground: "#f7768e" } },
];

export function createAppSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromTheme(THEME);
}
