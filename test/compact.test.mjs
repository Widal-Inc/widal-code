// Tests for the help to compact the context at a good moment: the compactions in the logs and
// their report, the text that says what to keep, the earlier automatic point, the hint in the
// status line and the notification. With made-up logs and session files. Run: node --test
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs, { closeSync, ftruncateSync, mkdtempSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-compact-test-'))
// Widal.Code also reads the config folders of Claude Code in the home folder, so the home folder is a
// made-up one too.
process.env.HOME = join(dir, 'person')
// The link that Claude Code's settings call, in the tool's folder in the made-up home folder.
const OWN = join(process.env.HOME, '.widal', 'bin', 'widal')
process.env.WIDAL_HOME = join(dir, 'home')
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
// Cowork's folder too: without this a test would read the real Cowork logs of whoever runs it.
process.env.WIDAL_COWORK_DIR = join(dir, 'cowork')
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })

const { ClaudeParser } = await import('../src/parse-claude.mjs')
const { compactionsOf, median } = await import('../src/analyze.mjs')
const { compactions } = await import('../src/report.mjs')
const { load } = await import('../src/store.mjs')
const { saveConfig } = await import('../src/config.mjs')
const { DEFAULT_KEEP, autoCompactPoint, compactHintConfig, compactHintSettingsText, compactKeepText, contextBase, saveCompactKeep } = await import('../src/compact.mjs')
const { statusLine } = await import('../src/claude-code.mjs')
const { nudgeText } = await import('../src/nudge.mjs')
const { ACTIONS, actionsStatus, applied: appliedActions, apply: applyAction, undo: undoAction } = await import('../src/actions.mjs')
const { uninstall } = await import('../src/install.mjs')
const { adviseReport, measureReport, proposals } = await import('../src/advise.mjs')
const { day, when } = await import('../src/format.mjs')

const MIN = 60e3
const DAY = 86400e3
const START = Date.parse('2026-11-12T10:00:00Z')
const BIN = fileURLToPath(new URL('../cli/widal.mjs', import.meta.url))

/**
 * Runs the command with folders of its own below `name`, so that it sees no log and no setting of
 * another test, and nothing of the real environment but the PATH. Returns the folders and a
 * function that runs the command. `input` is what the command gets on stdin.
 */
function command(name) {
  const own = join(dir, name)
  const env = { PATH: process.env.PATH, HOME: own, USERPROFILE: own, WIDAL_HOME: join(own, 'home'), CLAUDE_CONFIG_DIR: join(own, 'claude'), CODEX_HOME: join(own, 'codex'), WIDAL_COWORK_DIR: join(own, 'cowork') }
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true })
  const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, input })
  return { env, run }
}

// Each test that changes this tool's files or Claude Code's settings gets its own empty folders.
let homes = 0
const SETTINGS = () => join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
const freshHome = () => {
  process.env.WIDAL_HOME = join(dir, `home-${++homes}`)
  process.env.CLAUDE_CONFIG_DIR = join(dir, `claude-${homes}`)
  mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
}
/** Claude Code's settings as they are in the file now. */
const settings = () => JSON.parse(readFileSync(SETTINGS(), 'utf8'))
/** This tool's settings as they are in the file now. */
const ownConfig = (home = process.env.WIDAL_HOME) => JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))

let made = 0
/** One line of a Claude Code log: a model call at the time `ts`, in the folder `cwd`. */
const call = (ts, cwd = '/work/repo') => JSON.stringify({
  type: 'assistant', timestamp: new Date(ts).toISOString(), cwd,
  message: { id: `m${++made}`, model: 'claude-opus-5-5', role: 'assistant', content: [], usage: { input_tokens: 100, cache_read_input_tokens: 50000, output_tokens: 1000 } },
})
/**
 * The line that Claude Code writes for one compaction. `meta` is its "compactMetadata". Without
 * one it is an automatic compaction from 366,000 to 31,000 tokens that took 95 seconds.
 */
const boundary = (ts, meta = { trigger: 'auto', preTokens: 366000, postTokens: 31000, durationMs: 95000 }, cwd = '/work/repo') => JSON.stringify({
  type: 'system', subtype: 'compact_boundary', content: 'a private line', timestamp: new Date(ts).toISOString(), cwd, compactMetadata: meta,
})
const facts = (trigger, preTokens, postTokens, seconds) => ({ trigger, preTokens, postTokens, durationMs: seconds * 1000 })

/** What Claude Code's parser gives for the lines of one log: `{ records, meta }`. */
function parse(lines, file = '/logs/s1.jsonl') {
  const p = new ClaudeParser(file)
  for (const l of lines) p.feed(l)
  return p.result()
}
/** The calls and the metas of several logs, as `load()` gives them. `logs` maps the path of a log to its lines. */
function loaded(logs) {
  const out = { records: [], metas: new Map() }
  for (const [file, lines] of Object.entries(logs)) {
    const { records, meta } = parse(lines, file)
    out.records.push(...records)
    out.metas.set(file, meta)
  }
  return out
}

test('the parser keeps the facts of each compaction of a session, and a log without one gives none', () => {
  const { records, meta } = parse([
    call(START),
    boundary(START + 2 * MIN),
    call(START + 4 * MIN),
    boundary(START + 30 * MIN, { trigger: 'manual', preTokens: 210500, postTokens: 20000, durationMs: 30500, more: 'a field this reader does not know' }, '/work/other'),
  ])
  assert.deepEqual(meta.compactions, [
    { ts: START + 2 * MIN, trigger: 'auto', pre: 366000, post: 31000, sec: 95, ses: 's1', agent: undefined, cwd: '/work/repo' },
    { ts: START + 30 * MIN, trigger: 'manual', pre: 210500, post: 20000, sec: 30.5, ses: 's1', agent: undefined, cwd: '/work/other' },
  ])
  // A compaction is no model call. The call after it still starts a new context.
  assert.equal(records.length, 2)
  assert.deepEqual(records.map((r) => r.ac), [undefined, true])
  // No text of the line is kept.
  assert.doesNotMatch(JSON.stringify(meta), /private|does not know/)
  // The compaction of a subagent names the subagent and the session it belongs to.
  const sub = parse([boundary(START)], '/logs/s9/subagents/agent-a1.jsonl').meta.compactions
  assert.deepEqual(sub.map((c) => [c.ses, c.agent]), [['s9', 'agent-a1']])
  // A line without a folder takes the folder that the log named first.
  const line = JSON.parse(boundary(START + MIN))
  delete line.cwd
  assert.equal(parse([call(START, '/work/first'), JSON.stringify(line)]).meta.compactions[0].cwd, '/work/first')

  assert.deepEqual(parse([call(START), call(START + MIN)]).meta.compactions, [])
  assert.deepEqual(parse([]).meta.compactions, [])
})

test('a compaction whose "compactMetadata" is broken is not kept, and the call after it still starts a new context', () => {
  const good = facts('auto', 366000, 31000, 95)
  const broken = [
    undefined, null, 'a private text', 7, [], {},
    { ...good, trigger: 'idle' }, { ...good, trigger: undefined }, { ...good, trigger: 5 },
    { ...good, preTokens: '366000' }, { ...good, preTokens: undefined }, { ...good, preTokens: 0 }, { ...good, preTokens: -5 }, { ...good, preTokens: null },
    { ...good, postTokens: '31000' }, { ...good, postTokens: undefined }, { ...good, postTokens: -1 }, { ...good, postTokens: {} },
    { ...good, durationMs: 'long' }, { ...good, durationMs: undefined }, { ...good, durationMs: -1 },
  ]
  for (const meta of broken) {
    const line = JSON.stringify({ ...JSON.parse(boundary(START + MIN)), compactMetadata: meta })
    const { records, meta: kept } = parse([call(START), line, call(START + 2 * MIN)])
    assert.deepEqual(kept.compactions, [], JSON.stringify(meta))
    assert.deepEqual(records.map((r) => r.ac), [undefined, true], JSON.stringify(meta))
  }
  // A time that cannot be read: the compaction cannot be placed in a period.
  for (const timestamp of [undefined, 'soon', 7, null]) {
    const line = { ...JSON.parse(boundary(START)), timestamp }
    assert.deepEqual(parse([JSON.stringify(line)]).meta.compactions, [], String(timestamp))
  }
  // A context of 0 tokens after it, and a compaction that took no time, can be true.
  assert.deepEqual(parse([boundary(START, facts('manual', 1, 0, 0))]).meta.compactions.map((c) => [c.pre, c.post, c.sec]), [[1, 0, 0]])
  // A broken line next to a good one: the good one is kept.
  assert.equal(parse([boundary(START, 'broken'), boundary(START + MIN), '{"type":"system","subtype":"compact_boundary","compactMetadata":{'].flat()).meta.compactions.length, 1)
})

test('the median is the middle value, and the mean of the two in the middle for an even number', () => {
  assert.equal(median([]), 0)
  assert.equal(median([7]), 7)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([900000, 200000, 400000, 500000, 300000]), 400000)
})

// Five compactions in two sessions, with numbers that are easy to check by hand.
//   Session a: 300k to 30k in 60 s (90% smaller), 400k to 20k in 120 s (95%), 900k to 45k in
//   90 s (95%), all automatic, and by hand 200k to 50k in 30 s (75%).
//   Session b: 500k to 40k in 100 s (92%), automatic.
const A = '/logs/work-repo/a.jsonl'
const B = '/logs/work-other/b.jsonl'
const five = () => loaded({
  [A]: [
    // A call exactly 5 minutes before the first compaction: in the middle of work.
    call(START),
    boundary(START + 5 * MIN, facts('auto', 300000, 30000, 60)),
    // The call before the second one is 1 millisecond more than 5 minutes back: not in the middle of work.
    call(START + 10 * MIN),
    boundary(START + 15 * MIN + 1, facts('auto', 400000, 20000, 120)),
    // The third one has a call only after it.
    boundary(START + 60 * MIN, facts('auto', 900000, 45000, 90)),
    call(START + 60 * MIN + 1),
    boundary(START + 120 * MIN, facts('manual', 200000, 50000, 30)),
  ],
  [B]: [
    // A call of this session 1 millisecond before its compaction: in the middle of work. The
    // call of session a at the same time as the third compaction of a does not count for a.
    call(START + 60 * MIN - 1, '/work/other'),
    boundary(START + 60 * MIN, facts('auto', 500000, 40000, 100), '/work/other'),
  ],
})

test('the report gives the medians and the range of the sizes, for all compactions, the automatic ones and those by hand', () => {
  const { records, metas } = five()
  const text = compactions(records, metas, { days: 30, since: START })
  const lines = text.split('\n')
  assert.equal(lines[0], 'Compactions, last 30 days. A compaction replaces a long conversation with a summary.')
  assert.equal(lines[1], 'Tokens before and after: the median, then the smallest to the largest. Smaller by, and took: the median.')
  const cells = (name) => lines.find((l) => l.startsWith(name)).split(/ {2,}/)
  assert.deepEqual(lines[3].trim().split(/ {2,}/), ['how many', 'tokens before', 'tokens after', 'smaller by', 'took'])
  // All five. Before: 200k 300k 400k 500k 900k. After: 20k 30k 40k 45k 50k. Smaller by: 75 90 92 95 95. Took: 30 60 90 100 120.
  assert.deepEqual(cells('All'), ['All', '5', '400k (200k to 900k)', '40k (20k to 50k)', '92%', '90 seconds'])
  // The four automatic ones. Before: 300k 400k 500k 900k. After: 20k 30k 40k 45k. Smaller by: 90 92 95 95, so 93.5. Took: 60 90 100 120.
  assert.deepEqual(cells('Automatic'), ['Automatic', '4', '450k (300k to 900k)', '35k (20k to 45k)', '94%', '95 seconds'])
  assert.deepEqual(cells('By hand'), ['By hand', '1', '200k (200k to 200k)', '50k (50k to 50k)', '75%', '30 seconds'])
  assert.equal(lines.at(-1), 'There is no percent to aim for. The size after is about the same each time, so the percent only says how large the context was allowed to get.')
  assert.doesNotMatch(text, /[\u2013\u2014]/) // No dashes in what a person reads.

  // A kind without a compaction has a row with 0 and nothing else.
  const onlyAuto = loaded({ [A]: [boundary(START)] })
  const rows = compactions(onlyAuto.records, onlyAuto.metas, { days: 7, since: START }).split('\n')
  assert.equal(rows.find((l) => l.startsWith('By hand')).replace(/ +/g, ' '), 'By hand 0')
  assert.deepEqual(rows.find((l) => l.startsWith('Automatic')).split(/ {2,}/), ['Automatic', '1', '366k (366k to 366k)', '31k (31k to 31k)', '92%', '95 seconds'])
})

test('the report counts the automatic compactions that came in the middle of work: a call of the same session in the 5 minutes before', () => {
  const { records, metas } = five()
  const sentence = (r, m, since = START) => compactions(r, m, { days: 30, since }).split('\n').find((l) => /automatic/.test(l) && !l.startsWith('Automatic'))
  // The first of session a (a call exactly 5 minutes before) and the one of session b.
  assert.equal(sentence(records, metas), 'Of the automatic compactions, 2 of 4 came in the middle of work (the session had made a model call in the 5 minutes before).')
  // Without the calls, none did.
  assert.equal(sentence([], metas), 'Of the automatic compactions, 0 of 4 came in the middle of work (the session had made a model call in the 5 minutes before).')
  // A compaction by hand is not counted, also when a call came right before it.
  const byHand = loaded({ [A]: [call(START), boundary(START + MIN, facts('manual', 200000, 50000, 30))] })
  assert.equal(sentence(byHand.records, byHand.metas), 'No compaction was automatic.')
  // The call of a subagent counts for its session.
  const withSub = loaded({ [A]: [boundary(START + MIN)], '/logs/work-repo/a/subagents/agent-x.jsonl': [call(START)] })
  assert.equal(sentence(withSub.records, withSub.metas), 'Of the automatic compactions, 1 of 1 came in the middle of work (the session had made a model call in the 5 minutes before).')
  // A call that is older than the period still counts for a compaction at its start.
  assert.equal(sentence(withSub.records, withSub.metas, START + MIN), 'Of the automatic compactions, 1 of 1 came in the middle of work (the session had made a model call in the 5 minutes before).')
})

