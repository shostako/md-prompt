// Hooks module. Wires the prompt box to the pure logic in ./lib — everything that decides *what*
// to paint lives there (lib/mdprompt.ts, lib/highlight.ts) and everything that decides *whether*
// (lib/mode.ts); this file only says *when*, and owns the two `$` uses: the `/md-prompt` command
// and writing the mode setting.
//
// The prompt box cannot be redrawn by a hook, but the engine lets one paint style runs over the
// draft (`decorations`, offsets into the text). Two events carry them:
//   prompt.edit — every edit or paste the person makes; we decorate the box the edit produced.
//   prompt.fill — a plugin (or the engine) writing the draft; only `replace` is the whole draft,
//                 so only then are offsets into `e.text` offsets into the box.
// The draft's characters, the cursor and other plugins' decorations pass through as they came.
//
// The mode is the plugin's `mode` setting (userConfig), a row in /config. `/md-prompt <mode>`
// writes that row, as a change in /config would; the engine then reloads this module with the
// new value, which `register` reads from `options`. Where there is no /config row for plugin
// fields the write is refused: the mode then holds for the rest of this activation only.

import type { Register } from "claude-code"
import { historySegments, type Segment } from "./lib/history"
import { PALETTE } from "./lib/palette"
import {
  describeFlag,
  describeMode,
  formatStatus,
  formatUsage,
  paintFor,
  parseModeCommand,
  readFlag,
  readMode,
  type Flag,
  type Flags,
  type Mode,
  type OnOff,
} from "./lib/mode"

// `<plugin>.<field>` of the userConfig fields in plugin.json.
const MODE_SETTING = "md-prompt.mode"
const FLAG_SETTING: Record<Flag, string> = { vba: "md-prompt.vba", history: "md-prompt.history" } // fork

// The slice of `$` used here. The loader only lets `$` reach functions declared at the top of
// the file, so every `$` call sits in one of the helpers below rather than in a closure.
type Dollar = {
  config: { set: (args: { key: string; value: string }) => Promise<{ deny?: string }> }
  ui: { log: (text: string) => void }
}

/** Resolves to null when the setting was written, else why not. A refusal must never escape the hook. */
async function writeSetting($: Dollar, key: string, value: string): Promise<string | null> {
  try {
    const result = await $.config.set({ key, value })
    return result.deny ?? null
  } catch (err) {
    return String(err)
  }
}

// A hook that throws is skipped with a notice on every keystroke; painting is decoration, so a
// bug in it must cost the colours, never the notice.
function paint(value: Mode, text: string, vba: OnOff) {
  try {
    return paintFor(value, text, vba)
  } catch {
    return []
  }
}

/** Fork: the segments a sent message is drawn with, or null for Claude Code's own drawing. Never throws. */
function historyOf(text: string, vba: OnOff): Segment[] | null {
  try {
    return historySegments(text, vba === "on")
  } catch {
    return null
  }
}

/** Fork: the rows that are the person's own prompt, typed here or sent from another device. */
const OWN_PROMPT = new Set(["composer", "bridge"])

export const register: Register = (on, options) => {
  let mode: Mode = readMode(options.mode)
  const flags: Flags = { vba: readFlag("vba", options.vba), history: readFlag("history", options.history) }
  let diagnose = false // `/md-prompt history debug`: a toast per drawn message, this session only
  const diagnosed = new Set<string>()

  on("session.start", async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({
        name: "md-prompt",
        description: "Turn Markdown painting in the prompt box on, off, or code-only",
        argumentHint: "[on | code | off | toggle | vba … | history …]",
        immediate: true,
      })
      .catch((err: unknown) => $.ui.log(`md-prompt: command.register failed: ${err}`))
    return r
  })

  on("command.run", { command: "md-prompt" }, async ($, e) => {
    const cmd = parseModeCommand(e.args, mode, flags)
    if (cmd.kind === "status") return { text: formatStatus(mode, flags) }
    if (cmd.kind === "usage") return { text: formatUsage(cmd.input) }
    if (cmd.kind === "debug") {
      diagnose = !diagnose
      diagnosed.clear()
      return { text: `history debug ${diagnose ? "on: each message drawn from now on shows a toast" : "off"}` }
    }
    if (cmd.kind === "flag") {
      if (cmd.value === null) return { text: describeFlag(cmd.name, flags[cmd.name]) }
      flags[cmd.name] = cmd.value
      const said = describeFlag(cmd.name, cmd.value)
      const failure = await writeSetting($, FLAG_SETTING[cmd.name], cmd.value)
      return { text: failure ? `${said} (not saved for next time: ${failure})` : said }
    }
    // Applies at once; a written setting reloads the module, which starts in the same mode.
    mode = cmd.mode
    const failure = await writeSetting($, MODE_SETTING, mode)
    return { text: failure ? `${describeMode(mode)} (not saved for next time: ${failure})` : describeMode(mode) }
  })

  on("prompt.edit", async ($, e, next) => {
    const box = await next(e)
    if (mode === "off") return box
    return { ...box, decorations: [...(box.decorations ?? []), ...paint(mode, box.text, flags.vba)] }
  })

  on("prompt.fill", ($, e, next) => {
    if (mode === "off" || e.mode !== "replace") return next(e)
    return next({ ...e, decorations: [...(e.decorations ?? []), ...paint(mode, e.text, flags.vba)] })
  })

  // Fork: a sent message that holds code is drawn again as Markdown, its code highlighted the way
  // the assistant's replies are. Only the drawing changes; the stored message stays as typed.
  // `isExpanded` is not read for the person's own prompt: the normal view draws it in full
  // whatever that flag says (it is true only under ctrl+o / --verbose).
  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    const own = OWN_PROMPT.has(e.props.origin.kind)
    const segments = flags.history === "on" && own ? historyOf(e.props.text, flags.vba) : null
    if (diagnose && !diagnosed.has(e.requestId)) {
      diagnosed.add(e.requestId)
      const why = flags.history === "off" ? "history off" : !own ? "not your prompt" : segments === null ? "no code" : "drawn"
      $.ui.toast(
        `md-prompt: origin=${e.props.origin.kind} expanded=${e.props.isExpanded} chars=${e.props.text.length} → ${why}`,
        { timeoutMs: 10_000 },
      )
    }
    if (segments === null) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    // Code is coloured by our own highlighter (see lib/history.ts), prose by the Markdown element.
    const body = segments.map((s) =>
      s.kind === "markdown" ? (
        <Markdown text={s.text} />
      ) : (
        <Box flexDirection="column" backgroundColor={PALETTE.codeBg} paddingX={1}>
          {[
            ...(s.label === null ? [] : [<Text color={PALETTE.fence}>{s.label}</Text>]),
            ...s.lines.map((line) => (
              <Text color={PALETTE.codeFg}>
                {line.length === 0
                  ? [" "]
                  : line.map((r) => (r.kind === null ? r.text : <Text color={PALETTE.token[r.kind]}>{r.text}</Text>))}
              </Text>
            )),
          ]}
        </Box>
      ),
    )
    return (
      <Box flexDirection="row">
        <Text dimColor>{"❯ "}</Text>
        <Box flexDirection="column" flexGrow={1}>
          {body}
        </Box>
      </Box>
    )
  })
}
