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
import {
  describeMode,
  describeVba,
  formatStatus,
  formatUsage,
  paintFor,
  parseModeCommand,
  readMode,
  readVbaAuto,
  type Mode,
  type VbaAuto,
} from "./lib/mode"

// `<plugin>.<field>` of the userConfig fields in plugin.json.
const MODE_SETTING = "md-prompt.mode"
const VBA_SETTING = "md-prompt.vba" // fork: VBA detection

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
function paint(value: Mode, text: string, vba: VbaAuto) {
  try {
    return paintFor(value, text, vba)
  } catch {
    return []
  }
}

export const register: Register = (on, options) => {
  let mode: Mode = readMode(options.mode)
  let vba: VbaAuto = readVbaAuto(options.vba)

  on("session.start", async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({
        name: "md-prompt",
        description: "Turn Markdown painting in the prompt box on, off, or code-only",
        argumentHint: "[on | code | off | toggle]",
        immediate: true,
      })
      .catch((err: unknown) => $.ui.log(`md-prompt: command.register failed: ${err}`))
    return r
  })

  on("command.run", { command: "md-prompt" }, async ($, e) => {
    const cmd = parseModeCommand(e.args, mode, vba)
    if (cmd.kind === "status") return { text: formatStatus(mode, vba) }
    if (cmd.kind === "usage") return { text: formatUsage(cmd.input) }
    if (cmd.kind === "vba") {
      if (cmd.value === null) return { text: describeVba(vba) }
      vba = cmd.value
      const failure = await writeSetting($, VBA_SETTING, vba)
      return { text: failure ? `${describeVba(vba)} (not saved for next time: ${failure})` : describeVba(vba) }
    }
    // Applies at once; a written setting reloads the module, which starts in the same mode.
    mode = cmd.mode
    const failure = await writeSetting($, MODE_SETTING, mode)
    return { text: failure ? `${describeMode(mode)} (not saved for next time: ${failure})` : describeMode(mode) }
  })

  on("prompt.edit", async ($, e, next) => {
    const box = await next(e)
    if (mode === "off") return box
    return { ...box, decorations: [...(box.decorations ?? []), ...paint(mode, box.text, vba)] }
  })

  on("prompt.fill", ($, e, next) => {
    if (mode === "off" || e.mode !== "replace") return next(e)
    return next({ ...e, decorations: [...(e.decorations ?? []), ...paint(mode, e.text, vba)] })
  })
}
