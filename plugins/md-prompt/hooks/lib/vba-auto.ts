// Fork: VBA procedures typed without a fence. Pure logic, no `$`.
//
// Prose that only looks like code must stay prose, so the rule is narrow: a region is a whole
// procedure, from a `Sub` / `Function` / `Property Get|Let|Set` header line to its matching
// `End Sub` / `End Function` / `End Property` line. Nothing is painted until the closing line is
// typed (the way `**bold**` waits for its closing `**`). Lines inside a fenced code block never
// count: a fence already says what its language is.
//
// A region is painted as a code card highlighted as VBA, and every Markdown run of the rest of
// the painter is cut back to the text outside the regions, so `*` in `a * b` is never emphasis.

import { highlightVba } from "./highlight-vba"
import { PALETTE, type Decoration } from "./palette"

/** `[start, end)`: from the first character of the header line to the end of the closing line. */
export type Region = { start: number; end: number }

const HEADER =
  /^[ \t]*(?:(?:public|private|friend)[ \t]+)?(?:static[ \t]+)?(sub|function|property[ \t]+(?:get|let|set))[ \t]+[\p{L}_][\p{L}\p{N}_]*[ \t]*\(/iu
const CLOSER = /^[ \t]*end[ \t]+(sub|function|property)\b/i
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

const CARD = { backgroundColor: PALETTE.codeBg, color: PALETTE.codeFg }

/** The procedures in `text`, in order, never overlapping, none inside a fence. */
export function findVbaRegions(text: string): Region[] {
  const regions: Region[] = []
  let fence: { char: string; len: number } | null = null
  let open: { kind: string; start: number } | null = null
  let p = 0
  while (p <= text.length) {
    const nl = text.indexOf("\n", p)
    const next = nl === -1 ? text.length + 1 : nl + 1
    let end = nl === -1 ? text.length : nl
    if (end > p && text.charCodeAt(end - 1) === 13) end-- // a `\r` before the `\n`
    const line = text.slice(p, end)

    if (fence) {
      const m = FENCE_CLOSE.exec(line)
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) fence = null
    } else {
      const f = FENCE_OPEN.exec(line)
      // a backtick fence's info string cannot hold a backtick: ```code``` on one line is inline code
      if (f && !(f[1]![0] === "`" && f[2]!.includes("`"))) {
        fence = { char: f[1]![0]!, len: f[1]!.length }
        open = null
      } else {
        const h = HEADER.exec(line)
        if (h) open = { kind: h[1]!.toLowerCase().split(/[ \t]/)[0]!, start: p }
        else if (open) {
          const c = CLOSER.exec(line)
          if (c && c[1]!.toLowerCase() === open.kind) {
            regions.push({ start: open.start, end })
            open = null
          }
        }
      }
    }
    p = next
  }
  return regions
}

/** The code card and the VBA tokens of each region. No run is empty or holds a line break. */
export function paintVbaRegions(text: string, regions: readonly Region[]): Decoration[] {
  const out: Decoration[] = []
  const push = (start: number, end: number, style: Omit<Decoration, "start" | "end">) => {
    // split at line breaks: a run must stay on one line
    let a = start
    while (a < end) {
      const nl = text.indexOf("\n", a)
      const b = nl === -1 || nl >= end ? end : nl
      let e = b
      if (e > a && text.charCodeAt(e - 1) === 13) e--
      if (e > a) out.push({ start: a, end: e, ...style })
      a = b + 1
    }
  }
  for (const r of regions) {
    push(r.start, r.end, CARD)
    for (const s of highlightVba(text.slice(r.start, r.end))) {
      push(r.start + s.start, r.start + s.end, { color: PALETTE.token[s.kind] })
    }
  }
  return out
}

/** `runs` with every part that falls inside a region cut away. `regions` must be sorted and disjoint. */
export function clipOutside(runs: readonly Decoration[], regions: readonly Region[]): Decoration[] {
  if (regions.length === 0) return [...runs]
  const out: Decoration[] = []
  for (const d of runs) {
    // first region that ends after the run starts
    let lo = 0
    let hi = regions.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (regions[mid]!.end <= d.start) lo = mid + 1
      else hi = mid
    }
    let from = d.start
    for (let k = lo; k < regions.length && regions[k]!.start < d.end; k++) {
      const r = regions[k]!
      if (r.start > from) out.push({ ...d, start: from, end: r.start })
      from = Math.max(from, r.end)
    }
    if (from < d.end) out.push({ ...d, start: from, end: d.end })
  }
  return out
}
