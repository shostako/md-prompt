// Fork: the person's own sent messages, drawn again as Markdown. Pure logic, no `$`.
//
// The prompt box paints the draft (prompt.edit); once sent, the transcript row is Claude Code's
// own drawing, which prints a fenced block as plain text. A `ui.render` hook on `UserMessage` can
// draw the row itself, with the `Markdown` element (the renderer the assistant's replies use:
// fences highlighted, tables, emphasis). This decides *what* that hook draws: the Markdown text,
// or null to leave the row to Claude Code.
//
// Only messages that hold code are taken, so an ordinary message keeps Claude Code's look. With
// VBA detection on, an unfenced procedure (`Sub` … `End Sub`) is wrapped in a ```vba fence for the
// drawing; the stored message, and what the model reads, stay as typed.

import { findVbaRegions } from "./vba-auto"

/** The `Markdown` element takes at most this many characters. */
export const HISTORY_MAX = 10_000

const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/m

/** The Markdown to draw a sent message with, or null to leave it to Claude Code. */
export function historyMarkdown(text: string, autoVba: boolean): string | null {
  if (text === "" || text.length > HISTORY_MAX) return null
  const regions = autoVba ? findVbaRegions(text) : []
  if (regions.length === 0) return FENCE_LINE.test(text) ? text : null
  let out = ""
  let at = 0
  for (const r of regions) {
    out += text.slice(at, r.start) + "```vba\n" + text.slice(r.start, r.end) + "\n```"
    at = r.end
  }
  out += text.slice(at)
  return out.length > HISTORY_MAX ? null : out
}
