// Pure logic for the on/off switch: what the modes are, how `/md-prompt <args>` is read, what the
// command answers with, and which decorations a mode paints. No `$`, no state — the hooks module
// owns the current mode and its persistence; everything decidable without them is here.

import { decorateMarkdown, type Decoration } from "./mdprompt"

/** `on` paints everything, `code` only fenced, indented and inline code, `off` nothing. */
export type Mode = "on" | "code" | "off"

export const DEFAULT_MODE: Mode = "on"

/** Fork: whether unfenced VBA procedures (`Sub` … `End Sub`) are painted as VBA. */
export type VbaAuto = "on" | "off"

export const DEFAULT_VBA_AUTO: VbaAuto = "on"

export type ModeCommand =
  | { kind: "set"; mode: Mode }
  | { kind: "status" }
  | { kind: "usage"; input: string }
  | { kind: "vba"; value: VbaAuto | null }

/**
 * Read the arguments of `/md-prompt`. Nothing (or `status`) asks for the state; `toggle` flips
 * between off and on, so from `code` it turns off. `vba on | off | toggle` sets the fork's VBA
 * detection, and `vba` alone asks for it.
 */
export function parseModeCommand(args: string, current: Mode, currentVba: VbaAuto = DEFAULT_VBA_AUTO): ModeCommand {
  const word = args.trim().toLowerCase()
  const vba = /^vba(?:\s+(\S+))?$/.exec(word)
  if (vba) {
    switch (vba[1]) {
      case undefined:
        return { kind: "vba", value: null }
      case "on":
        return { kind: "vba", value: "on" }
      case "off":
        return { kind: "vba", value: "off" }
      case "toggle":
        return { kind: "vba", value: currentVba === "on" ? "off" : "on" }
      default:
        return { kind: "usage", input: word }
    }
  }
  switch (word) {
    case "":
    case "status":
      return { kind: "status" }
    case "on":
    case "all":
      return { kind: "set", mode: "on" }
    case "code":
      return { kind: "set", mode: "code" }
    case "off":
      return { kind: "set", mode: "off" }
    case "toggle":
      return { kind: "set", mode: current === "off" ? "on" : "off" }
    default:
      return { kind: "usage", input: word }
  }
}

/** The mode a setting value names; anything unrecognised (or absent) is the default. */
export function readMode(value: unknown): Mode {
  return value === "on" || value === "code" || value === "off" ? value : DEFAULT_MODE
}

/** The VBA setting a value names; anything unrecognised (or absent) is the default. */
export function readVbaAuto(value: unknown): VbaAuto {
  return value === "on" || value === "off" ? value : DEFAULT_VBA_AUTO
}

export function describeVba(value: VbaAuto): string {
  return value === "on"
    ? "VBA detection on — Sub … End Sub typed without a fence is painted as VBA"
    : "VBA detection off — only fenced ```vba is painted as VBA"
}

const USAGE = "/md-prompt on | code | off | toggle\n/md-prompt vba on | off | toggle"

export function describeMode(mode: Mode): string {
  switch (mode) {
    case "on":
      return "on — code, emphasis, links, headings, lists, tables and quotes are painted"
    case "code":
      return "code only — fenced, indented and inline code are painted"
    case "off":
      return "off — the prompt box is left as plain text"
  }
}

export function formatStatus(mode: Mode, vba?: VbaAuto): string {
  return vba === undefined ? `${describeMode(mode)}\n${USAGE}` : `${describeMode(mode)}\n${describeVba(vba)}\n${USAGE}`
}

export function formatUsage(input: string): string {
  return `unknown option "${input}"\n${USAGE}`
}

/** The decorations `mode` paints over `text`; none when off. `vba` turns the fork's VBA detection on. */
export function paintFor(mode: Mode, text: string, vba: VbaAuto = "off"): Decoration[] {
  if (mode === "off") return []
  return decorateMarkdown(text, { codeOnly: mode === "code", autoVba: vba === "on" })
}
