// Fork: VBA highlighting (```vba) and unfenced VBA procedure detection.
import { describe, expect, test } from "bun:test"
import { highlightCode } from "../plugins/md-prompt/hooks/lib/highlight"
import { highlightVba } from "../plugins/md-prompt/hooks/lib/highlight-vba"
import { PALETTE, decorateMarkdown } from "../plugins/md-prompt/hooks/lib/mdprompt"
import {
  describeVba,
  formatStatus,
  paintFor,
  parseModeCommand,
  readVbaAuto,
} from "../plugins/md-prompt/hooks/lib/mode"
import { clipOutside, findVbaRegions } from "../plugins/md-prompt/hooks/lib/vba-auto"
import { at, expectValidRuns, paint } from "./helpers"

const T = PALETTE.token
const AUTO = { autoVba: true }

/** The token kind covering the first occurrence of `needle` in `code`, or null when it is plain. */
function kindOf(code: string, needle: string, from = 0): string | null {
  const i = code.indexOf(needle, from)
  if (i === -1) throw new Error(`no ${needle}`)
  const spans = highlightVba(code).filter((s) => s.start <= i && s.end >= i + needle.length)
  return spans.length === 0 ? null : spans[0]!.kind
}

describe("highlightVba", () => {
  test("keywords, case-insensitive", () => {
    const code = "Sub Foo()\n  dim x As Long\n  IF x THEN x = 1\nEnd Sub"
    for (const w of ["Sub", "dim", "As", "IF", "THEN", "End"]) expect(kindOf(code, w)).toBe("keyword")
    expect(kindOf(code, "Long")).toBe("type")
    expect(kindOf(code, "Foo")).toBeNull()
  })

  test("' starts a comment anywhere outside a string", () => {
    const code = `x = 1 ' set it\ny = "it's" ' not a comment inside the string`
    expect(kindOf(code, "' set it")).toBe("comment")
    expect(kindOf(code, `"it's"`)).toBe("string")
    expect(kindOf(code, "' not a comment")).toBe("comment")
  })

  test("Rem is a comment only where a statement starts", () => {
    expect(kindOf("Rem old code", "Rem old code")).toBe("comment")
    expect(kindOf("  rem lower case", "rem lower case")).toBe("comment")
    expect(kindOf("x = 1: Rem after a separator", "Rem after a separator")).toBe("comment")
    expect(kindOf("Remove x", "Remove")).toBeNull()
    expect(kindOf("x = Rem", "Rem")).toBeNull()
  })

  test("strings: a doubled quote stays inside, a backslash is just a character", () => {
    const code = `s = "say ""hi""" & t\np = "C:\\dir\\" & name`
    const spans = highlightVba(code)
    const strings = spans.filter((s) => s.kind === "string").map((s) => code.slice(s.start, s.end))
    expect(strings).toEqual([`"say ""hi"""`, `"C:\\dir\\"`])
  })

  test("an unclosed string runs to the end of its line only", () => {
    const code = `s = "open\nx = 1`
    expect(kindOf(code, `"open`)).toBe("string")
    expect(kindOf(code, "1")).toBe("number")
  })

  test("a word after . or ! is a member, never a keyword", () => {
    const code = "Debug.Print x\nrng.Select\nws .Close"
    expect(kindOf(code, "Print")).toBeNull()
    expect(kindOf(code, "Select")).toBeNull()
    expect(kindOf(code, "Close")).toBeNull()
  })

  test("literals and the built-in enum constants", () => {
    const code = "Set r = Nothing: x = True: y = xlUp: z = vbCrLf: Me.Hide: v = vba"
    for (const w of ["Nothing", "True", "xlUp", "vbCrLf", "Me"]) expect(kindOf(code, w)).toBe("literal")
    expect(kindOf(code, "vba")).toBeNull()
  })

  test("numbers: decimal, hex, octal, suffixes", () => {
    const code = "a = 42: b = 3.5E+2: c = &HFF&: d = &O17: e = .5"
    for (const w of ["42", "3.5E+2", "&HFF&", "&O17", ".5"]) expect(kindOf(code, w)).toBe("number")
    expect(kindOf("x = a & b", "&")).toBeNull()
  })

  test("# is a date, a directive, or a file number", () => {
    expect(kindOf("d = #2024/1/31#", "#2024/1/31#")).toBe("number")
    expect(kindOf("d = #1/31/2024 10:00:00 AM#", "#1/31/2024 10:00:00 AM#")).toBe("number")
    expect(kindOf("#If VBA7 Then", "#If")).toBe("meta")
    expect(kindOf("Print #1, x", "#1")).toBeNull()
    expect(kindOf("Open f For Input As #1", "#1")).toBeNull()
  })

  test("a label at the start of a line", () => {
    const code = "ErrHandler:\n  MsgBox Err.Description"
    expect(kindOf(code, "ErrHandler:")).toBe("meta")
  })

  test("Japanese identifiers stay whole and plain", () => {
    const code = "Dim 合計 As Long\n合計 = 合計 + 1"
    expect(kindOf(code, "合計")).toBeNull()
    expect(kindOf(code, "Dim")).toBe("keyword")
  })

  test("spans are ordered, non-empty, non-overlapping and inside the text", () => {
    const code = `Sub A()\n  ' c\n  s = "x""y" & #1/1/2020# & &H1F\nErr1:\nEnd Sub\n#If X Then\nRem r`
    let last = 0
    for (const s of highlightVba(code)) {
      expect(s.start).toBeGreaterThanOrEqual(last)
      expect(s.end).toBeGreaterThan(s.start)
      expect(s.end).toBeLessThanOrEqual(code.length)
      last = s.end
    }
  })

  test("the language names that reach it", () => {
    for (const name of ["vba", "vb", "vbs", "vbscript", "bas", "cls", "vb.net", "visual-basic"]) {
      expect(highlightCode("Dim x", name)).toEqual(highlightVba("Dim x"))
    }
  })
})