test('the report counts the automatic compactions that look like the idle rule: 50 to 70 minutes after the last call of their own log', () => {
  const idle = (r, m) => compactions(r, m, { days: 30, since: START }).split('\n').find((l) => /idle rule/.test(l))
  const one = (gap, trigger = 'auto') => loaded({ [A]: [call(START), boundary(START + gap, facts(trigger, 400000, 30000, 60))] })
  const said = (n, of) => `${n} of ${of} came 50 to 70 minutes after the last model call of their own conversation. That is how Claude Code's idle rule looks: it compacts an idle session of about 200,000 tokens or more shortly before its 1 hour cache ends.`
  // The two bounds count, and one millisecond outside each does not.
  for (const gap of [50 * MIN, 70 * MIN]) { const x = one(gap); assert.equal(idle(x.records, x.metas), said(1, 1)) }
  for (const gap of [50 * MIN - 1, 70 * MIN + 1]) { const x = one(gap); assert.equal(idle(x.records, x.metas), undefined) }
  // A compaction by hand is not counted, and neither is one with no call before it.
  const byHand = one(60 * MIN, 'manual')
  assert.equal(idle(byHand.records, byHand.metas), undefined)
  const alone = loaded({ [A]: [boundary(START + 60 * MIN)] })
  assert.equal(idle(alone.records, alone.metas), undefined)
  // The call of a subagent 1 minute before does not count: the main conversation was idle for an hour.
  const withSub = loaded({ [A]: [call(START), boundary(START + 60 * MIN)], '/logs/work-repo/a/subagents/agent-x.jsonl': [call(START + 59 * MIN)] })
  assert.equal(idle(withSub.records, withSub.metas), said(1, 1))
  // The made-up logs of the other tests: the third compaction of session a comes exactly 50 minutes after a call.
  const { records, metas } = five()
  assert.equal(idle(records, metas), said(1, 4))
})

test('the report names the five sessions with the most compactions, with the folder and the largest size before', () => {
  const { records, metas } = five()
  const sessions = (text) => {
    const lines = text.split('\n')
    const from = lines.indexOf('The sessions with the most compactions')
    return lines.slice(from + 1, lines.indexOf('', from)).map((l) => l.trim().split(/ {2,}/))
  }
  assert.deepEqual(sessions(compactions(records, metas, { days: 30, since: START })), [
    ['work/repo', '4 compactions', 'largest before: 900k'],
    ['work/other', '1 compaction', 'largest before: 500k'],
  ])
  // Seven sessions: the five with the most are shown. With the same number, the larger size comes first.
  const seven = loaded(Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [
    `/logs/p/s${n}.jsonl`,
    Array.from({ length: n === 7 ? 6 : n }, (_, i) => boundary(START + (n * 100 + i) * MIN, facts('auto', 100000 * n + 1000 * i, 30000, 60), `/work/folder-${n}`)),
  ])))
  assert.deepEqual(sessions(compactions(seven.records, seven.metas, { days: 30, since: START })), [
    ['work/folder-7', '6 compactions', 'largest before: 705k'],
    ['work/folder-6', '6 compactions', 'largest before: 605k'],
    ['work/folder-5', '5 compactions', 'largest before: 504k'],
    ['work/folder-4', '4 compactions', 'largest before: 403k'],
    ['work/folder-3', '3 compactions', 'largest before: 302k'],
  ])
  // A folder name from a log is printed without control characters.
  const odd = loaded({ [A]: [boundary(START, undefined, '/work/odd\x1b[31m\nname')] })
  assert.deepEqual(sessions(compactions(odd.records, odd.metas, { days: 30, since: START })), [['work/odd[31mname', '1 compaction', 'largest before: 366k']])
})

test('a period without a compaction gets one sentence, and a compaction before the period or repeated in a second log is not counted', () => {
  assert.equal(compactions([], new Map(), { days: 30, since: START }), 'No compaction in the last 30 days.')
  const none = loaded({ [A]: [call(START), call(START + MIN)] })
  assert.equal(compactions(none.records, none.metas, { days: 7, since: START }), 'No compaction in the last 7 days.')
  // A log that changed in the period holds its older compactions too.
  const { records, metas } = five()
  assert.equal(compactions(records, metas, { days: 1, since: START + 120 * MIN + 1 }), 'No compaction in the last 1 days.')
  const last = compactions(records, metas, { days: 1, since: START + 120 * MIN })
  assert.match(last, /^All +1 +200k \(200k to 200k\)/m)
  // The metas of other agents hold no compactions, and one that is broken is passed over.
  const mixed = new Map([...metas, ['/codex/rollout.jsonl', { limits: {} }], ['/cowork/x.jsonl', {}], ['/broken.jsonl', { compactions: 'many' }], ['/empty.jsonl', undefined]])
  assert.equal(compactionsOf(mixed).length, 5)
  assert.deepEqual(compactionsOf(mixed).map((c) => c.ts), [5, 15, 60, 60, 120].map((m, i) => START + m * MIN + (i === 1 ? 1 : 0)))
  // A resumed session repeats its lines in a second log: the same compaction is counted once.
  const resumed = loaded({ [A]: [boundary(START)], '/logs/work-repo/a2.jsonl': [boundary(START), boundary(START + MIN)] })
  assert.equal(compactionsOf(resumed.metas).length, 2)
  assert.equal(compactionsOf(undefined).length, 0)
})

test('"widal compactions" reads the logs of 30 days unless --days says otherwise, also from the cache', async () => {
  const { env, run } = command('compactions-command')
  assert.equal(run(['compactions']).stdout, 'No compaction in the last 30 days.\n')
  assert.equal(run(['compactions', '--days', '14']).stdout, 'No compaction in the last 14 days.\n')
  // The command takes the time from the clock, so the compactions are placed by the clock too:
  // 10, 29 and 31 days ago. Each is a day or more away from the limits of 14 and 30 days.
  const project = join(env.CLAUDE_CONFIG_DIR, 'projects', 'work-repo')
  mkdirSync(project, { recursive: true })
  const now = Date.now()
  writeFileSync(join(project, 'ages.jsonl'), `${[31, 29, 10].flatMap((days) => [call(now - days * DAY - MIN), boundary(now - days * DAY)]).join('\n')}\n`)
  const seen = (...args) => {
    const r = run(['compactions', ...args])
    assert.deepEqual([r.status, r.stderr], [0, ''])
    return [r.stdout.split('\n')[0], /^All +(\d+) /m.exec(r.stdout)?.[1], /(\d+ of \d+) came in the middle of work/.exec(r.stdout)?.[1]]
  }
  assert.deepEqual(seen(), ['Compactions, last 30 days. A compaction replaces a long conversation with a summary.', '2', '2 of 2'])
  assert.deepEqual(seen('--days', '14'), ['Compactions, last 14 days. A compaction replaces a long conversation with a summary.', '1', '1 of 1'])
  assert.deepEqual(seen('--days', '60'), ['Compactions, last 60 days. A compaction replaces a long conversation with a summary.', '3', '3 of 3'])
  assert.match(run(['help']).stdout, /^  widal compactions \[--days 30\] +the compactions of your sessions: how many, and the context before and after$/m)

  // The parsed log is kept in the cache with its compactions. A cache file of the version
  // before has none: the log is parsed again.
  const cache = join(env.WIDAL_HOME, 'cache')
  const files = readdirSync(cache)
  assert.equal(files.length, 1)
  const entry = JSON.parse(readFileSync(join(cache, files[0]), 'utf8'))
  assert.equal(entry.v, 14)
  assert.equal(entry.meta.compactions.length, 3)
  writeFileSync(join(cache, files[0]), JSON.stringify({ ...entry, v: 9, meta: {} }))
  assert.deepEqual(seen('--days', '60')[1], '3')
  // `load()` gives the same from the cache as from the log.
  Object.assign(process.env, { WIDAL_HOME: env.WIDAL_HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR })
  try {
    const { metas } = await load({ since: 0, sources: ['claude'] })
    assert.deepEqual(compactionsOf(metas).map((c) => [c.trigger, c.pre, c.post, c.sec, c.ses, c.cwd]), [1, 2, 3].map(() => ['auto', 366000, 31000, 95, 'ages', '/work/repo']))
  } finally {
    Object.assign(process.env, { WIDAL_HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: join(dir, 'claude') })
  }
})

const KEEP = 'Keep what the person asked for and decided, the current plan with its open steps, the files that were changed, commands that have to be run again, and everything the person said not to do.'

test('"widal compact-keep" shows the default text, sets the person\'s own, and puts the default back', () => {
  assert.equal(DEFAULT_KEEP, KEEP)
  const { env, run } = command('keep-command')
  const out = (...args) => {
    const r = run(['compact-keep', ...args])
    assert.deepEqual([r.status, r.stderr], [0, ''], args.join(' '))
    return r.stdout.split('\n')
  }
  const NOT_YET = 'Claude Code is not given the text yet. Add the hook for that with: widal apply compact-keep'
  const HOW = 'Set your own with: widal compact-keep "<text>". Put the default back with: widal compact-keep --default'
  assert.deepEqual(out(), ['What a summary has to keep, at every compaction (the default text):', KEEP, HOW, NOT_YET, ''])
  // Showing the text saves nothing.
  assert.throws(() => ownConfig(env.WIDAL_HOME), { code: 'ENOENT' })

  // The other settings stay when the text is set.
  mkdirSync(env.WIDAL_HOME, { recursive: true })
  writeFileSync(join(env.WIDAL_HOME, 'config.json'), JSON.stringify({ limits: { day: 200, action: 'warn' } }))
  const own = 'Keep the names of the tables, and the test that still fails.'
  assert.deepEqual(out(own), ['The text is saved.', NOT_YET, ''])
  assert.deepEqual(ownConfig(env.WIDAL_HOME), { limits: { day: 200, action: 'warn' }, compactKeep: { text: own } })
  assert.deepEqual(out(), ['What a summary has to keep, at every compaction (your own text):', own, HOW, NOT_YET, ''])
  // A text can have more than one line.
  assert.deepEqual(out('first line\nsecond line'), ['The text is saved.', NOT_YET, ''])
  assert.equal(ownConfig(env.WIDAL_HOME).compactKeep.text, 'first line\nsecond line')

  // Once the hook is applied, the note about it is gone.
  assert.equal(run(['apply', 'compact-keep']).status, 0)
  assert.deepEqual(out(own), ['The text is saved.', ''])
  assert.deepEqual(out(), ['What a summary has to keep, at every compaction (your own text):', own, HOW, ''])

  // The default comes back, and the person's text is out of the settings.
  assert.deepEqual(out('--default'), ['The default text is back.', ''])
  assert.deepEqual(ownConfig(env.WIDAL_HOME), { limits: { day: 200, action: 'warn' } })
  assert.deepEqual(out(), ['What a summary has to keep, at every compaction (the default text):', KEEP, HOW, ''])
  assert.deepEqual(out('--default'), ['The default text is back.', ''])

  const help = run(['help']).stdout
  assert.match(help, /^  widal compact-keep +the text that says what a summary has to keep, at every compaction$/m)
  assert.match(help, /^  widal compact-keep "<text>" +set your own text \(put the default back with: widal compact-keep --default\)$/m)
})

test('the text has 1 to 10,000 characters: a text outside that, or more than one argument, fails with one sentence and changes nothing', () => {
  const { env, run } = command('keep-bounds')
  const config = () => ownConfig(env.WIDAL_HOME)
  const set = (...args) => {
    const r = run(['compact-keep', ...args])
    return [r.status, r.stdout, r.stderr]
  }
  const saved = [0, 'The text is saved.\nClaude Code is not given the text yet. Add the hook for that with: widal apply compact-keep\n', '']
  // The two bounds, and one step outside each.
  assert.deepEqual(set('k'), saved)
  assert.deepEqual(config(), { compactKeep: { text: 'k' } })
  assert.deepEqual(set(''), [1, '', 'widal: The text has to be 1 to 10,000 characters long, and this one has 0.\n'])
  assert.deepEqual(set('k'.repeat(10000)), saved)
  assert.equal(config().compactKeep.text.length, 10000)
  assert.deepEqual(set('k'.repeat(10001)), [1, '', 'widal: The text has to be 1 to 10,000 characters long, and this one has 10,001.\n'])
  assert.equal(config().compactKeep.text.length, 10000)
  // A text that is not in quotes arrives as several arguments. A text after --default is not expected either.
  const how = 'widal: Use "widal compact-keep", "widal compact-keep --default", or "widal compact-keep" with your text as one argument, in quotes.\n'
  assert.deepEqual(set('keep', 'the', 'plan'), [1, '', how])
  assert.deepEqual(set('--default', 'keep the plan'), [1, '', how])
  assert.deepEqual(set('keep the plan', '--default'), [1, '', how])
  assert.equal(config().compactKeep.text.length, 10000)

  // The same through the function: only text of 1 to 10,000 characters is saved.
  freshHome()
  for (const bad of ['', 'k'.repeat(10001), 7, null, ['a text'], { text: 'a text' }]) assert.throws(() => saveCompactKeep(bad), /^Error: The text has to be 1 to 10,000 characters long, and this one has [\d,]+\.$/, JSON.stringify(bad))
  assert.throws(() => ownConfig(), { code: 'ENOENT' })
  saveCompactKeep('k')
  assert.equal(compactKeepText(), 'k')
  saveCompactKeep(undefined)
  assert.equal(compactKeepText(), KEEP)
  assert.deepEqual(ownConfig(), {})
})

