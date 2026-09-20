export type MentionTrigger = "@" | "/";

export interface ActiveFragment {
  trigger: MentionTrigger;
  /** Text typed after the trigger char, up to `cursor`. */
  fragment: string;
  /** Index of the trigger char itself within the source text. */
  start: number;
}

/**
 * Finds the contiguous non-whitespace run ending at `cursor` and, if it begins with `@` or `/`,
 * returns what's been typed after it — this is what decides whether a suggestion overlay should
 * show at all, independent of what fills it (file listing vs. command listing).
 *
 * Defaults `cursor` to the end of `text`: `InputRenderable`'s `onInput` event only reports the
 * plain value (see the core source: `this.emit("input", this.plainText)`), not a cursor index —
 * a reasonable v1 simplification for a single-line input where typing happens at the end far more
 * often than arrowing back mid-edit.
 */
export function detectActiveFragment(text: string, cursor: number = text.length): ActiveFragment | null {
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start--;
  if (start === cursor) return null;

  const leading = text[start];
  if (leading !== "@" && leading !== "/") return null;

  return { trigger: leading, fragment: text.slice(start + 1, cursor), start };
}