describe("```vba fences", () => {
  test("keywords and comments are coloured inside the card", () => {
    const text = "```vba\nSub Foo()\n  ' hi\nEnd Sub\n```"
    expect(at(text, "Sub", 7).color).toBe(T.keyword)
    expect(at(text, "' hi").color).toBe(T.comment)
    expect(at(text, "Foo").backgroundColor).toBe(PALETTE.codeBg)
  })
})

describe("findVbaRegions", () => {
  test("a closed procedure is one region from its header line to its End line", () => {
    const text = "見て\nSub Foo()\n  x = 1\nEnd Sub\nどう？"
    const [r] = findVbaRegions(text)
    expect(text.slice(r!.start, r!.end)).toBe("Sub Foo()\n  x = 1\nEnd Sub")
  })

  test("nothing until the End line is typed", () => {
    expect(findVbaRegions("Sub Foo()\n  x = 1\n")).toEqual([])
    expect(findVbaRegions("Sub Foo()\n  x = 1\nEnd ")).toEqual([])
  })

  test("Function, Property and scope prefixes; the closer must match", () => {
    const text = [
      "Public Function F(a As Long) As Long",
      "  F = a",
      "End Sub", // wrong closer: ignored
      "End Function",
      "Private Static Sub S()",
      "End Sub",
      "Property Get P() As Long",
      "End Property",
    ].join("\n")
    expect(findVbaRegions(text).map((r) => text.slice(r.start, r.end).split("\n")[0])).toEqual([
      "Public Function F(a As Long) As Long",
      "Private Static Sub S()",
      "Property Get P() As Long",
    ])
  })

  test("a header without parentheses, or prose that says Sub, is not a procedure", () => {
    expect(findVbaRegions("Sub というのはプロシージャで\nEnd Sub で終わる")).toEqual([])
    expect(findVbaRegions("Declare PtrSafe Function F Lib \"x\" ()\nEnd Function")).toEqual([])
  })

  test("lines inside a fence never count", () => {
    const text = "```\nSub Foo()\nEnd Sub\n```"
    expect(findVbaRegions(text)).toEqual([])
    const after = "```\nx\n```\nSub Bar()\nEnd Sub"
    expect(findVbaRegions(after)).toHaveLength(1)
  })

  test("a header inside an unclosed fence is not picked up after it", () => {
    expect(findVbaRegions("```vba\nSub Foo()\nEnd Sub")).toEqual([])
  })

  test("CRLF line ends stay out of the region", () => {
    const text = "Sub Foo()\r\nEnd Sub\r\nnext"
    const [r] = findVbaRegions(text)
    expect(text.slice(r!.start, r!.end)).toBe("Sub Foo()\r\nEnd Sub")
  })
})