test('"widal hook compact-keep" prints exactly the text and exits 0, the same for an automatic compaction and for one by hand', () => {
  const { env, run } = command('keep-hook')
  const hook = (input) => {
    const r = run(['hook', 'compact-keep'], input)
    return [r.status, r.stdout, r.stderr]
  }
  const auto = JSON.stringify({ session_id: 'one', hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null })
  const byHand = JSON.stringify({ session_id: 'one', hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: 'a private wish for the summary' })
  // The default, with no settings file. No line break is added, and nothing of the input is printed.
  for (const input of [auto, byHand, undefined, '', 'not JSON']) assert.deepEqual(hook(input), [0, KEEP, ''], String(input))
  // With settings that do not name a text: still the default.
  mkdirSync(env.WIDAL_HOME, { recursive: true })
  const config = (value) => writeFileSync(join(env.WIDAL_HOME, 'config.json'), typeof value === 'string' ? value : JSON.stringify(value))
  config({ nudge: { on: true } })
  assert.deepEqual(hook(auto), [0, KEEP, ''])
  // The person's own text, with its line breaks and spaces as they are.
  const own = '  Keep the names of the tables.\nKeep the test that still fails.\n'
  config({ compactKeep: { text: own } })
  for (const input of [auto, byHand]) assert.deepEqual(hook(input), [0, own, ''])
  config({ compactKeep: { text: 'k'.repeat(10000) } })
  assert.deepEqual(hook(auto), [0, 'k'.repeat(10000), ''])
  // The hook saves nothing.
  assert.deepEqual(readdirSync(env.WIDAL_HOME), ['config.json'])
})

test('the hook prints nothing and exits 0 when the settings are broken, and the command then says what is wrong', () => {
  const { env, run } = command('keep-broken')
  mkdirSync(env.WIDAL_HOME, { recursive: true })
  const file = join(env.WIDAL_HOME, 'config.json')
  const noText = `widal: "compactKeep" in ${file} does not hold a text of 1 to 10,000 characters. Set one with: widal compact-keep "<text>"\n`
  const broken = [
    ['{"compactKeep": {"text": "Keep the pl', `widal: ${file} is not valid JSON, so the text is not known.\n`],
    ['', `widal: ${file} is not valid JSON, so the text is not known.\n`],
    ['[]', `widal: ${file} does not hold a JSON object, so the text is not known.\n`],
    ['"Keep the plan."', `widal: ${file} does not hold a JSON object, so the text is not known.\n`],
    ['null', `widal: ${file} does not hold a JSON object, so the text is not known.\n`],
    [JSON.stringify({ compactKeep: 'Keep the plan.' }), noText],
    [JSON.stringify({ compactKeep: null }), noText],
    [JSON.stringify({ compactKeep: {} }), noText],
    [JSON.stringify({ compactKeep: { text: 7 } }), noText],
    [JSON.stringify({ compactKeep: { text: '' } }), noText],
    [JSON.stringify({ compactKeep: { text: 'k'.repeat(10001) } }), noText],
    [JSON.stringify({ compactKeep: { text: ['Keep the plan.'] } }), noText],
  ]
  for (const [content, sentence] of broken) {
    writeFileSync(file, content)
    const hook = run(['hook', 'compact-keep'], JSON.stringify({ trigger: 'auto' }))
    assert.deepEqual([hook.status, hook.stdout, hook.stderr], [0, '', ''], content.slice(0, 60))
    const shown = run(['compact-keep'])
    assert.deepEqual([shown.status, shown.stdout, shown.stderr], [1, '', sentence], content.slice(0, 60))
  }
  // A settings file that cannot be read as a file: here a folder stands in its place.
  const { env: other, run: runOther } = command('keep-unreadable')
  mkdirSync(join(other.WIDAL_HOME, 'config.json'), { recursive: true })
  const hook = runOther(['hook', 'compact-keep'])
  assert.deepEqual([hook.status, hook.stdout, hook.stderr], [0, '', ''])
  assert.match(runOther(['compact-keep']).stderr, /config\.json cannot be read \(EISDIR\), so the text is not known\.\n$/)

  // The same through the function.
  freshHome()
  assert.equal(compactKeepText(), KEEP)
  saveConfig({ compactKeep: { text: 5 } })
  assert.throws(() => compactKeepText(), /does not hold a text of 1 to 10,000 characters/)
  // Setting a text puts the settings right again.
  saveCompactKeep('Keep the plan.')
  assert.equal(compactKeepText(), 'Keep the plan.')
})

test('"apply compact-keep" adds one hook before a compaction, with a backup, and "undo" takes only that hook out', () => {
  freshHome()
  const ours = { type: 'command', command: `${OWN} hook compact-keep`, timeout: 5 }
  const theirs = { type: 'command', command: '/bin/other-tool before-compact' }
  const OTHER = {
    model: 'claude-fable-5-2',
    hooks: {
      PreCompact: [{ matcher: 'manual', hooks: [theirs] }],
      Stop: [{ hooks: [{ type: 'command', command: '/bin/other-tool stop' }] }],
    },
  }
  const backups = () => readdirSync(join(process.env.WIDAL_HOME, 'backup'))
  // Off until it is applied.
  assert.deepEqual(actionsStatus().find(([id]) => id === 'compact-keep'), ['compact-keep', 'not applied'])
  assert.deepEqual(undoAction('compact-keep', OWN), ['compact-keep was not applied by this tool, so there is nothing to take back.'])
  writeFileSync(SETTINGS(), JSON.stringify(OTHER))

  const said = applyAction('compact-keep', OWN)
  assert.deepEqual(said, [ACTIONS['compact-keep'].what, ACTIONS['compact-keep'].note, 'Take it back with: widal undo compact-keep'])
  assert.match(said[0], /^Adds a hook to Claude Code that runs before every compaction, automatic or by hand\./)
  // The hook has no matcher, so it runs for both kinds of compaction. The other tool's hooks stay.
  assert.deepEqual(settings(), { ...OTHER, hooks: { ...OTHER.hooks, PreCompact: [{ matcher: 'manual', hooks: [theirs] }, { hooks: [ours] }] } })
  // The settings as they were before are in the backup folder.
  assert.equal(backups().length, 1)
  assert.deepEqual(JSON.parse(readFileSync(join(process.env.WIDAL_HOME, 'backup', backups()[0]), 'utf8')), OTHER)
  assert.deepEqual(Object.keys(appliedActions()), ['compact-keep'])
  assert.match(actionsStatus().find(([id]) => id === 'compact-keep')[1], /^applied on \d{4}-\d\d-\d\d$/)
  assert.deepEqual(applyAction('compact-keep', OWN), ['compact-keep is already applied.'])

  assert.deepEqual(undoAction('compact-keep', OWN), ['compact-keep is taken back. Claude Code\'s settings are as they were before it.'])
  assert.deepEqual(settings(), OTHER)
  assert.deepEqual(appliedActions(), {})

  // A group that this tool's hook shares with another tool's hook keeps the other one.
  writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreCompact: [{ hooks: [theirs, ours] }] } }))
  applyAction('compact-keep', OWN)
  assert.deepEqual(settings(), { hooks: { PreCompact: [{ hooks: [theirs] }, { hooks: [ours] }] } })
  undoAction('compact-keep', OWN)
  assert.deepEqual(settings(), { hooks: { PreCompact: [{ hooks: [theirs] }] } })
  // The hook that somebody took out by hand: the status says so, and applying puts it back.
  applyAction('compact-keep', OWN)
  writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreCompact: [{ hooks: [theirs] }] } }))
  assert.match(actionsStatus().find(([id]) => id === 'compact-keep')[1], /, but no longer in the settings$/)
  applyAction('compact-keep', OWN)
  assert.deepEqual(settings().hooks.PreCompact, [{ hooks: [theirs] }, { hooks: [ours] }])
  // "uninstall" takes the hook out with this tool's other hooks.
  assert.equal(uninstall(), true)
  assert.deepEqual(settings(), { hooks: { PreCompact: [{ hooks: [theirs] }] } })

  // With no settings file at all: the hook is added, and the undo leaves no hook behind.
  freshHome()
  applyAction('compact-keep', OWN)
  assert.deepEqual(settings(), { hooks: { PreCompact: [{ hooks: [ours] }] } })
  undoAction('compact-keep', OWN)
  assert.deepEqual(settings(), { hooks: {} })
  // Settings that are not in the shape Claude Code writes are not changed.
  writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreCompact: 'a hook' } }))
  assert.throws(() => applyAction('compact-keep', OWN), { message: `"hooks.PreCompact" in ${SETTINGS()} is not a list, so this tool does not change it.` })
  assert.deepEqual(settings(), { hooks: { PreCompact: 'a hook' } })
  assert.deepEqual(appliedActions(), {})
})

let recorded = 0
/**
 * One model call as a parser returns it, for the replay: a call on Claude Opus 5.5 that read
 * `read` tokens from the cache and nothing else. A read costs $0.20 per million tokens, so such
 * a call costs $0.02 per 100,000 tokens. `more` changes fields, for example the log or the agent.
 */
const record = (read, ts, more = {}) => ({
  s: 'claude', f: '/logs/work-repo/main.jsonl', ses: 'main', cwd: '/work/repo', ts, id: `r${++recorded}`, m: 'claude-opus-5-5',
  in: 0, w5: 0, w1: 0, cr: read, out: 0, th: 0, web: 0, tools: [], add: [], ...more,
})
/**
 * Calls whose carried context can be checked by hand. The first call of a log carries nothing.
 *   Main session: a call that carries 600,000 tokens ($0.12 to carry), then one that carries
 *   250,000 ($0.05).
 *   A subagent: a call that carries 400,000 tokens ($0.08).
 * The part above 200,000 tokens: 4/6 of $0.12, 1/5 of $0.05 and 2/4 of $0.08, so $0.13.
 * Above 300,000: 3/6 of $0.12 and 1/4 of $0.08, so $0.08. Above 500,000: 1/6 of $0.12, so $0.02.
 * All six calls together cost $0.45.
 */
