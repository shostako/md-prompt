# md-prompt

Markdown, painted onto Claude Code's prompt box as you type. Fenced code becomes a syntax-highlighted card before you even close the fence; inline code, bold, italic, strikethrough, lists, task lists, quotes, headings, tables and links are styled too.

This is shostako's fork of [nogu66/md-prompt](https://github.com/nogu66/md-prompt). It adds VBA painting and draws your sent messages that hold code again, with the code highlighted.

**Paint only.** The plugin colours the characters of the draft but never changes them, so what you type, and what is sent to the model, is exactly what you typed.

Screenshots, the full list of what is painted, and troubleshooting: [github.com/shostako/md-prompt](https://github.com/shostako/md-prompt#readme).

## What the hooks do

The plugin is one hooks module, `hooks/register.tsx`:

| Hook | What it does |
| --- | --- |
| `prompt.edit` | After each edit or paste, adds style runs (`decorations`) over the draft in the prompt box. The text, the cursor and other plugins' decorations pass through unchanged |
| `prompt.fill` | When the whole draft is replaced (a plugin or the engine filling the box), adds the same style runs to the new draft |
| `session.start` | Registers the `/md-prompt` command |
| `command.run` (`/md-prompt`) | Shows or switches painting on or off, and saves it as the plugin's `enabled` setting. `/md-prompt vba` and `/md-prompt history` do the same for those two settings |
| `ui.render` (`UserMessage`) | Draws a sent message of your own that holds code again: prose as Markdown, code in the prompt box's colours. The stored message and what the model reads stay as typed |

It reads no files, runs no processes, makes no network or model calls, and does not touch tool calls or what you submit.

## Settings it changes

- **`md-prompt.enabled`**, the plugin's own **Markdown painting** setting (a toggle in `/config`): on paints, off leaves the prompt box as plain text. The default is on. `/md-prompt on | off | toggle` writes this one setting with `$.config.set`, as a change in `/config` would. It changes no setting other than the three listed here.
- **`md-prompt.vba`** (**VBA detection**, on by default): on paints a VBA procedure typed without a fence once its `End` line is typed. `/md-prompt vba on | off | toggle` writes it.
- **`md-prompt.history`** (**Markdown in history**, on by default): on draws your sent messages that hold code again. `/md-prompt history on | off | toggle` writes it.
- **Environment variables:** none. On Claude Code 2.1.285 and 2.1.286 you turn on function hooks yourself with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; the plugin does not set it.

## Install

```
/plugin install md-prompt --marketplace shostako/md-prompt
```
