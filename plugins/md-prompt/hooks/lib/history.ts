// Fork: the person's own sent messages, drawn again with their code highlighted. Pure logic, no `$`.
//
// The prompt box paints the draft (prompt.edit); once sent, the transcript row is Claude Code's
// own drawing, which prints a fenced block as plain text. A `ui.render` hook on `UserMessage` can
// draw the row itself. This decides *what* that hook draws: the message cut into segments, prose
// for the `Markdown` element and code blocks as coloured runs, or null to leave the row to
// Claude Code.
//
// Code is coloured here, by the same highlighter the prompt box uses, and not by the engine's:
// the engine's highlighter is off for anyone who set `syntaxHighlightingDisabled` (which also
// turns off diff colours), and it has no VBA. So the colours in history match the prompt box.
//
// Only messages that hold code are taken, so an ordinary message keeps Claude Code's look. With
// VBA detection on, an unfenced procedure (`Sub` … `End Sub`) is a code block too. Only the
// drawing changes: the stored message, and what the model reads, stay as typed.

import { highlightCode, languageOf, type Span, type TokenKind } from "./highlight"
import { findVbaRegions } from "./vba-auto"

/** A message longer than this is left to Claude Code (the `Markdown` element's own limit). */
export const HISTORY_MAX = 10_000

/** A piece of a code line: its text and the token kind it is coloured as, or null for plain. */
export type Run = { text: string; kind: TokenKind | null }

export type Segment =
  | { kind: "markdown"; text: string }
  /** `label`: the fence's info string as typed (`vba`), shown dim above the code; null when none. */
  | { kind: "code"; label: string | null; lines: Run[][] }

type CodeRange = { start: number; end: number; info: string | null; body: string }

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** The fenced code blocks of `text`, in order; one that never closes runs to the end. */
function fencedBlocks(text: string): CodeRange[] {
  const out: CodeRange[] = []
  let open: { char: string; len: number; start: number; info: string; bodyStart: number } | null = null
  let p = 0
  while (p <= text.length) {
    const nl = text.indexOf("\n", p)
    const next = nl === -1 ? text.length + 1 : nl + 1
    let end = nl === -1 ? text.length : nl
    if (end > p && text.charCodeAt(end - 1) === 13) end--
    const line = text.slice(p, end)
    if (open) {
      const m = FENCE_CLOSE.exec(line)
      if (m && m[1]![0] === open.char && m[1]!.length >= open.len) {
        const body = text.slice(open.bodyStart, Math.max(open.bodyStart, p - 1))
        out.push({ start: open.start, end, info: open.info || null, body })
        open = null
      }
    } else {
      const f = FENCE_OPEN.exec(line)
      if (f && !(f[1]![0] === "`" && f[2]!.includes("`"))) {
        open = { char: f[1]![0]!, len: f[1]!.length, start: p, info: f[2]!.trim(), bodyStart: next }
      }
    }
    p = next
  }
  if (open) {
    const body = open.bodyStart <= text.length ? text.slice(open.bodyStart) : ""
    out.push({ start: open.start, end: text.length, info: open.info || null, body })
  }
  return out
}

/** `code` cut into lines of runs by `spans`; tabs become four spaces and `\r` is dropped. */
export function toLines(code: string, spans: readonly Span[]): Run[][] {
  const lines: Run[][] = [[]]
  const emit = (a: number, b: number, kind: TokenKind | null) => {
    let s = a
    while (s < b) {
      const nl = code.indexOf("\n", s)
      const e = nl === -1 || nl >= b ? b : nl
      const piece = code.slice(s, e).replace(/\r/g, "").replace(/\t/g, "    ")
      if (piece.length > 0) lines[lines.length - 1]!.push({ text: piece, kind })
      if (e < b) {
        lines.push([])
        s = e + 1
      } else s = e
    }
  }
  let pos = 0
  for (const sp of spans) {
    if (sp.start > pos) emit(pos, sp.start, null)
    emit(Math.max(sp.start, pos), sp.end, sp.kind)
    pos = Math.max(pos, sp.end)
  }
  if (pos < code.length) emit(pos, code.length, null)
  return lines
}

function codeSegment(info: string | null, body: string): Segment {
  const lang = info === null ? null : languageOf(info)
  return { kind: "code", label: info, lines: toLines(body, highlightCode(body, lang)) }
}

/** Prose between code blocks, without the blank lines that only separated it from them. */
function markdownSegment(text: string): Segment | null {
  const t = text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "")
  return t.trim() === "" ? null : { kind: "markdown", text: t }
}

/** How to draw a sent message: its segments, or null to leave it to Claude Code. */
export function historySegments(text: string, autoVba: boolean): Segment[] | null {
  if (text === "" || text.length > HISTORY_MAX) return null
  const ranges: CodeRange[] = fencedBlocks(text)
  if (autoVba) {
    for (const r of findVbaRegions(text)) ranges.push({ start: r.start, end: r.end, info: "vba", body: text.slice(r.start, r.end) })
  }
  if (ranges.length === 0) return null
  ranges.sort((a, b) => a.start - b.start)
  const segments: Segment[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start < at) continue // never overlaps (VBA regions are outside fences), but stay safe
    const prose = markdownSegment(text.slice(at, r.start))
    if (prose) segments.push(prose)
    segments.push(codeSegment(r.info, r.body))
    at = r.end
  }
  const tail = markdownSegment(text.slice(at))
  if (tail) segments.push(tail)
  return segments
}