describe("clipOutside", () => {
  test("cuts runs back to the text outside the regions", () => {
    const runs = [{ start: 0, end: 20, bold: true }]
    const regions = [
      { start: 5, end: 8 },
      { start: 12, end: 15 },
    ]
    expect(clipOutside(runs, regions)).toEqual([
      { start: 0, end: 5, bold: true },
      { start: 8, end: 12, bold: true },
      { start: 15, end: 20, bold: true },
    ])
  })

  test("a run wholly inside a region disappears", () => {
    expect(clipOutside([{ start: 6, end: 7, italic: true }], [{ start: 5, end: 8 }])).toEqual([])
  })
})

describe("unfenced VBA in the draft", () => {
  const text = "**これ**直して\nSub Calc()\n  y = a * b * c\n  ' 掛け算\nEnd Sub\nお願い"

  test("is painted as a VBA card when detection is on", () => {
    expect(at(text, "Calc", 0, AUTO).backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "' 掛け算", 0, AUTO).color).toBe(T.comment)
    expect(at(text, "End", 0, AUTO).color).toBe(T.keyword)
  })

  test("* inside it is never emphasis, Markdown outside it still is", () => {
    const styles = paint(text, AUTO)
    const i = text.indexOf("b * c")
    expect(styles[i]!.italic).toBeUndefined()
    expect(at(text, "これ", 0, AUTO).bold).toBe(true)
    expect(at(text, "お願い", 0, AUTO).backgroundColor).toBeUndefined()
  })

  test("is left to Markdown when detection is off", () => {
    expect(at(text, "Calc").backgroundColor).toBeUndefined()
  })

  test("code mode still paints it", () => {
    expect(at(text, "Calc", 0, { codeOnly: true, autoVba: true }).backgroundColor).toBe(PALETTE.codeBg)
  })

  test("every run stays valid", () => {
    for (const t of [text, "Sub A()\r\nEnd Sub", "x\nSub A()\n\n\nEnd Sub\n", "Sub A()\nEnd Sub\nSub B()\nEnd Sub"]) {
      expectValidRuns(t, AUTO)
      expectValidRuns(t, { codeOnly: true, autoVba: true })
    }
  })

  test("random drafts keep every run valid and never throw", () => {
    const pieces = ["Sub X()", "End Sub", "Function F()", "End Function", "```", "```vba", "**", "*", '"', "'", "#", "&H", "\n", "\r\n", " ", "x = 1", "Rem", ":", "合計", "\t"]
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let k = 0; k < 400; k++) {
      let t = ""
      const len = 1 + Math.floor(rnd() * 40)
      for (let j = 0; j < len; j++) t += pieces[Math.floor(rnd() * pieces.length)]
      expectValidRuns(t, AUTO)
    }
  })

  test("stays fast on a long draft of many procedures", () => {
    const one = "Sub A()\n  x = a * b ' c\nEnd Sub\n"
    const big = one.repeat(Math.floor(59_000 / one.length))
    const t0 = performance.now()
    decorateMarkdown(big, AUTO)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe("the vba setting", () => {
  test("/md-prompt vba [on|off|toggle]", () => {
    expect(parseModeCommand("vba", "on", "on")).toEqual({ kind: "vba", value: null })
    expect(parseModeCommand("vba off", "on", "on")).toEqual({ kind: "vba", value: "off" })
    expect(parseModeCommand("VBA On", "on", "off")).toEqual({ kind: "vba", value: "on" })
    expect(parseModeCommand("vba toggle", "on", "on")).toEqual({ kind: "vba", value: "off" })
    expect(parseModeCommand("vba toggle", "on", "off")).toEqual({ kind: "vba", value: "on" })
    expect(parseModeCommand("vba maybe", "on", "on")).toEqual({ kind: "usage", input: "vba maybe" })
  })

  test("the upstream commands are unchanged", () => {
    expect(parseModeCommand("code", "on")).toEqual({ kind: "set", mode: "code" })
    expect(parseModeCommand("", "on")).toEqual({ kind: "status" })
  })

  test("readVbaAuto defaults to on", () => {
    expect(readVbaAuto(undefined)).toBe("on")
    expect(readVbaAuto("sideways")).toBe("on")
    expect(readVbaAuto("off")).toBe("off")
  })

  test("the status names both settings", () => {
    const s = formatStatus("on", "off")
    expect(s).toContain(describeVba("off"))
    expect(s).toContain("/md-prompt vba on | off | toggle")
  })

  test("paintFor passes the setting through", () => {
    const t = "Sub A()\nEnd Sub"
    expect(paintFor("on", t, "on")).toEqual(decorateMarkdown(t, AUTO))
    expect(paintFor("on", t, "off")).toEqual(decorateMarkdown(t))
    expect(paintFor("off", t, "on")).toEqual([])
  })
})
