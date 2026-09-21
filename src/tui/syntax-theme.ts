import { SyntaxStyle, type ThemeTokenStyle } from "@opentui/core";

// `SyntaxStyle.create()` starts with zero registered styles — code/markdown fences render but
// nothing gets colored, since there's nothing for the tree-sitter highlighter to look styles up
// under. OpenTUI ships no built-in theme, so this maps the standard tree-sitter highlight capture
// names (the same ones nvim-treesitter/Helix/Zed themes use — not OpenTUI-specific) to this app's
// own gold/amber-accented palette, matching the rest of the TUI rather than a generic default.
//
// Markdown inline tokens use the "markup.*" namespace — separate from the tree-sitter code scopes
// above but registered in the same SyntaxStyle so a single instance covers both code blocks and
// prose. The exact scope names come from OpenTUI's MarkdownRenderable source (getStyle() calls).
const THEME: ThemeTokenStyle[] = [
  // ── Code / tree-sitter scopes ──────────────────────────────────────────────────────────────────
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

  // ── Markdown prose scopes (markup.*) ──────────────────────────────────────────────────────────
  // Headings — gold + bold so H1/H2/H3 visually pop from body text.
  { scope: ["markup.heading", "heading"], style: { foreground: "#e0af68", bold: true } },
  // Bold — brighter white so **bold** stands out from plain body copy.
  { scope: ["markup.strong", "strong"], style: { foreground: "#ffffff", bold: true } },
  // Italic — soft blue; distinct from bold without competing with gold.
  { scope: ["markup.italic"], style: { foreground: "#7aa2f7", italic: true } },
  // Inline code (`backtick`) — green matches string color; "raw" is OpenTUI's scope name.
  { scope: ["markup.raw", "codespan"], style: { foreground: "#9ece6a" } },
  // Links — sky blue, underline for discoverability.
  { scope: ["markup.link", "markup.link.label"], style: { foreground: "#38bdf8", underline: true } },
  // Link URL portion — dimmer than the label so the text is the focus.
  { scope: ["markup.link.url"], style: { foreground: "#565f89", underline: true } },
  // List markers (• or 1.) — gold so they read as structure, not noise.
  { scope: ["markup.list"], style: { foreground: "#e0af68" } },
  // Blockquote — slate italic; clearly aside/quoted without being invisible.
  { scope: ["markup.quote"], style: { foreground: "#94a3b8", italic: true } },
  // Strikethrough — dim so it reads as deleted/muted content.
  { scope: ["markup.strikethrough"], style: { foreground: "#565f89", dim: true } },
  // Concealed syntax markers (**, __, ` etc.) — dimmed so they don't dominate when conceal=false.
  { scope: ["conceal"], style: { foreground: "#3b4261", dim: true } },
];

export function createAppSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromTheme(THEME);
}
