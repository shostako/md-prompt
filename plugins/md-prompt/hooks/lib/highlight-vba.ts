// VBA / VB / VBScript highlighter for the body of a code block: source text in, token spans out.
// Same contract as the rest of highlight*.ts: spans come back ordered, non-empty, non-overlapping
// and inside the text, in linear time, and nothing throws.
//
// VBA does not fit a row of the generic `LANGS` table, for four reasons:
//   - strings have no backslash escapes (`"C:\dir\"` closes at the last quote), and `""` inside a
//     string is a literal quote
//   - `'` starts a comment anywhere outside a string, and `Rem` does too, but only where a statement
//     starts (start of a line or after a `:` separator)
//   - keywords are case-insensitive, and a word after `.` is a member (`Debug.Print`, `rng.Select`),
//     never a keyword
//   - `#` is a date literal (`#2024/1/31#`), a compiler directive (`#If`) or a file number (`#1`)

import type { Span } from "./highlight"
import { set } from "./highlight-util"

const KEYWORDS = set(
  `sub function property get let set end exit if then else elseif for each in next to step do loop
   while wend until select case with dim redim preserve const private public static global friend
   as byval byref optional paramarray call goto gosub return on error resume option explicit new
   is like not and or xor eqv imp mod type enum implements event raiseevent withevents declare lib
   alias ptrsafe stop open close print write kill erase lset rset attribute addressof typeof`,
)

const TYPES = set(
  "integer long longlong longptr single double currency decimal date string boolean byte variant object any",
)

const LITERALS = set("true false nothing null empty me")

/** `vbCrLf`, `xlUp`, `msoTrue`: the built-in enum constants of VBA, Excel and Office. */
const CONSTANT = /^(?:vb|xl|mso)[A-Z]/

const DIRECTIVE = /^#(?:if|elseif|else|end\s+if|const)\b/i

/** A date literal: `#1/31/2024#`, `#2024-01-31 10:00:00 AM#`. A file number (`#1,`) never closes like this. */
const DATE = /#[0-9][0-9/\-:. ]*(?:[AaPp][Mm])?\s*#/y

const NUMBER = /&[Hh][0-9A-Fa-f]+[&%^]?|&[Oo][0-7]+[&%^]?|(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?[%&!#@^]?/y

const isIdentStart = (c: string) => /[\p{L}_]/u.test(c)
const isIdentPart = (c: string) => /[\p{L}\p{N}_]/u.test(c)
const isBlank = (c: string) => c === " " || c === "\t"

export function highlightVba(code: string): Span[] {
  const spans: Span[] = []
  const n = code.length
  let i = 0
  let stmtStart = true // nothing but blanks since the start of the line or a `:` separator
  let lineStart = true // nothing but blanks since the start of the line

  const lineEnd = (from: number) => {
    const nl = code.indexOf("\n", from)
    return nl === -1 ? n : nl
  }

  while (i < n) {
    const c = code[i]!

    if (c === "\n") {
      stmtStart = true
      lineStart = true
      i++
      continue
    }
    if (isBlank(c) || c === "\r") {
      i++
      continue
    }

    // comments: `'` anywhere, `Rem` where a statement starts
    if (c === "'") {
      const end = lineEnd(i)
      spans.push({ start: i, end, kind: "comment" })
      i = end
      continue
    }
    if (stmtStart && (c === "R" || c === "r") && code.slice(i, i + 3).toLowerCase() === "rem") {
      const after = code[i + 3]
      if (after === undefined || after === "\n" || after === "\r" || isBlank(after)) {
        const end = lineEnd(i)
        spans.push({ start: i, end, kind: "comment" })
        i = end
        continue
      }
    }

    // strings: no escapes but a doubled quote; a string that never closes runs to the end of its line
    if (c === '"') {
      let j = i + 1
      let end = -1
      while (j < n && code[j] !== "\n") {
        if (code[j] === '"') {
          if (code[j + 1] === '"') {
            j += 2
            continue
          }
          end = j + 1
          break
        }
        j++
      }
      if (end === -1) end = j
      if (end > i) spans.push({ start: i, end, kind: "string" })
      i = end
      stmtStart = false
      lineStart = false
      continue
    }

    if (c === "#") {
      if (lineStart) {
        const m = DIRECTIVE.exec(code.slice(i, Math.min(n, i + 12)))
        if (m) {
          spans.push({ start: i, end: i + m[0].length, kind: "meta" })
          i += m[0].length
          stmtStart = false
          lineStart = false
          continue
        }
      }
      DATE.lastIndex = i
      const d = DATE.exec(code)
      if (d && !d[0].includes("\n")) {
        spans.push({ start: i, end: i + d[0].length, kind: "number" })
        i += d[0].length
        stmtStart = false
        lineStart = false
        continue
      }
      i++
      stmtStart = false
      lineStart = false
      continue
    }

    // numbers: decimal, `&H` hex, `&O` octal, with an optional type suffix
    if (
      ((c >= "0" && c <= "9") || c === "&" || (c === "." && /[0-9]/.test(code[i + 1] ?? ""))) &&
      (i === 0 || !isIdentPart(code[i - 1]!))
    ) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(code)
      if (m && m[0].length > 0 && (c !== "&" || m[0].length > 2)) {
        spans.push({ start: i, end: i + m[0].length, kind: "number" })
        i += m[0].length
        stmtStart = false
        lineStart = false
        continue
      }
    }

    // words
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < n && isIdentPart(code[j]!)) j++
      const word = code.slice(i, j)
      const key = word.toLowerCase()
      let k = i - 1
      while (k >= 0 && isBlank(code[k]!)) k--
      const member = k >= 0 && (code[k] === "." || code[k] === "!")
      // a label at the start of a line: `ErrHandler:`
      const label = lineStart && code[j] === ":" && code[j + 1] !== "=" && !KEYWORDS.has(key)
      if (label) spans.push({ start: i, end: j + 1, kind: "meta" })
      else if (!member) {
        if (KEYWORDS.has(key)) spans.push({ start: i, end: j, kind: "keyword" })
        else if (TYPES.has(key)) spans.push({ start: i, end: j, kind: "type" })
        else if (LITERALS.has(key)) spans.push({ start: i, end: j, kind: "literal" })
        else if (CONSTANT.test(word)) spans.push({ start: i, end: j, kind: "literal" })
      }
      i = label ? j + 1 : j
      // a type suffix (`Left$`, `count%`) belongs to the word, so `#` here is not a date
      if (!label && i < n && "$%#@".includes(code[i]!)) i++
      stmtStart = label // after a label a statement may follow on the same line
      lineStart = false
      continue
    }

    if (c === ":") {
      stmtStart = true
      lineStart = false
      i++
      continue
    }

    stmtStart = false
    lineStart = false
    i++
  }
  return spans
}
