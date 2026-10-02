// Pure logic for the on/off switch: what the modes are, how `/md-prompt <args>` is read, what the
// command answers with, and which decorations a mode paints. No `$`, no state — the hooks module
// owns the current mode and its persistence; everything decidable without them is here.

import { decorateMarkdown, type Decoration } from "./mdprompt"

/** `on` paints everything, `code` only fenced, indented and inline code, `off` nothing. */
export type Mode = "on" | "code" | "off"

export const DEFAULT_MODE: Mode = "on"

/** Fork: an on/off setting of its own, beside the mode. */
export type OnOff = "on" | "off"

/**
 * Fork's settings: `vba`, whether unfenced VBA procedures (`Sub` … `End Sub`) are painted as VBA;
 * `history`, whether the person's own messages in the transcript are drawn as Markdown.
 */
export type Flag = "vba" | "history"
export type Flags = Record<Flag, OnOff>

/** Kept for the VBA setting's callers. */
export type VbaAuto = OnOff

export const DEFAULT_VBA_AUTO: VbaAuto = "on"
export const DEFAULT_FLAGS: Flags = { vba: "on", history: "on" }

export type ModeCommand =
  | { kind: "set"; mode: Mode }
  | { kind: "status" }
  | { kind: "usage"; input: string }
  | { kind: "flag"; name: Flag; value: OnOff | null }
  | { kind: "debug" }

/**
 * Read the arguments of `/md-prompt`. Nothing (or `status`) asks for the state; `toggle` flips
 * between off and on, so from `code` it turns off. `vba` / `history` `on | off | toggle` set the
 * fork's settings, and either word alone asks for that setting.
 */
export function parseModeCommand(args: string, current: Mode, flags: Flags = DEFAULT_FLAGS): ModeCommand {
  const word = args.trim().toLowerCase()
  const sub = /^(vba|history)(?:\s+(\S+))?$/.exec(word)
  if (sub) {
    const name = sub[1] as Flag
    switch (sub[2]) {
      case undefined:
        return { kind: "flag", name, value: null }
      case "on":
        return { kind: "flag", name, value: "on" }
      case "off":
        return { kind: "flag", name, value: "off" }
      case "toggle":
        return { kind: "flag", name, value: flags[name] === "on" ? "off" : "on" }
      case "debug":
        // session-only: a toast per drawn message says what the history hook decided
        return name === "history" ? { kind: "debug" } : { kind: "usage", input: word }
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
  return readFlag("vba", value)
}

/** A fork setting a value names; anything unrecognised (or absent) is that setting's default. */
export function readFlag(name: Flag, value: unknown): OnOff {
  return value === "on" || value === "off" ? value : DEFAULT_FLAGS[name]
}

export function describeVba(value: VbaAuto): string {
  return value === "on"
    ? "VBA detection on — Sub … End Sub typed without a fence is painted as VBA"
    : "VBA detection off — only fenced ```vba is painted as VBA"
}

export function describeHistory(value: OnOff): string {
  return value === "on"
    ? "history on — your sent messages holding code are drawn as Markdown, code highlighted"
    : "history off — your sent messages are drawn as Claude Code draws them"
}

export function describeFlag(name: Flag, value: OnOff): string {
  return name === "vba" ? describeVba(value) : describeHistory(value)
}

const USAGE = "/md-prompt on | code | off | toggle\n/md-prompt vba on | off | toggle\n/md-prompt history on | off | toggle"

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

export function formatStatus(mode: Mode, flags?: Flags): string {
  if (flags === undefined) return `${describeMode(mode)}\n${USAGE}`
  return `${describeMode(mode)}\n${describeVba(flags.vba)}\n${describeHistory(flags.history)}\n${USAGE}`
}

export function formatUsage(input: string): string {
  return `unknown option "${input}"\n${USAGE}`
}

/** The decorations `mode` paints over `text`; none when off. `vba` turns the fork's VBA detection on. */
export function paintFor(mode: Mode, text: string, vba: VbaAuto = "off"): Decoration[] {
  if (mode === "off") return []
  return decorateMarkdown(text, { codeOnly: mode === "code", autoVba: vba === "on" })
}