const carried = () => [
  record(600000, START), record(600000, START + MIN), record(250000, START + 2 * MIN),
  ...[START, START + MIN].map((ts) => record(400000, ts, { f: '/logs/work-repo/main/subagents/agent-a1.jsonl', agent: 'agent-a1' })),
]
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`)

test('the replay gives the saving of an earlier automatic point for 200,000, 300,000 and 500,000 tokens, and the old proposal is gone', () => {
  const p = proposals(carried())
  near(p.total, 0.45)
  const found = p.list.find((x) => x.id === 'autocompact-window')
  // The amount of the proposal is the one for 300,000 tokens: that is the point it asks for.
  near(found.saving, 0.08)
  assert.equal(found.title, 'Compact the context earlier, at 300k tokens')
  assert.equal(found.evidence, '2 calls of Claude Code carried more than 300k tokens. The part above that cost $0.08: $0.02 in subagents and $0.06 in main sessions. The same count for three points: $0.13 less at 200k tokens, $0.08 less at 300k tokens, $0.02 less at 500k tokens.')
  assert.equal(found.how, 'One setting in Claude Code: "autoCompactWindow": 300000. Claude Code then compacts a context on its own when it reaches that many tokens. Without the setting it does so only at the limit of the model.')
  // The text says what the amount rests on, that nobody has measured it, and to measure after the change.
  assert.equal(found.risk, 'The amount assumes that the work goes on the same with a smaller context. Nobody has measured that. A summary loses detail, and work that misses the detail can take more calls. So measure the change after it is applied: widal measure autocompact-window')
  assert.deepEqual([found.apply, found.args, found.action], [true, '--tokens 300000', undefined])
  // The proposal about a long context under its old name is gone.
  assert.equal(p.list.filter((x) => x.id === 'autocompact-window').length, 1)
  assert.equal(p.list.some((x) => x.id === 'long-context'), false)
  const text = adviseReport(carried(), { days: 30 })
  assert.doesNotMatch(text, /long-context|Keep the context under/)
  // The five lines of the proposal in the report: its title, why, how, the risk and the command.
  const block = (report) => {
    const lines = report.split('\n')
    const from = lines.findIndex((l) => /^\d+\. Compact the context earlier/.test(l))
    return lines.slice(from, from + 5)
  }
  assert.deepEqual(block(text), [
    `${p.list.indexOf(found) + 1}. Compact the context earlier, at 300k tokens: $0.08 less, 18% of the total`,
    `   Why:  ${found.evidence}`,
    `   How:  ${found.how}`,
    `   Risk: ${found.risk}`,
    '   Apply: widal apply autocompact-window --tokens 300000',
  ])
  assert.doesNotMatch(text, /[\u2013\u2014]/)
  // Once it is applied, the proposal names the measure and the undo.
  const applied = adviseReport(carried(), { days: 30, applied: { 'autocompact-window': { at: START, before: { tokens: 300000 } } } })
  assert.equal(block(applied)[4], `   Applied on ${day(START)}. See: widal measure autocompact-window. Take it back: widal undo autocompact-window`)
})

test('the replay of an earlier automatic point counts Claude Code\'s calls only, at each point from the first token above it', () => {
  const point = (records) => proposals(records).list.find((x) => x.id === 'autocompact-window')
  // A context of exactly 300,000 tokens has nothing above the point. One token more has.
  const exact = [record(300000, START), record(300000, START + MIN)]
  assert.equal(point(exact), undefined)
  // 400,000 tokens carried: $0.08, of which a quarter is above 300,000 and half above 200,000.
  const one = point([record(400000, START), record(400000, START + MIN)])
  near(one.saving, 0.02)
  assert.match(one.evidence, /^1 calls of Claude Code carried more than 300k tokens\. .* \$0\.04 less at 200k tokens, \$0\.02 less at 300k tokens, \$0\.00 less at 500k tokens\.$/)
  // The same calls in a log of Codex or of Cowork: the setting does not reach them.
  for (const s of ['codex', 'cowork']) assert.equal(point([record(400000, START, { s }), record(400000, START + MIN, { s })]), undefined, s)
  // Next to calls of Claude Code they add to the total, and not to the amount.
  const mixed = point([record(400000, START), record(400000, START + MIN), record(400000, START, { s: 'cowork', f: '/cowork/x.jsonl', ses: 'x' }), record(400000, START + MIN, { s: 'cowork', f: '/cowork/x.jsonl', ses: 'x' })])
  near(mixed.saving, 0.02)
})

const SETTINGS_KEY = 'autoCompactWindow'

test('"apply autocompact-window" sets the size at which Claude Code compacts on its own: 300000, or the one that --tokens names', () => {
  freshHome()
  const OTHER = { model: 'claude-fable-5-2', hooks: { Stop: [{ hooks: [{ type: 'command', command: '/bin/other-tool stop' }] }] } }
  writeFileSync(SETTINGS(), JSON.stringify(OTHER))
  const apply = (...args) => applyAction('autocompact-window', OWN, START, args)
  // Without --tokens it is 300,000.
  assert.deepEqual(apply(), [
    'Set "autoCompactWindow" to 300000 in Claude Code\'s settings. Claude Code compacts a context on its own when it reaches that many tokens.',
    ACTIONS['autocompact-window'].note,
    'Take it back with: widal undo autocompact-window',
  ])
  assert.match(ACTIONS['autocompact-window'].note, /Nobody has measured whether the work goes on the same with a smaller context\. .* Check the effect with: widal measure autocompact-window$/)
  assert.deepEqual(settings(), { ...OTHER, [SETTINGS_KEY]: 300000 })
  assert.deepEqual(appliedActions(), { 'autocompact-window': { at: START, before: { tokens: 300000 } } })
  assert.equal(readdirSync(join(process.env.WIDAL_HOME, 'backup')).length, 1)
  assert.deepEqual(apply(), ['autocompact-window is already applied.'])
  assert.deepEqual(apply('--tokens', '300000'), ['autocompact-window is already applied.'])
  // With --tokens: another size. What was there before the first apply is still kept.
  assert.match(apply('--tokens', '500000')[0], /^Set "autoCompactWindow" to 500000 in Claude Code's settings\./)
  assert.deepEqual(settings(), { ...OTHER, [SETTINGS_KEY]: 500000 })
  assert.deepEqual(appliedActions()['autocompact-window'].before, { tokens: 500000 })
  // The undo takes the key out again, because there was none before.
  assert.deepEqual(undoAction('autocompact-window', OWN), ['autocompact-window is taken back. Claude Code\'s settings are as they were before it.'])
  assert.deepEqual(settings(), OTHER)
  assert.deepEqual(appliedActions(), {})
})

test('--tokens is a whole number from 100000 to 1000000, and any other value changes nothing', () => {
  freshHome()
  const apply = (tokens) => applyAction('autocompact-window', OWN, START, ['--tokens', tokens])
  // The two bounds are taken.
  for (const tokens of ['100000', '1000000']) {
    assert.match(apply(tokens)[0], new RegExp(`^Set "autoCompactWindow" to ${tokens} in`))
    assert.equal(settings()[SETTINGS_KEY], Number(tokens))
  }
  undoAction('autocompact-window', OWN)
  assert.deepEqual(settings(), {})
  // One step outside each bound, and what is no whole number.
  for (const bad of ['99999', '1000001', '0', '-300000', '300000.5', '3e5', '300k', 'many', '', ' 300000']) {
    assert.throws(() => apply(bad), { message: '--tokens is a whole number from 100000 to 1000000.' }, bad)
    assert.deepEqual(settings(), {}, bad)
    assert.deepEqual(appliedActions(), {}, bad)
  }
  assert.throws(() => applyAction('autocompact-window', OWN, START, ['--tokens']), { message: '--tokens needs a value after it.' })
  assert.throws(() => applyAction('autocompact-window', OWN, START, ['--size', '300000']), { message: 'autocompact-window does not take "--size". It takes: --tokens <value>' })
  assert.deepEqual(settings(), {})
  // The command says the same, and ends with exit code 1.
  const { env, run } = command('window-bounds')
  const bad = run(['apply', 'autocompact-window', '--tokens', '99999'])
  assert.deepEqual([bad.status, bad.stdout, bad.stderr], [1, '', 'widal: --tokens is a whole number from 100000 to 1000000.\n'])
  const good = run(['apply', 'autocompact-window', '--tokens', '400000'])
  assert.equal(good.status, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')), { [SETTINGS_KEY]: 400000 })
  assert.match(run(['doctor']).stdout, /^Change: autocompact-window +applied on \d{4}-\d\d-\d\d$/m)
  assert.match(run(['apply']).stdout, /^ {2}autocompact-window\n {4}Sets "autoCompactWindow" in Claude Code's settings: /m)
})

test('"undo autocompact-window" puts back the value that was there, and leaves a value alone that was changed after the apply', () => {
  freshHome()
  // An earlier value, set by hand.
  writeFileSync(SETTINGS(), JSON.stringify({ [SETTINGS_KEY]: 800000, model: 'claude-fable-5-2' }))
  applyAction('autocompact-window', OWN, START)
  assert.deepEqual(settings(), { [SETTINGS_KEY]: 300000, model: 'claude-fable-5-2' })
  assert.deepEqual(appliedActions()['autocompact-window'].before, { value: 800000, tokens: 300000 })
  // Applied again with another size: the undo still goes back to the first value.
  applyAction('autocompact-window', OWN, START, ['--tokens', '200000'])
  undoAction('autocompact-window', OWN)
  assert.deepEqual(settings(), { [SETTINGS_KEY]: 800000, model: 'claude-fable-5-2' })

  // The person changes the value after the apply: it is theirs, and the undo says so.
  applyAction('autocompact-window', OWN, START)
  writeFileSync(SETTINGS(), JSON.stringify({ [SETTINGS_KEY]: 450000, model: 'claude-fable-5-2' }))
  assert.match(actionsStatus().find(([id]) => id === 'autocompact-window')[1], /, but no longer in the settings$/)
  assert.deepEqual(undoAction('autocompact-window', OWN), [
    'autocompact-window is taken back, except for one setting.',
    '"autoCompactWindow" in Claude Code\'s settings was not put back, because it was changed after this tool set it: it is 450000 now, and it was 800000 before the change.',
  ])
  assert.deepEqual(settings(), { [SETTINGS_KEY]: 450000, model: 'claude-fable-5-2' })
  // The value was already 300,000 before the apply: nothing is written, and the undo leaves it.
  freshHome()
  writeFileSync(SETTINGS(), JSON.stringify({ [SETTINGS_KEY]: 300000 }))
  applyAction('autocompact-window', OWN, START)
  assert.throws(() => readdirSync(join(process.env.WIDAL_HOME, 'backup')), { code: 'ENOENT' })
  undoAction('autocompact-window', OWN)
  assert.deepEqual(settings(), { [SETTINGS_KEY]: 300000 })
})

const SIGNS = 'These are signs, not proof. The work before and after is not the same work, and no measure shows for sure that a change was right.'

test('"measure autocompact-window" compares the compactions per session, the size before a compaction and the carrying cost of main sessions', () => {
  const AT = START + 20 * DAY
  // One compaction of a main session, as the parser keeps it.
  const compaction = (ses, ts, pre, more = {}) => ({ ts, trigger: 'auto', pre, post: 30000, sec: 60, ses, cwd: '/work/repo', ...more })
  const session = (ses, ts, sizes) => sizes.map((read, i) => record(read, ts + i * MIN, { f: `/logs/work-repo/${ses}.jsonl`, ses }))
  const records = [
    // Before: one session of three calls. The second call carries 800,000 tokens ($0.16) and the
    // third 600,000 ($0.12): $0.28 for 3 calls, so $93.33 per 1,000 calls.
    ...session('before-1', AT - DAY, [800000, 800000, 600000]),
    // After: two sessions of two calls. Each second call carries 300,000 tokens ($0.06): $0.12
    // for 4 calls, so $30.00 per 1,000 calls.
    ...session('after-1', AT + DAY, [300000, 300000]),
    ...session('after-2', AT + 2 * DAY, [300000, 300000]),
    // A subagent, a call of Codex and a call from more than 14 days before the change do not count.
    record(900000, AT + DAY, { f: '/logs/work-repo/after-1/subagents/agent-a1.jsonl', ses: 'after-1', agent: 'agent-a1' }),
    record(900000, AT + DAY, { s: 'codex', f: '/codex/rollout.jsonl', ses: 'codex-1' }),
    ...session('long-ago', AT - 15 * DAY, [900000, 900000]),
  ]
  const metas = new Map([
    // Before: two compactions in the one session, at 800,000 and 600,000 tokens. The median is 700,000.
    ['/logs/work-repo/before-1.jsonl', { compactions: [compaction('before-1', AT - DAY, 800000), compaction('before-1', AT - 1, 600000)] }],
    // After: three compactions in two sessions, at 290,000, 300,000 and 310,000 tokens. The first is at the time of the change itself.
    ['/logs/work-repo/after-1.jsonl', { compactions: [compaction('after-1', AT, 310000), compaction('after-1', AT + DAY, 290000, { trigger: 'manual' })] }],
    ['/logs/work-repo/after-2.jsonl', { compactions: [compaction('after-2', AT + 2 * DAY, 300000)] }],
    // Not counted: the compaction of a subagent, and one from more than 14 days before the change.
    ['/logs/work-repo/after-1/subagents/agent-a1.jsonl', { compactions: [compaction('after-1', AT + DAY, 950000, { agent: 'agent-a1' })] }],
    ['/logs/work-repo/long-ago.jsonl', { compactions: [compaction('long-ago', AT - 14 * DAY - 1, 990000)] }],
    ['/codex/rollout.jsonl', { limits: {} }],
  ])
  const lines = measureReport(records, { id: 'autocompact-window', at: AT, before: { tokens: 300000 }, metas }).split('\n')
  const cells = (name) => lines.find((l) => l.startsWith(name)).split(/ {2,}/)
  assert.equal(lines[0], `autocompact-window, applied on ${when(AT)}. Main session calls before and after.`)
  assert.deepEqual(lines[2].trim().split(/ {2,}/), ['before', 'after'])
  assert.deepEqual(lines.slice(3, 7).map((l) => l.split(/ {2,}/)), [
    ['Compactions', '2', '3'],
    ['Compactions, per session', '2.0', '1.5'],
    ['Size before a compaction, median', '700k tokens', '300k tokens'],
    ['Carrying cost, per 1,000 calls', '$93.33', '$30.00'],
  ])
  assert.equal(lines[8], 'An earlier automatic point shows as more compactions per session, a smaller size before a compaction and a lower carrying cost. The work before and after is not the same work, so read these lines with care.')
  assert.equal(lines[10], 'The same calls: what they cost, and signs of how the work went.')
  // Then the lines that every measure has, for the same calls.
  assert.deepEqual(cells('Calls  '), ['Calls', '3', '4'])
  assert.deepEqual(cells('Sessions'), ['Sessions', '1', '2'])
  assert.deepEqual(cells('Tool errors, per 1,000 calls'), ['Tool errors, per 1,000 calls', '0.0', '0.0'])
  assert.deepEqual(cells('Interrupts by you, per 1,000 calls'), ['Interrupts by you, per 1,000 calls', '0.0', '0.0'])
  assert.deepEqual(lines.slice(-2), ['Too early to judge.', SIGNS])
  assert.doesNotMatch(lines.join('\n'), /[\u2013\u2014]/)

  // Without a compaction on a side: "none" for its size, and a sentence when there is none after the change.
  const none = measureReport(records, { id: 'autocompact-window', at: AT, before: {}, metas: new Map() }).split('\n')
  assert.deepEqual(none.slice(3, 7).map((l) => l.split(/ {2,}/)), [
    ['Compactions', '0', '0'],
    ['Compactions, per session', '0.0', '0.0'],
    ['Size before a compaction, median', 'none', 'none'],
    ['Carrying cost, per 1,000 calls', '$93.33', '$30.00'],
  ])
  assert.equal(none[8], 'No main session was compacted since the change. Look again after a few days of normal work.')
  // No metas at all, as an older caller gives: the same.
  assert.equal(measureReport(records, { id: 'autocompact-window', at: AT, before: {} }).split('\n')[8], none[8])
  // Another change does not get these lines.
  assert.doesNotMatch(measureReport(records, { id: 'effort-default', at: AT, before: {}, metas }), /Compactions|Carrying cost/)
})

test('"widal measure autocompact-window" reads the calls and the compactions from the logs', () => {
  const { env, run } = command('window-measure')
  assert.equal(run(['measure', 'autocompact-window']).stdout, 'autocompact-window is not applied. Apply it with: widal apply autocompact-window\n')
  // The change was applied 3 days ago. One session before it and one after it, each with a compaction.
  const at = Date.now() - 3 * DAY
  const project = join(env.CLAUDE_CONFIG_DIR, 'projects', 'work-repo')
  mkdirSync(project, { recursive: true })
  const log = (name, ts, pre) => writeFileSync(join(project, `${name}.jsonl`), `${[call(ts), call(ts + MIN), boundary(ts + 2 * MIN, facts('auto', pre, 30000, 60)), call(ts + 3 * MIN)].join('\n')}\n`)
  log('before', at - DAY, 800000)
  log('after', at + DAY, 300000)
  mkdirSync(env.WIDAL_HOME, { recursive: true })
  writeFileSync(join(env.WIDAL_HOME, 'actions.json'), JSON.stringify({ 'autocompact-window': { at, before: { tokens: 300000 } } }))
  const r = run(['measure', 'autocompact-window'])
  assert.deepEqual([r.status, r.stderr], [0, ''])
  const lines = r.stdout.split('\n')
  assert.match(lines[0], /^autocompact-window, applied on \d{4}-\d\d-\d\d \d\d:\d\d\. Main session calls before and after\.$/)
  assert.deepEqual(lines.slice(3, 6).map((l) => l.split(/ {2,}/)), [
    ['Compactions', '1', '1'],
    ['Compactions, per session', '1.0', '1.0'],
    ['Size before a compaction, median', '800k tokens', '300k tokens'],
  ])
  assert.match(lines[6], /^Carrying cost, per 1,000 calls {2,}\$\d+\.\d\d {2,}\$\d+\.\d\d$/)
  assert.match(r.stdout, /^Calls {2,}3 {2,}3$/m)
  assert.ok(r.stdout.endsWith(`\nToo early to judge.\n${SIGNS}\n`))
})

// The hint to compact, at the end of the status line. These tests run the status line with
// made-up input, and with made-up logs for the sign that a task ended.
const NOW = Date.parse('2026-11-12T12:00:00')
const HOUR = 3600e3
/** A time as Claude Code gives it: in seconds. */
const sec = (ms) => Math.round(ms / 1000)

/**
 * What Claude Code gives the status line of a subscriber: a session with `ctx` tokens of
 * context in a window of 1,000,000 tokens. `api` is the time that the session has spent on
 * model calls so far: a run with another `api` than the run before comes after a model call.
 * The input names no effort level, so the hint about the effort level stays out of the way.
 */
const given = (ctx, api = 1000, extra = {}) => ({
  session_id: 'one', cwd: '/work/repo', model: { id: 'claude-fable-5-2', display_name: 'Fable 5.2' },
  cost: { total_cost_usd: 12.4, total_duration_ms: 4 * HOUR, total_api_duration_ms: api },
  context_window: { context_window_size: 1000000, current_usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: ctx } },
  rate_limits: { seven_day: { used_percentage: 36, resets_at: sec(NOW + 3 * DAY) } },
  ...extra,
})
/** The status line without colours and with an empty environment. */
const line = (input, now = NOW, opts = {}) => statusLine(input, now, { env: {}, color: false, notify: () => {}, layout: 'one', ...opts })
const sessionFile = (id) => join(process.env.WIDAL_HOME, 'sessions', `${id}.json`)
/** What the status line keeps about one session. */
const kept = (id = 'one') => JSON.parse(readFileSync(sessionFile(id), 'utf8'))
/** Changes fields of what is kept about one session. */
const keep = (change, id = 'one') => writeFileSync(sessionFile(id), JSON.stringify({ ...kept(id), ...change }))
/** The two sizes of the context that are kept for the hint: the size after the last compaction, and the last size seen. */
const sizes = (id = 'one') => [kept(id).compactBase, kept(id).ctxSeen]
/** The hint to compact of a line: its last part when that names /compact, else undefined. */
const hintOf = (shown) => (/\/compact/.test(shown.split(' | ').at(-1)) ? shown.split(' | ').at(-1) : undefined)
/** The text of every file in this tool's folder. */
const filesText = () => readdirSync(process.env.WIDAL_HOME, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile())
  .map((f) => readFileSync(join(f.parentPath ?? f.path, f.name), 'utf8'))
  .join('\n')

/**
 * The line of a session at a break in its work. The status line saw the session first 2 minutes
 * ago with `base` tokens, a model call 1 minute ago left `ctx` tokens, and nothing happened
 * since. `extra` changes what Claude Code gives in all three runs.
 */
function idle(base, ctx, extra = {}) {
  freshHome()
  line(given(base, 1000, extra), NOW - 2 * MIN)
  line(given(ctx, 2000, extra), NOW - MIN)
  return line(given(ctx, 2000, extra), NOW)
}
const NEAR = 'automatic compaction is near: /compact now to choose what stays'
const grown = (size) => `context ${size}: a good moment to /compact`
const ended = (size) => `a task just ended and the context is ${size}: a good moment to /compact`

let logs = 0
/** Writes a made-up session log and gives its path. A line is an object, or text that is written as it is. */
const logOf = (lines, file = join(dir, `log-${++logs}.jsonl`)) => {
  writeFileSync(file, `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`)
  return file
}
let uses = 0
/**
 * The lines that Claude Code writes for one model call that used one tool: the call, and the
 * result of the tool. `at` is the time of the call, 2 minutes before NOW unless it is given.
 * `failed` marks the result as an error. Every text in these lines has "private" or "someone"
 * in it, because none of it may leave the log.
 */
const toolCall = (name, input, { at = NOW - 2 * MIN, failed = false } = {}) => {
  const id = `toolu_${++uses}`
  return [
    {
      type: 'assistant', timestamp: new Date(at).toISOString(), cwd: '/home/someone/private-folder', gitBranch: 'private-branch',
      message: { id: `msg_${uses}`, model: 'claude-fable-5-2', role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 3, cache_read_input_tokens: 90000, output_tokens: 200 } },
    },
    { type: 'user', timestamp: new Date(at + 1000).toISOString(), cwd: '/home/someone/private-folder', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'a private result', ...(failed ? { is_error: true } : {}) }] } },
  ]
}
/** A model call that ran a shell command. */
const shell = (command, more) => toolCall('Bash', { command, description: 'a private description' }, more)
/** A model call that wrote the whole task list, with one task per status. */
const todos = (statuses, more) => toolCall('TodoWrite', { todos: statuses.map((status) => ({ content: 'a private task', status, activeForm: 'a private form' })) }, more)
const taskNew = (more) => toolCall('TaskCreate', { subject: 'a private task', description: 'a private description', activeForm: 'a private form' }, more)
const taskSet = (status, more) => toolCall('TaskUpdate', { taskId: 'private-id', status, subject: 'a private task' }, more)
const COMMIT = 'git commit -m "a private message"'
/** The line that Claude Code writes for a compaction. */
const compacted = (at = NOW - 2 * MIN) => ({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(at).toISOString(), compactMetadata: facts('auto', 366000, 31000, 95) })

/**
 * The hint of a session at a break whose log has these lines. Its context has 400,000 tokens
 * and had 390,000 at first sight, so it did not grow much and the automatic compaction is far:
 * only a task that just ended can give a hint.
 */
const taskHint = (lines) => hintOf(idle(390000, 400000, { transcript_path: logOf(lines.flat()) }))

test('the context grew by 150,000 tokens since it was first seen: a hint at a break, as the last part of the line', () => {
  // The bound, and one token on each side.
  assert.equal(hintOf(idle(100000, 249999)), undefined)
  assert.equal(hintOf(idle(100000, 250000)), grown('250k'))
  assert.equal(hintOf(idle(100000, 250001)), grown('250k'))
  assert.equal(idle(100000, 420000), 'week 36% used, 57% of the week gone | context 420k | context 420k: a good moment to /compact')
  // The hint has no colour.
  freshHome()
  line(given(100000, 1000), NOW - 2 * MIN)
  line(given(420000, 2000), NOW - MIN)
  assert.ok(line(given(420000, 2000), NOW, { color: true }).endsWith(' | context 420k: a good moment to /compact'))
  // When it came is kept. Nothing of the log was looked at: the input names none.
  assert.deepEqual(kept().compactHint, { at: NOW })
  // It comes after the hint about the effort level, which is tested in statusline.test.mjs.
  // A context that is large and did not grow gets no hint.
  assert.equal(hintOf(idle(527119, 527119)), undefined)
  assert.equal(kept().compactHint, undefined)
})

test('the automatic compaction is near: a yellow hint from 100,000 tokens before 96.7% of the window', () => {
  // The window has 1,000,000 tokens, so Claude Code compacts at 967,000. Near is from 867,000 on.
  assert.equal(hintOf(idle(800000, 866999)), undefined)
  assert.equal(hintOf(idle(800000, 867000)), NEAR)
  assert.equal(hintOf(idle(800000, 867001)), NEAR)
  // Also at the point and above it.
  assert.equal(hintOf(idle(960000, 967000)), NEAR)
  assert.equal(hintOf(idle(960000, 990000)), NEAR)
  // The hint is yellow.
  freshHome()
  line(given(800000, 1000), NOW - 2 * MIN)
  line(given(900000, 2000), NOW - MIN)
  assert.ok(line(given(900000, 2000), NOW, { color: true }).endsWith(` | \x1b[33m${NEAR}\x1b[0m`))
  // A smaller window: 96.7% of 200,000 tokens is 193,400, and near is from 93,400 on.
  const small = (ctx) => hintOf(idle(50000, ctx, { context_window: { context_window_size: 200000, current_usage: { cache_read_input_tokens: ctx } } }))
  assert.equal(small(93399), undefined)
  assert.equal(small(93400), NEAR)
  // Without the size of the window the point is not known.
  assert.equal(hintOf(idle(800000, 900000, { context_window: { current_usage: { cache_read_input_tokens: 900000 } } })), undefined)
})

test('the point of the automatic compaction is "autoCompactWindow" from Claude Code\'s settings when that is set and not above the window', () => {
  // The function on its own: the setting, else 96.7% of the window.
  assert.equal(autoCompactPoint(1000000, undefined), 967000)
  assert.equal(autoCompactPoint(200000, undefined), 193400)
  assert.equal(autoCompactPoint(1000000, 300000), 300000)
  // Not above the window: a setting of the window's size counts, and one token more does not.
  assert.equal(autoCompactPoint(500000, 500000), 500000)
  assert.equal(autoCompactPoint(500000, 500001), 483500)
  assert.equal(autoCompactPoint(200000, 300000), 193400)
  // The two bounds that Claude Code takes for the setting, and one step outside each.
  assert.deepEqual([99999, 100000, 1000000, 1000001].map((set) => autoCompactPoint(1000000, set)), [967000, 100000, 1000000, 967000])
  // A value that is no whole number is not a setting.
  for (const set of ['300000', 300000.5, null, true, {}, [300000], NaN, -300000]) assert.equal(autoCompactPoint(1000000, set), 967000, JSON.stringify(set))
  // Without the size of the window: the setting, or nothing.
  assert.equal(autoCompactPoint(undefined, 300000), 300000)
  assert.equal(autoCompactPoint(undefined, undefined), undefined)
  assert.equal(autoCompactPoint(0, undefined), undefined)

  // Through the status line: with the point at 300,000 tokens, near is from 200,000 on.
  const withSetting = (settings, base, ctx) => {
    freshHome()
    writeFileSync(SETTINGS(), typeof settings === 'string' ? settings : JSON.stringify(settings))
    line(given(base, 1000), NOW - 2 * MIN)
    line(given(ctx, 2000), NOW - MIN)
    return hintOf(line(given(ctx, 2000), NOW))
  }
  assert.equal(withSetting({ autoCompactWindow: 300000 }, 150000, 199999), undefined)
  assert.equal(withSetting({ autoCompactWindow: 300000 }, 150000, 200000), NEAR)
  assert.equal(withSetting({ autoCompactWindow: 300000 }, 290000, 350000), NEAR)
  // A setting of the window's size moves the point up: near is then from 900,000 on.
  assert.equal(withSetting({ autoCompactWindow: 1000000 }, 800000, 899999), undefined)
  assert.equal(withSetting({ autoCompactWindow: 1000000 }, 800000, 900000), NEAR)
  // The action of this tool sets it, and the status line then goes by it.
  freshHome()
  applyAction('autocompact-window', OWN, NOW, ['--tokens', '400000'])
  line(given(250000, 1000), NOW - 2 * MIN)
  line(given(300000, 2000), NOW - MIN)
  assert.equal(hintOf(line(given(300000, 2000), NOW)), NEAR)
  // Settings that are broken, or that hold another value, leave the point at 96.7% of the window.
  for (const settings of ['not JSON', '[]', { autoCompactWindow: '300000' }, { autoCompactWindow: 50000 }, { other: 300000 }]) {
    assert.equal(withSetting(settings, 800000, 866999), undefined, JSON.stringify(settings))
    assert.equal(withSetting(settings, 800000, 867000), NEAR, JSON.stringify(settings))
  }
})

test('a task just ended and the context has 150,000 tokens or more: a hint that says so', () => {
  const log = logOf(shell(COMMIT))
  // The bound, and one token on each side. The context was first seen with 140,000 tokens.
  assert.equal(hintOf(idle(140000, 149999, { transcript_path: log })), undefined)
  // Under the bound the log is not looked at.
  assert.equal(kept().compactHint, undefined)
  assert.equal(hintOf(idle(140000, 150000, { transcript_path: log })), ended('150k'))
  assert.equal(hintOf(idle(140000, 150001, { transcript_path: log })), ended('150k'))
  assert.equal(idle(390000, 400000, { transcript_path: log }), 'week 36% used, 57% of the week gone | context 400k | a task just ended and the context is 400k: a good moment to /compact')
  // When the hint came, when the log was looked at, and the time of the sign are kept.
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW, task: NOW - 2 * MIN })
  // It has no colour.
  line(given(390000, 3000, { session_id: 'two' }), NOW - 2 * MIN)
  line(given(400000, 4000, { session_id: 'two' }), NOW - MIN)
  assert.ok(line(given(400000, 4000, { session_id: 'two', transcript_path: log }), NOW, { color: true }).endsWith(` | ${ended('400k')}`))
  // Without a log, with a log that is missing, and with one that has no sign, there is no hint.
  assert.equal(hintOf(idle(390000, 400000)), undefined)
  assert.equal(hintOf(idle(390000, 400000, { transcript_path: join(dir, 'no-such-log.jsonl') })), undefined)
  assert.deepEqual(kept().compactHint, { look: NOW })
  assert.equal(taskHint([shell('npm test')]), undefined)
  assert.deepEqual(kept().compactHint, { look: NOW })
  for (const path of [undefined, null, '', 7, { a: 1 }]) {
    assert.equal(hintOf(idle(390000, 400000, { transcript_path: path })), undefined, JSON.stringify(path))
    assert.equal(kept().compactHint, undefined, JSON.stringify(path))
  }
})

test('each of the four shell commands is a sign that a task ended, and a command that only holds the words later is none', () => {
  for (const command of [
    COMMIT, 'git push origin private-branch', 'gh pr create --title "a private title"', 'gh pr merge 12 --squash',
    // The command alone, with spaces in front, and with more than one space or a line break between its words.
    'git commit', 'git push', 'gh pr create', 'gh pr merge', '  git commit -m private', 'git   push', 'gh  pr\tmerge 12', 'git commit\n-m private',
  ]) assert.equal(taskHint([shell(command)]), ended('400k'), command)

  for (const command of [
    // The words come later in the line.
    'cd /home/someone/private-folder && git commit -m private', 'echo "git commit"', 'sleep 5; git push', 'npm test && gh pr create', 'echo done # gh pr merge',
    'sudo git push', 'env GIT_PAGER=cat git commit', '(git commit)', 'time git push',
    // Other commands that begin alike.
    'git commit-tree private', 'git committed', 'git pushed', 'git push-private', 'gh pr created', 'gh pr merged', 'gh pr list', 'gh pr view 12', 'gh pr', 'git', 'git status', 'git log --grep "git commit"',
    'gitcommit', 'ghpr create', 'GIT COMMIT', 'Git push', 'git -C /home/someone/private-folder commit', 'gh repo create private',
  ]) assert.equal(taskHint([shell(command)]), undefined, command)

  // Only the shell tool of Claude Code counts, and only a command that is text.
  assert.equal(taskHint([toolCall('mcp__private_server__shell', { command: COMMIT })]), undefined)
  assert.equal(taskHint([toolCall('Read', { command: COMMIT, file_path: '/home/someone/private-file' })]), undefined)
  for (const input of [undefined, null, {}, { command: 7 }, { command: [COMMIT] }, { cmd: COMMIT }, 'git commit']) assert.equal(taskHint([toolCall('Bash', input)]), undefined, JSON.stringify(input))
  // A command that failed did not end a task. The same command that then went through did.
  assert.equal(taskHint([shell(COMMIT, { failed: true })]), undefined)
  assert.equal(taskHint([shell(COMMIT, { failed: true }), shell('npm test'), shell(COMMIT)]), ended('400k'))
  assert.equal(taskHint([shell('git push'), shell('npm test', { failed: true })]), ended('400k'))
  // More work after the sign does not take it away: the end of the log still shows it.
  assert.equal(taskHint([shell(COMMIT), shell('npm test'), toolCall('Read', { file_path: '/home/someone/private-file' })]), ended('400k'))
  // Only what comes after the last compaction counts.
  assert.equal(taskHint([shell(COMMIT), compacted()]), undefined)
  assert.equal(taskHint([shell(COMMIT), compacted(), shell('npm test')]), undefined)
  assert.equal(taskHint([shell(COMMIT), compacted(), shell('git push')]), ended('400k'))
  // Lines that are broken or that are no model call are passed over.
  assert.equal(taskHint([['not JSON', 'null', '[]', '{"type":"assistant"}', '{"type":"assistant","message":{"id":"x","content":[{"type":"tool_use","name":"Bash"}]}}'], shell(COMMIT), ['{"type":"assistant","message":{"id":"cut","content":[{"type":"tool_use","name":"Bash","input":{"command":"git comm']]), ended('400k'))
  // A sign whose line has no time that can be read still counts.
  const [use, result] = shell(COMMIT)
  for (const timestamp of [undefined, 'soon', 7]) assert.equal(taskHint([{ ...use, timestamp }, result]), ended('400k'), String(timestamp))
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW, task: 0 })
})

test('a task list whose newest call shows every task as completed is a sign that a task ended, and one with an open task is none', () => {
  // The list as a whole.
  assert.equal(taskHint([todos(['completed', 'completed', 'completed'])]), ended('400k'))
  assert.equal(taskHint([todos(['completed'])]), ended('400k'))
  for (const open of ['in_progress', 'pending', 'blocked', undefined, 7]) assert.equal(taskHint([todos(['completed', open, 'completed'])]), undefined, String(open))
  assert.equal(taskHint([todos([])]), undefined)
  for (const input of [undefined, {}, { todos: 'completed' }, { todos: [null] }, { todos: ['completed'] }]) assert.equal(taskHint([toolCall('TodoWrite', input)]), undefined, JSON.stringify(input))
  // The newest call decides.
  assert.equal(taskHint([todos(['completed', 'completed']), todos(['completed', 'completed', 'pending'])]), undefined)
  assert.equal(taskHint([todos(['completed', 'in_progress']), todos(['completed', 'completed'])]), ended('400k'))
  // A commit before the newest call still counts: either sign is enough.
  assert.equal(taskHint([shell(COMMIT), todos(['completed', 'pending'])]), ended('400k'))

  // Single tasks: each new task is open, and each update says whether one task is open or done.
  assert.equal(taskHint([taskNew(), taskNew(), taskSet('in_progress'), taskSet('completed')]), undefined)
  assert.equal(taskHint([taskNew(), taskNew(), taskSet('in_progress'), taskSet('completed'), taskSet('in_progress'), taskSet('completed')]), ended('400k'))
  assert.equal(taskHint([taskNew(), taskSet('completed')]), ended('400k'))
  assert.equal(taskHint([taskNew()]), undefined)
  assert.equal(taskHint([taskNew(), taskSet('in_progress')]), undefined)
  // A task from before this piece of the log is known once an update names its status.
  assert.equal(taskHint([taskSet('in_progress')]), undefined)
  assert.equal(taskHint([taskSet('pending')]), undefined)
  assert.equal(taskHint([taskSet('in_progress'), taskSet('completed')]), ended('400k'))
  assert.equal(taskHint([taskSet('completed')]), ended('400k'))
  // A new task after all were done: the list has an open task again.
  assert.equal(taskHint([taskNew(), taskSet('completed'), taskNew()]), undefined)
  // A task that was deleted is no longer open, and a deletion alone is no sign.
  assert.equal(taskHint([taskNew(), taskNew(), taskSet('deleted'), taskSet('completed')]), ended('400k'))
  assert.equal(taskHint([taskNew(), taskSet('deleted')]), undefined)
  // An update without a status says nothing about the list.
  assert.equal(taskHint([taskNew(), taskSet('completed'), taskSet(undefined)]), ended('400k'))
  assert.equal(taskHint([taskNew(), taskSet(undefined)]), undefined)
  // A log that holds the line of a tool call twice: the new task is counted once.
  const twice = taskNew()
  assert.equal(taskHint([twice, twice[0], taskSet('completed')]), ended('400k'))
  // A list from before a compaction does not count.
  assert.equal(taskHint([todos(['completed']), compacted()]), undefined)
  assert.equal(taskHint([taskNew(), compacted(), taskSet('completed')]), ended('400k'))
})

test('the first rule that holds gives the hint: the automatic compaction, then a task that ended, then the growth', () => {
  const log = logOf(shell(COMMIT))
  const quietLog = logOf(shell('npm test'))
  // All three hold: 900,000 tokens, a task that ended, and a growth of 800,000 tokens.
  assert.equal(hintOf(idle(100000, 900000, { transcript_path: log })), NEAR)
  // The log is not looked at when the first rule holds.
  assert.deepEqual(kept().compactHint, { at: NOW })
  // The second and the third hold.
  assert.equal(hintOf(idle(100000, 400000, { transcript_path: log })), ended('400k'))
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW, task: NOW - 2 * MIN })
  // Only the third holds: no log, or a log without a sign.
  assert.equal(hintOf(idle(100000, 400000)), grown('400k'))
  assert.deepEqual(kept().compactHint, { at: NOW })
  assert.equal(hintOf(idle(100000, 400000, { transcript_path: quietLog })), grown('400k'))
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW })
  // The first and the third hold.
  assert.equal(hintOf(idle(100000, 900000, { transcript_path: quietLog })), NEAR)
  // None holds.
  assert.equal(hintOf(idle(390000, 400000, { transcript_path: quietLog })), undefined)
  // At most one of them is on the line.
  assert.equal(idle(100000, 900000, { transcript_path: log }).split(' | ').filter((part) => /\/compact/.test(part)).length, 1)
})

test('a hint comes only while the session is quiet: no model call for 60 seconds', () => {
  /** The hint at NOW of a session whose last model call was `ago` milliseconds before. */
  const after = (ago) => {
    freshHome()
    line(given(100000, 1000), NOW - 10 * MIN)
    line(given(400000, 2000), NOW - ago)
    return hintOf(line(given(400000, 2000), NOW))
  }
  assert.equal(after(60e3), grown('400k'))
  assert.equal(after(60e3 - 1), undefined)
  assert.equal(after(30e3), undefined)
  assert.equal(after(1), undefined)
  assert.equal(after(5 * MIN), grown('400k'))
  // The run right after a model call: not quiet, whatever the session did before.
  freshHome()
  line(given(100000, 1000), NOW - 10 * MIN)
  line(given(400000, 2000), NOW - 5 * MIN)
  assert.equal(hintOf(line(given(900000, 3000), NOW)), undefined)
  assert.equal(kept().compactHint, undefined)
  assert.equal(hintOf(line(given(900000, 3000), NOW + 59e3)), undefined)
  assert.equal(hintOf(line(given(900000, 3000), NOW + 60e3)), NEAR)
  // A session whose last model call is not known is not known to be quiet: its first sight,
  // and an input that does not say how long the session has spent on model calls.
  freshHome()
  assert.equal(hintOf(line(given(900000, 1000), NOW)), undefined)
  assert.equal(hintOf(line(given(900000, 1000), NOW + 10 * MIN)), undefined)
  const noTime = { cost: { total_cost_usd: 12.4, total_duration_ms: 4 * HOUR } }
  freshHome()
  line(given(100000, 1000, noTime), NOW - 10 * MIN)
  line(given(900000, 2000, noTime), NOW - 5 * MIN)
  assert.equal(hintOf(line(given(900000, 2000, noTime), NOW)), undefined)
  // A time of the last call that lies ahead, or that is no time, does not count.
  for (const callAt of [NOW + 1, NOW + DAY, 'a minute ago', null]) {
    freshHome()
    line(given(100000, 1000), NOW - 10 * MIN)
    line(given(400000, 2000), NOW - 5 * MIN)
    keep({ callAt })
    assert.equal(hintOf(line(given(400000, 2000), NOW)), undefined, String(callAt))
  }
  // While the session is at work the log is not looked at for a sign.
  freshHome()
  const log = logOf(shell(COMMIT))
  line(given(390000, 1000, { transcript_path: log }), NOW - MIN)
  assert.equal(hintOf(line(given(400000, 2000, { transcript_path: log }), NOW)), undefined)
  assert.equal(kept().compactHint, undefined)
})

test('a hint comes at most once in 30 minutes per session, and stays on the line while the session stays quiet', () => {
  freshHome()
  line(given(100000, 1000), NOW - 2 * MIN)
  line(given(400000, 2000), NOW - MIN)
  assert.equal(hintOf(line(given(400000, 2000), NOW)), grown('400k'))
  assert.deepEqual(kept().compactHint, { at: NOW })
  // The status line runs again on its timer. Nobody typed: the hint is still there.
  for (const later of [0.5, 1, 10, 29]) assert.equal(hintOf(line(given(400000, 2000), NOW + later * MIN)), grown('400k'), `${later} min`)
  assert.deepEqual(kept().compactHint, { at: NOW })

  // The person goes on without a compaction. After the model call the hint is gone, and it
  // does not come back at the next break: 30 minutes have not passed since it came.
  assert.equal(hintOf(line(given(410000, 3000), NOW + 10 * MIN)), undefined)
  for (const later of [11, 12, 20, 29.99]) assert.equal(hintOf(line(given(410000, 3000), NOW + later * MIN)), undefined, `${later} min`)
  assert.equal(hintOf(line(given(410000, 3000), NOW + 30 * MIN - 1)), undefined)
  assert.deepEqual(kept().compactHint, { at: NOW })
  // Another rule does not get around that: the automatic compaction is near now.
  assert.equal(hintOf(line(given(900000, 4000), NOW + 20 * MIN)), undefined)
  assert.equal(hintOf(line(given(900000, 4000), NOW + 25 * MIN)), undefined)
  // After 30 minutes a hint comes again.
  assert.equal(hintOf(line(given(900000, 4000), NOW + 30 * MIN)), NEAR)
  assert.deepEqual(kept().compactHint, { at: NOW + 30 * MIN })

  // Each session has its own 30 minutes.
  line(given(100000, 1000, { session_id: 'two' }), NOW + 20 * MIN)
  line(given(400000, 2000, { session_id: 'two' }), NOW + 21 * MIN)
  assert.equal(hintOf(line(given(400000, 2000, { session_id: 'two' }), NOW + 22 * MIN)), grown('400k'))
  assert.deepEqual(kept('two').compactHint, { at: NOW + 22 * MIN })

  // A session that stays idle for longer keeps its hint. A hint that has been there for 30
  // minutes counts as one that came anew, so the next break after a call has none again.
  assert.equal(hintOf(line(given(900000, 4000), NOW + 59 * MIN)), NEAR)
  assert.deepEqual(kept().compactHint, { at: NOW + 30 * MIN })
  assert.equal(hintOf(line(given(900000, 4000), NOW + 61 * MIN)), NEAR)
  assert.deepEqual(kept().compactHint, { at: NOW + 61 * MIN })
  line(given(910000, 5000), NOW + 62 * MIN)
  assert.equal(hintOf(line(given(910000, 5000), NOW + 63 * MIN)), undefined)
  assert.equal(hintOf(line(given(910000, 5000), NOW + 91 * MIN - 1)), undefined)
  assert.equal(hintOf(line(given(910000, 5000), NOW + 91 * MIN)), NEAR)

  // A saved time that lies ahead comes from a clock that was wrong, and what is kept can be
  // broken: neither holds a hint back.
  for (const compactHint of [{ at: NOW + DAY }, { at: 'soon' }, 'a hint', null, 7, []]) {
    freshHome()
    line(given(100000, 1000), NOW - 2 * MIN)
    line(given(400000, 2000), NOW - MIN)
    keep({ compactHint })
    assert.equal(hintOf(line(given(400000, 2000), NOW)), grown('400k'), JSON.stringify(compactHint))
    assert.deepEqual(kept().compactHint, { at: NOW }, JSON.stringify(compactHint))
  }
})

test('a sign that a task ended counts once: the same task gets no second hint, and the next task gets one', () => {
  freshHome()
  const log = logOf(shell(COMMIT, { at: NOW - 2 * MIN }))
  const at = (ctx, api, now) => hintOf(line(given(ctx, api, { transcript_path: log }), now))
  at(390000, 1000, NOW - 2 * MIN)
  at(400000, 2000, NOW - MIN)
  assert.equal(at(400000, 2000, NOW), ended('400k'))
  // It stays while the session is quiet, without another look at the log.
  assert.equal(at(400000, 2000, NOW + 10 * MIN), ended('400k'))
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW, task: NOW - 2 * MIN })
  // The person goes on with other work. At a break more than 30 minutes later the log still
  // shows the same commit near its end. That task did not just end, so there is no hint.
  at(405000, 3000, NOW + 40 * MIN)
  assert.equal(at(405000, 3000, NOW + 41 * MIN), undefined)
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW + 41 * MIN })
  // The next task ends with a push. At the next break the hint comes again.
  logOf([...shell(COMMIT, { at: NOW - 2 * MIN }), ...shell('git push', { at: NOW + 50 * MIN })], log)
  at(410000, 4000, NOW + 51 * MIN)
  assert.equal(at(410000, 4000, NOW + 52 * MIN), ended('410k'))
  assert.deepEqual(kept().compactHint, { at: NOW + 52 * MIN, look: NOW + 52 * MIN, task: NOW + 50 * MIN })

  // A task that ends while a hint is held back is not lost: the log is looked at when the 30 minutes are over.
  logOf([...shell('git push', { at: NOW + 50 * MIN }), ...shell(COMMIT, { at: NOW + 60 * MIN })], log)
  at(420000, 5000, NOW + 61 * MIN)
  assert.equal(at(420000, 5000, NOW + 62 * MIN), undefined)
  assert.deepEqual(kept().compactHint, { at: NOW + 52 * MIN, look: NOW + 52 * MIN, task: NOW + 50 * MIN })
  at(425000, 6000, NOW + 80 * MIN)
  assert.equal(at(425000, 6000, NOW + 82 * MIN), ended('425k'))
  assert.deepEqual(kept().compactHint, { at: NOW + 82 * MIN, look: NOW + 82 * MIN, task: NOW + 60 * MIN })
})

/** Counts how often a file is opened while `work` runs. */
function opensOf(file, work) {
  const real = fs.openSync
  let opens = 0
  fs.openSync = (path, ...rest) => {
    if (path === file) opens++
    return real(path, ...rest)
  }
  syncBuiltinESMExports()
  try {
    work()
  } finally {
    fs.openSync = real
    syncBuiltinESMExports()
  }
  return opens
}

test('the log is read once for both hints when both are due, and not again while the session stays quiet', () => {
  // 30 calls that read (simple work at high effort), and then a commit.
  const read = Array.from({ length: 30 }, () => toolCall('Read', { file_path: '/home/someone/private-file' })).flat()
  const log = logOf([...read, ...shell(COMMIT)])
  const high = { effort: { level: 'high' }, transcript_path: log }
  const DOWN = 'mostly simple work at high effort: /effort medium keeps the cache'
  freshHome()
  // The first runs name no log, so nothing was looked at yet.
  line(given(390000, 1000), NOW - 2 * MIN)
  line(given(400000, 2000), NOW - MIN)
  let shown
  // Two opens: one for both hints, and one the first time for the account of the session, from
  // the start of the log. The account is kept in the session's file after that.
  assert.equal(opensOf(log, () => { shown = line(given(400000, 2000, high), NOW) }), 2)
  // Both hints came from that one read: first the one about the effort level, then the one to compact.
  assert.equal(shown, `week 36% used, 57% of the week gone | context 400k | effort high | ${DOWN} | ${ended('400k')}`)
  assert.deepEqual(kept().hint, { at: NOW, text: DOWN })
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW, task: NOW - 2 * MIN })
  // The next runs on the timer show both hints and do not read the log.
  assert.equal(opensOf(log, () => { for (const later of [0.5, 1, 4, 6, 20]) shown = line(given(400000, 2000, high), NOW + later * MIN) }), 0)
  assert.ok(shown.endsWith(` | ${DOWN} | ${ended('400k')}`))

  // A look that found no sign is kept too: the log is not read again on every run of the timer.
  const quietLog = logOf(shell('npm test'))
  const plain = { transcript_path: quietLog }
  freshHome()
  line(given(390000, 1000), NOW - 2 * MIN)
  line(given(400000, 2000), NOW - MIN)
  assert.equal(opensOf(quietLog, () => line(given(400000, 2000, plain), NOW)), 2)
  assert.equal(opensOf(quietLog, () => { for (const later of [0.5, 1, 10, 45, 90]) line(given(400000, 2000, plain), NOW + later * MIN) }), 0)
  // After the next model call it is looked at once more.
  line(given(401000, 3000, plain), NOW + 100 * MIN)
  assert.equal(opensOf(quietLog, () => { for (const later of [101, 101.5, 102, 110]) line(given(401000, 3000, plain), NOW + later * MIN) }), 1)
  // A session at work with a hint about the effort level that is due: one read, and no look for a sign.
  freshHome()
  line(given(390000, 1000), NOW - MIN)
  assert.equal(opensOf(log, () => line(given(400000, 2000, high), NOW)), 2)
  assert.equal(kept().compactHint, undefined)
})

test('a compaction is seen as a drop of the context to under half, from above 100,000 tokens, and sets the size to count the growth from', () => {
  // The function on its own. The first size that is seen is the size to count from.
  assert.deepEqual(contextBase(undefined, 527119), { base: 527119, seen: 527119 })
  assert.deepEqual(contextBase(undefined, 0), { base: undefined, seen: undefined })
  // Growth, and a smaller context that is no drop, leave it.
  assert.deepEqual(contextBase({ compactBase: 300000, ctxSeen: 300000 }, 420000), { base: 300000, seen: 420000 })
  assert.deepEqual(contextBase({ compactBase: 300000, ctxSeen: 420000 }, 250000), { base: 300000, seen: 250000 })
  // Under half: exactly half is no drop, and one token less is one.
  assert.deepEqual(contextBase({ compactBase: 300000, ctxSeen: 420000 }, 210000), { base: 300000, seen: 210000 })
  assert.deepEqual(contextBase({ compactBase: 300000, ctxSeen: 420000 }, 209999), { base: 209999, seen: 209999 })
  // From above 100,000 tokens: exactly 100,000 is not above, and one token more is.
  assert.deepEqual(contextBase({ compactBase: 90000, ctxSeen: 100000 }, 31000), { base: 90000, seen: 31000 })
  assert.deepEqual(contextBase({ compactBase: 90000, ctxSeen: 100001 }, 31000), { base: 31000, seen: 31000 })
  // A run without a size changes nothing.
  assert.deepEqual(contextBase({ compactBase: 300000, ctxSeen: 420000 }, 0), { base: 300000, seen: 420000 })
  // A session's file from before these were kept has the size of the context only.
  assert.deepEqual(contextBase({ ctx: 420000 }, 31000), { base: 31000, seen: 31000 })
  assert.deepEqual(contextBase({ ctx: 420000 }, 430000), { base: 430000, seen: 430000 })
  // Values that are no numbers count as not kept.
  assert.deepEqual(contextBase({ compactBase: 'large', ctxSeen: null, ctx: 'x' }, 50000), { base: 50000, seen: 50000 })

  // Through the status line. The context was first seen with 300,000 tokens and grew to 420,000.
  freshHome()
  line(given(300000, 1000), NOW)
  assert.deepEqual(sizes(), [300000, 300000])
  line(given(420000, 2000), NOW + MIN)
  assert.deepEqual(sizes(), [300000, 420000])
  // It grew by 120,000 tokens: no hint at the break.
  assert.equal(hintOf(line(given(420000, 2000), NOW + 2 * MIN)), undefined)
  // A run that is given no size, as right after a compaction: the two sizes stay, and the size
  // of the context that the hooks work with is taken out.
  line({ ...given(0, 2000), context_window: {} }, NOW + 3 * MIN)
  assert.deepEqual([kept().ctx, ...sizes()], [undefined, 300000, 420000])
  // The next size is 31,000 tokens: a compaction. The growth is counted from there.
  line(given(31000, 3000), NOW + 4 * MIN)
  assert.deepEqual(sizes(), [31000, 31000])
  line(given(180999, 4000), NOW + 10 * MIN)
  assert.equal(hintOf(line(given(180999, 4000), NOW + 11 * MIN)), undefined)
  line(given(181000, 5000), NOW + 12 * MIN)
  assert.equal(hintOf(line(given(181000, 5000), NOW + 13 * MIN)), grown('181k'))
  assert.deepEqual(sizes(), [31000, 181000])
  // Without the drop the same sizes give no hint: 181,000 is less than the first size seen.
  assert.equal(hintOf(idle(300000, 181000)), undefined)
  assert.deepEqual(sizes(), [300000, 181000])
  // A drop right before the break: the context is small now, so there is no hint.
  assert.equal(hintOf(idle(420000, 31000)), undefined)
  assert.deepEqual(sizes(), [31000, 31000])
})

test('nothing from the log ends up in the session\'s file except a time, and nothing of it is on the line', () => {
  // Every text in the made-up lines has "private" or "someone" in it: the folder, the branch,
  // the commands, the tasks and the results.
  const lines = [...shell('git commit -m "a private message about someone"'), ...todos(['completed', 'completed']), ...taskNew(), ...taskSet('completed'), ...shell('gh pr create --title "a private title"')]
  assert.match(JSON.stringify(lines), /private-folder.*private-branch.*private message.*private task.*private-id.*private title/)
  freshHome()
  const log = logOf(lines)
  line(given(390000, 1000, { transcript_path: log }), NOW - 2 * MIN)
  line(given(400000, 2000, { transcript_path: log }), NOW - MIN)
  const shown = line(given(400000, 2000, { transcript_path: log }), NOW)
  assert.equal(hintOf(shown), ended('400k'))
  // What is kept for the hint: three times. The third is the time of the sign, from the log.
  assert.deepEqual(kept().compactHint, { at: NOW, look: NOW, task: NOW - 2 * MIN })
  for (const value of Object.values(kept().compactHint)) assert.equal(typeof value, 'number')
  const all = shown + filesText()
  assert.doesNotMatch(all, /private|someone|toolu_|msg_|git|gh pr|commit|push|completed|pending/)
  // The path of the log is not kept either.
  assert.ok(!all.includes(log) && !all.includes('log-'), all)
})

test('the hint to compact is on with 150,000 and 100,000 tokens unless the settings say otherwise, and it is off with the hint about the effort level', () => {
  assert.deepEqual(compactHintConfig({}), { on: true, growth: 150000, near: 100000 })
  assert.deepEqual(compactHintConfig({ compactHint: { on: false, growth: 200000 } }), { on: false, growth: 200000, near: 100000 })
  assert.deepEqual(compactHintConfig({ compactHint: { near: 0 } }), { on: true, growth: 150000, near: 0 })
  // A number that cannot be used gives way to its default.
  for (const bad of [0, -5, 'many', null, NaN, Infinity]) assert.deepEqual(compactHintConfig({ compactHint: { growth: bad, near: bad === 0 ? -1 : bad } }), { on: true, growth: 150000, near: 100000 }, String(bad))
  for (const odd of ['on', null, 7, []]) assert.deepEqual(compactHintConfig({ compactHint: odd }).growth, 150000, JSON.stringify(odd))
  const words = 'at a break in the work: when 100,000 tokens or less are left before Claude Code compacts on its own, when a task just ended and the context has 150,000 tokens or more, or when the context grew by 150,000 tokens'
  assert.equal(compactHintSettingsText(compactHintConfig({})), `on, ${words}`)
  assert.equal(compactHintSettingsText(compactHintConfig({ compactHint: { on: false } })), `off (when on: ${words})`)

  // The numbers of the settings decide.
  const withConfig = (cfg, base, ctx, extra) => {
    freshHome()
    saveConfig(cfg)
    line(given(base, 1000, extra), NOW - 2 * MIN)
    line(given(ctx, 2000, extra), NOW - MIN)
    return hintOf(line(given(ctx, 2000, extra), NOW))
  }
  const own = { compactHint: { growth: 50000, near: 20000 } }
  assert.equal(withConfig(own, 100000, 149999), undefined)
  assert.equal(withConfig(own, 100000, 150000), grown('150k'))
  assert.equal(withConfig(own, 900000, 946999), undefined)
  assert.equal(withConfig(own, 900000, 947000), NEAR)
  const log = logOf(shell(COMMIT))
  assert.equal(withConfig(own, 45000, 49999, { transcript_path: log }), undefined)
  assert.equal(withConfig(own, 45000, 50000, { transcript_path: log }), ended('50k'))
  // Off: no hint, and no look at the log. The sizes are still kept, for when it is turned on.
  for (const [base, ctx] of [[100000, 400000], [800000, 900000], [390000, 400000]]) assert.equal(withConfig({ compactHint: { on: false } }, base, ctx, { transcript_path: log }), undefined)
  assert.equal(kept().compactHint, undefined)
  assert.deepEqual(sizes(), [390000, 400000])
  saveConfig({})
  assert.equal(hintOf(line(given(400000, 2000, { transcript_path: log }), NOW + MIN)), ended('400k'))

  // The command: "hint off" turns both hints off, "hint on" turns both on, and "status" has a row for each.
  const { env, run } = command('hint-command')
  const out = (...args) => run(args).stdout
  const row = () => out('doctor').split('\n').find((l) => l.startsWith('Compaction hint')).replace(/^Compaction hint +/, '')
  assert.equal(row(), `on, ${words}`)
  assert.match(out('hint'), /\nCompaction hint on the status line: on, at a break in the work: .*\.\nA break in the work is 60 seconds without a model call\. The hint names \/compact, comes at most once in 30 minutes per session, and stays while the session is idle\. You type the command: nothing changes on its own\.\nTurn both off with "widal hint off", and on with "widal hint on"\.\n$/)
  assert.match(out('hint', 'off'), new RegExp(`^Effort hint on the status line: off \\(when on: .*\\)\\.\\nCompaction hint on the status line: off \\(when on: ${words}\\)\\.\\n$`))
  assert.deepEqual(ownConfig(env.WIDAL_HOME).compactHint, { on: false, growth: 150000, near: 100000 })
  assert.equal(ownConfig(env.WIDAL_HOME).hint.on, false)
  assert.equal(row(), `off (when on: ${words})`)
  assert.match(out('doctor'), /^Effort hint +off \(when on: /m)
  // Without this tool's status line there is nowhere to show a hint. With it and without a
  // timer, no run of the status line sees a break in the work. Turning the hints on says so.
  assert.match(out('hint', 'on'), /\nCompaction hint on the status line: on, .*\.\nNote: the hint is shown on the status line\. Run "widal connect" first\.\n$/)
  assert.deepEqual(ownConfig(env.WIDAL_HOME).compactHint, { on: true, growth: 150000, near: 100000 })
  assert.equal(run(['connect', '--refresh', '0']).status, 0)
  assert.match(out('hint', 'on'), /\nNote: the hint to compact comes at a break in the work, and only a status line that runs on a timer sees one\. Run "widal connect"\.\n$/)
  assert.equal(run(['connect']).status, 0)
  assert.doesNotMatch(out('hint', 'on'), /Note/)
  // Numbers that were set by hand stay when the hints are turned off and on.
  writeFileSync(join(env.WIDAL_HOME, 'config.json'), JSON.stringify({ compactHint: { growth: 200000, near: 50000 } }))
  out('hint', 'off')
  assert.deepEqual(ownConfig(env.WIDAL_HOME).compactHint, { on: false, growth: 200000, near: 50000 })
  assert.match(out('help'), /^  widal hint +the hints on the status line \(the effort level, a good moment to compact\), and their settings$/m)
})

test('"widal statusline" prints the hint, and a run that looks at a log of 100 MB stays well under 100 ms', () => {
  // The command takes the time from the clock, so the session's file is placed by the clock:
  // the status line saw a model call 2 minutes ago, and the context grew from 100,000 tokens.
  const { env, run } = command('statusline-command')
  mkdirSync(join(env.WIDAL_HOME, 'sessions'), { recursive: true })
  // The one line, whose parts this test looks at.
  writeFileSync(join(env.WIDAL_HOME, 'config.json'), JSON.stringify({ hud: { layout: 'one' } }))
  const now = Date.now()
  writeFileSync(join(env.WIDAL_HOME, 'sessions', 'one.json'), JSON.stringify({ day: '2026-11-12', cost: 12.4, dayStart: 0, at: now - 30e3, apiMs: 2000, callAt: now - 2 * MIN, ctx: 400000, compactBase: 100000, ctxSeen: 400000 }))
  const r = run(['statusline'], JSON.stringify(given(400000, 2000, { rate_limits: undefined })))
  assert.deepEqual([r.status, r.stderr], [0, ''])
  assert.ok(r.stdout.endsWith(' | context 400k: a good moment to /compact'), r.stdout)
  // A session's file that is broken does not break the line.
  writeFileSync(join(env.WIDAL_HOME, 'sessions', 'one.json'), JSON.stringify({ callAt: 'x', compactBase: {}, ctxSeen: [], compactHint: 'x', apiMs: 2000 }))
  const broken = run(['statusline'], JSON.stringify(given(400000, 2000, { rate_limits: undefined })))
  assert.deepEqual([broken.status, broken.stderr], [0, ''])
  assert.match(broken.stdout, / \| context 400k \| today \$\d+\.\d\d$/)

  // Only the end of the file is written: 600 calls that read and a commit, which is more than
  // 256 KB. The rest of the 100 MB is a hole that takes no room on the disk.
  freshHome()
  const size = 100 * 1024 * 1024
  const end = Buffer.from(`\n${[...Array.from({ length: 600 }, () => toolCall('Read', { file_path: '/home/someone/private-file' })).flat(), ...shell(COMMIT)].map((l) => JSON.stringify(l)).join('\n')}\n`)
  assert.ok(end.length > 256 * 1024 && end.length < 1024 * 1024, `the end has ${end.length} bytes`)
  const file = join(dir, 'large.jsonl')
  const fd = openSync(file, 'w')
  ftruncateSync(fd, size)
  writeSync(fd, end, 0, end.length, size - end.length)
  closeSync(fd)
  assert.equal(statSync(file).size, size)
  // Three sessions at a break look at the log, each for both hints at once. The fastest run
  // counts, so that a busy machine does not fail the test.
  const took = ['first', 'second', 'third'].map((id) => {
    const more = { session_id: id }
    line(given(390000, 1000, more), NOW - 2 * MIN)
    line(given(400000, 2000, more), NOW - MIN)
    const start = performance.now()
    const shown = line(given(400000, 2000, { ...more, effort: { level: 'high' }, transcript_path: file }), NOW)
    const ms = performance.now() - start
    assert.ok(shown.endsWith(` | mostly simple work at high effort: /effort medium keeps the cache | ${ended('400k')}`), shown)
    return ms
  })
  assert.ok(Math.min(...took) < 50, `the fastest of three runs took ${Math.min(...took).toFixed(1)} ms`)
})

// The notification before a cache ends. Claude Code compacts a large idle session on its own
// before its 1 hour cache ends, and the notification then says that.
const SOON = (before, tokens = '527k') => `Soon Claude Code compacts this idle session on its own (${tokens} tokens). To keep the full context, send a message before ${before}. To choose what stays, run /compact with your own words now.`
const AFTER = (next) => `After that the next call ${next}. To keep it, send any message before then. Done for now? Run /compact first.`

test('the notification has two bodies: one for a session that Claude Code compacts on its own while it is idle, and the one it had', () => {
  const until = Date.parse('2026-11-12T15:02:00')
  const text = (change = {}) => nudgeText({ project: 'work/repo', until, recache: 527119, mode: 'subscription', ttl: '1h', idleCompaction: undefined, ...change })
  // All three conditions hold: a cache of 1 hour, 200,000 tokens or more, and the setting is not false.
  assert.deepEqual(text(), {
    title: 'widal: work/repo cache ends at 15:02',
    body: 'Soon Claude Code compacts this idle session on its own (527k tokens). To keep the full context, send a message before 15:02. To choose what stays, run /compact with your own words now.',
  })
  // The first condition: the cache lasts 1 hour.
  assert.equal(text({ ttl: '5m' }).body, AFTER('sends 527k tokens again'))
  assert.equal(text({ ttl: undefined }).body, AFTER('sends 527k tokens again'))
  // The second: 200,000 tokens or more to send again. The bound, and one token on each side.
  assert.equal(text({ recache: 200000 }).body, SOON('15:02', '200k'))
  assert.equal(text({ recache: 200001 }).body, SOON('15:02', '200k'))
  assert.equal(text({ recache: 199999 }).body, AFTER('sends 200k tokens again'))
  // The third: Claude Code's setting "idleCompaction" is not false. Only false turns it off.
  assert.equal(text({ idleCompaction: false }).body, AFTER('sends 527k tokens again'))
  for (const set of [true, undefined, null, 'false', 0]) assert.equal(text({ idleCompaction: set }).body, SOON('15:02'), String(set))
  // The body it had stays as it was: the tokens on a subscription, the dollars by the token.
  assert.equal(text({ idleCompaction: false, mode: 'usage', coldCost: 8.43 }).body, AFTER('costs about $8.43'))
  assert.equal(text({ ttl: '5m', mode: 'usage', coldCost: 2.47 }).body, AFTER('costs about $2.47'))
  // The new body gives the tokens also by the token: what counts there is the context, not a price.
  assert.equal(text({ mode: 'usage', coldCost: 8.43 }).body, SOON('15:02'))
  // The title is the same for both, and so is the start when keep-warm has stopped.
  assert.equal(text({ idleCompaction: false }).title, 'widal: work/repo cache ends at 15:02')
  assert.equal(text({ keepWarmStopped: '3 hours' }).body, `Keep-warm stopped after 3 hours. ${SOON('15:02')}`)
  assert.equal(text({ keepWarmStopped: '3 hours', idleCompaction: false }).body, `Keep-warm stopped after 3 hours. ${AFTER('sends 527k tokens again')}`)
  assert.doesNotMatch(text().body, /[\u2013\u2014]/)
})

test('the status line gives the notification how long the cache lasts and Claude Code\'s setting "idleCompaction"', () => {
  /** The notification of a session whose cache ends in 3 minutes, as [title, body]. `settings` are Claude Code's settings. */
  const notified = ({ tokens = 527119, ttl = '1h', settings, env = {}, more = {} } = {}) => {
    freshHome()
    saveConfig({ nudge: { on: true } })
    if (settings !== undefined) writeFileSync(SETTINGS(), typeof settings === 'string' ? settings : JSON.stringify(settings))
    const sent = []
    const end = ttl === '5m' ? NOW + MIN : NOW + 3 * MIN
    line(given(tokens, 1000, { prompt_cache: { warm: true, ttl, expires_at: sec(end), recache_tokens_if_cold: tokens }, ...more }), NOW, { env, notify: (title, body) => sent.push([title, body]) })
    assert.equal(sent.length, 1)
    return sent[0]
  }
  // A cache of 1 hour with 527,119 tokens, and no word about it in Claude Code's settings.
  assert.deepEqual(notified(), ['widal: work/repo cache ends at 12:03', SOON('12:03')])
  assert.deepEqual(notified({ settings: { model: 'claude-fable-5-2' } }), ['widal: work/repo cache ends at 12:03', SOON('12:03')])
  assert.equal(notified({ settings: { idleCompaction: true } })[1], SOON('12:03'))
  // The person turned the idle compaction off in Claude Code: the body is the one it had.
  assert.equal(notified({ settings: { idleCompaction: false } })[1], AFTER('sends 527k tokens again'))
  // Settings that cannot be read do not say "false".
  for (const settings of ['not JSON', '[]', 'null']) assert.equal(notified({ settings })[1], SOON('12:03'), settings)
  // Under 200,000 tokens, and with a cache of 5 minutes: the body it had.
  assert.equal(notified({ tokens: 200000 })[1], SOON('12:03', '200k'))
  assert.equal(notified({ tokens: 199999 })[1], AFTER('sends 200k tokens again'))
  assert.deepEqual(notified({ ttl: '5m' }), ['widal: work/repo cache ends at 12:01', AFTER('sends 527k tokens again')])
  // By the token the body it had gives dollars: 150,000 tokens written to the 1 hour cache of
  // Claude Fable 5.2 again cost $2.40. A session that Claude Code compacts gets the tokens.
  const byToken = { env: { ANTHROPIC_API_KEY: 'a-key' }, more: { rate_limits: undefined } }
  assert.equal(notified({ tokens: 150000, ...byToken })[1], AFTER('costs about $2.40'))
  assert.equal(notified({ ...byToken })[1], SOON('12:03'))
  assert.equal(notified({ settings: { idleCompaction: false }, ...byToken })[1], AFTER('costs about $8.43'))
  // Without the number of tokens to send again, it is the size of the context.
  freshHome()
  saveConfig({ nudge: { on: true } })
  const sent = []
  line(given(300000, 1000, { prompt_cache: { warm: true, ttl: '1h', expires_at: sec(NOW + 3 * MIN) } }), NOW, { notify: (title, body) => sent.push(body) })
  assert.deepEqual(sent, [SOON('12:03', '300k')])
})

test('no file of the tool holds an em dash or an en dash: not the guide, the command, the parts or the tests', () => {
  // The writing rule covers every line a person reads, also a comment and a test. A check for
  // the two characters writes them as escapes, as here, so that its own file holds neither.
  const dash = /[\u2013\u2014]/
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files = ['README.md']
  for (const folder of ['cli', 'src', 'test']) {
    for (const f of readdirSync(join(root, folder), { recursive: true, withFileTypes: true })) {
      if (f.isFile()) files.push(join(f.parentPath ?? f.path, f.name).slice(root.length))
    }
  }
  // Each place is given as "file:line", so that a failure says where the character is.
  const found = []
  for (const file of files) {
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, i) => {
      if (dash.test(text)) found.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(found, [])
  // The check reads the files it is meant to read: this file is one of them, and so are the
  // command, the move from the tool's old name and the tests of both.
  for (const file of ['test/compact.test.mjs', 'cli/widal.mjs', 'src/migrate.mjs', 'test/widal.test.mjs', 'test/migrate.test.mjs']) assert.ok(files.includes(file), file)
  // The folder of the command holds three files: the command, and the two small files that run
  // it under the tool's old names. All three are read.
  assert.equal(files.filter((file) => file.startsWith('cli/')).length, 3)
})
