// Hook-level tests, run by `claude plugin test plugins/md-prompt`: the real module, loaded by the
// engine's own host, driven through the events the kit can raise. What decides *what* is painted
// is covered at the unit level in /tests; this file covers the wiring: the command, the mode
// setting, and that the right events carry the decorations.
//
// `prompt.edit` is raised by the composer alone, so the kit has no call for it. `prompt.fill` is
// wired the same way (the same `paint`, the same mode), so it stands in for it here; `prompt.edit`
// itself is checked in a live session.

import { expect, test } from 'claude-code/testing'

const FENCE = '```ts\nconst a = 1\n```'
const CARD = '#1f2430' // PALETTE.codeBg

/**
 * Record what a fill hands down the chain. Hooks beneath the plugins must be registered before
 * the test's first `$` call, so this goes first; the returned function fills as often as needed.
 */
function recordFills(on: any) {
  let seen: any
  on('prompt.fill', ($: any, e: any) => {
    seen = e
    return { isFilled: true }
  })
  return async ($: any, args: { text: string; mode?: string; decorations?: unknown[] }) => {
    seen = undefined
    await $.prompt.fill(args)
    return seen
  }
}

/** Run `/md-prompt <args>` as typed; the engine stamps the origin and presentation itself. */
const run = ($: any, args: string) => $.command.run({ command: 'md-prompt', args })

/** Record every write of a `/config` row, and accept it. */
function acceptSettings(on: any) {
  const written: { key: string; value: unknown }[] = []
  on('config.set', ($: any, e: any) => {
    written.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  return written
}

test('session.start registers the /md-prompt command', async ($, on) => {
  const registered: any[] = []
  on('command.register', ($: any, e: any) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(registered.map((c) => c.name)).toEqual(['md-prompt'])
})

test('a replace fill carries the decorations of its text, its own kept', async ($, on) => {
  const fill = recordFills(on)
  const mine = { start: 0, end: 1, bold: true }
  const e = await fill($, { text: FENCE, mode: 'replace', decorations: [mine] })
  expect(e.text).toBe(FENCE)
  expect(e.decorations[0]).toEqual(mine)
  expect(e.decorations.some((d: any) => d.backgroundColor === CARD)).toBe(true)
  for (const d of e.decorations) {
    expect(d.start).toBeGreaterThanOrEqual(0)
    expect(d.end).toBeLessThanOrEqual(FENCE.length)
  }
})

test('an append or insert fill is left alone: its text is not the whole draft', async ($, on) => {
  const fill = recordFills(on)
  for (const mode of ['append', 'insert']) {
    const e = await fill($, { text: FENCE, mode })
    expect(e.decorations).toBeUndefined()
  }
})

test('the text of a fill is never changed', async ($, on) => {
  const fill = recordFills(on)
  const text = '**bold** `code`\n```py\nprint(1)\n```\n日本語 😀'
  const e = await fill($, { text, mode: 'replace' })
  expect(e.text).toBe(text)
})

test('the mode setting off paints nothing', { options: { mode: 'off' } }, async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations).toBeUndefined()
})

test('the mode setting code paints code and not emphasis', { options: { mode: 'code' } }, async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: '**bold** `code`', mode: 'replace' })
  expect(e.decorations.some((d: any) => d.bold)).toBe(false)
  expect(e.decorations.some((d: any) => d.backgroundColor)).toBe(true)
})

test('a bad mode value falls back to on', { options: { mode: 'sideways' } }, async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations.length).toBeGreaterThan(0)
})

test('/md-prompt off writes the setting and stops painting at once', async ($, on) => {
  const fill = recordFills(on)
  const written = acceptSettings(on)
  const result = await run($, 'off')
  expect(written).toEqual([{ key: 'md-prompt.mode', value: 'off' }])
  expect(result.text).toContain('off')
  expect(result.text).not.toContain('not saved')
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations).toBeUndefined()
})

test('/md-prompt code, then on, switch the mode back and forth', async ($, on) => {
  const fill = recordFills(on)
  const written = acceptSettings(on)
  await run($, 'code')
  let e = await fill($, { text: '**bold**', mode: 'replace' })
  expect(e.decorations).toEqual([]) // code mode: no emphasis, and nothing else in this text
  await run($, 'on')
  e = await fill($, { text: '**bold**', mode: 'replace' })
  expect(e.decorations.some((d: any) => d.bold)).toBe(true)
  expect(written.map((w) => w.value)).toEqual(['code', 'on'])
})

test('/md-prompt toggle flips between off and on', { options: { mode: 'off' } }, async ($, on) => {
  const written = acceptSettings(on)
  await run($, 'toggle')
  await run($, 'toggle')
  expect(written.map((w) => w.value)).toEqual(['on', 'off'])
})

test('a refused setting still applies for the session, and says it was not saved', async ($, on) => {
  const fill = recordFills(on)
  on('config.set', () => ({ deny: 'no row for plugin fields here' }))
  const result = await run($, 'off')
  expect(result.text).toContain('not saved')
  expect(result.text).toContain('no row for plugin fields here')
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations).toBeUndefined()
})

test('status and a bad argument write nothing', async ($, on) => {
  const written = acceptSettings(on)
  const status = await run($, '')
  expect(status.text).toContain('/md-prompt on | code | off | toggle')
  const bad = await run($, 'maybe')
  expect(bad.text).toContain('"maybe"')
  expect(written).toEqual([])
})

// ---- fork: VBA detection --------------------------------------------------------------------

const PROC = 'Sub Calc()\n  y = a * b\nEnd Sub'
const hasCard = (e: any) => (e.decorations ?? []).some((d: any) => d.backgroundColor === CARD)

test('an unfenced VBA procedure is painted by default', async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: PROC, mode: 'replace' })
  expect(hasCard(e)).toBe(true)
  expect(e.text).toBe(PROC)
})

test('the vba setting off leaves it to Markdown', { options: { vba: 'off' } }, async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: PROC, mode: 'replace' })
  expect(hasCard(e)).toBe(false)
})

test('/md-prompt vba off writes its own setting and stops detecting at once', async ($, on) => {
  const fill = recordFills(on)
  const written = acceptSettings(on)
  const result = await run($, 'vba off')
  expect(written).toEqual([{ key: 'md-prompt.vba', value: 'off' }])
  expect(result.text).toContain('VBA detection off')
  let e = await fill($, { text: PROC, mode: 'replace' })
  expect(hasCard(e)).toBe(false)
  await run($, 'vba on')
  e = await fill($, { text: PROC, mode: 'replace' })
  expect(hasCard(e)).toBe(true)
  expect(written.map((w) => w.value)).toEqual(['off', 'on'])
})

test('/md-prompt vba alone reports and writes nothing; status names it', async ($, on) => {
  const written = acceptSettings(on)
  const v = await run($, 'vba')
  expect(v.text).toContain('VBA detection on')
  const status = await run($, '')
  expect(status.text).toContain('/md-prompt vba on | off | toggle')
  expect(written).toEqual([])
})

// ---- fork: sent messages drawn again, code coloured ------------------------------------------

const userRow = (text: string, kind = 'composer', isExpanded = true) => ({
  component: 'UserMessage' as const,
  props: { text, origin: { kind }, isExpanded } as any,
})
/** Stand in for Claude Code's own drawing of the row, beneath the plugin. */
const engineDraws = (on: any) =>
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text', props: {}, children: ['ENGINE'] }))
const drawnOf = async ($: any, row: any, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'md-prompt', surface, ...row })
  const tree = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return tree
}
const KEYWORD = '#c586c0' // PALETTE.token.keyword

test('a sent message holding a fence: prose as Markdown, code coloured, on terminal and desktop', async ($, on) => {
  engineDraws(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await drawnOf($, userRow('見て\n```py\ndef f():\n    return 1\n```'), surface)
    expect(tree).toContain('"Markdown"')
    expect(tree).toContain(CARD)
    expect(tree).toContain(KEYWORD) // `def`, `return`
    expect(tree).not.toContain('ENGINE')
  }
})

test('an unfenced VBA procedure is drawn as a vba code block', async ($, on) => {
  engineDraws(on)
  const tree = await drawnOf($, userRow('Sub A()\n\tx = 1 \' c\nEnd Sub'))
  expect(tree).toContain('"vba"')
  expect(tree).toContain(KEYWORD)
  expect(tree).not.toContain('\\t') // tabs became spaces
})

test('a message without code keeps Claude Code drawing', async ($, on) => {
  engineDraws(on)
  expect(await drawnOf($, userRow('**太字** だけ'))).toContain('ENGINE')
})

test('a message from Remote Control is drawn too; a notification row is not', async ($, on) => {
  engineDraws(on)
  expect(await drawnOf($, userRow('```\nx\n```', 'bridge'))).toContain(CARD)
  expect(await drawnOf($, userRow('```\nx\n```', 'task-notification'))).toContain('ENGINE')
  // the normal view's own prompt: drawn even when not expanded (that flag is ctrl+o's)
  expect(await drawnOf($, userRow('```\nx\n```', 'composer', false))).toContain(CARD)
})

test('the history setting off keeps Claude Code drawing', { options: { history: 'off' } }, async ($, on) => {
  engineDraws(on)
  expect(await drawnOf($, userRow('```\nx\n```'))).toContain('ENGINE')
})

test('/md-prompt history off writes its setting and stops at once', async ($, on) => {
  engineDraws(on)
  const written = acceptSettings(on)
  const result = await run($, 'history off')
  expect(written).toEqual([{ key: 'md-prompt.history', value: 'off' }])
  expect(result.text).toContain('history off')
  expect(await drawnOf($, userRow('```\nx\n```'))).toContain('ENGINE')
})

test('/md-prompt history debug toggles a session-only diagnosis and writes nothing', async ($, on) => {
  const written = acceptSettings(on)
  expect((await run($, 'history debug')).text).toContain('history debug on')
  expect((await run($, 'history debug')).text).toContain('history debug off')
  expect(written).toEqual([])
})
