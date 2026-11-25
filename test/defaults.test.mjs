// Tests for the default changes (src/defaults.mjs): a change is applied when the person's own
// sessions show that it fits, measured, kept or taken back, and told once. With made-up settings
// and a made-up home folder in a temp folder, and made-up proposals and measures. Run: node --test
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'widal-code-defaults-test-')))
process.env.HOME = join(dir, 'person')
process.env.WIDAL_HOME = join(dir, 'home')
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
process.env.WIDAL_COWORK_DIR = join(dir, 'cowork')
process.env.WIDAL_MANAGED_SETTINGS = join(dir, 'managed', 'managed-settings.json')
mkdirSync(process.env.HOME, { recursive: true })
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })

const defaults = await import('../src/defaults.mjs')
const actions = await import('../src/actions.mjs')
const { judge, verdict } = await import('../src/advise.mjs')

const WIDAL = fileURLToPath(new URL('../cli/widal.mjs', import.meta.url))
const OWN = join(process.env.HOME, '.widal', 'bin', 'widal')
const DAY = 86400e3
const NOW = Date.parse('2026-12-01T09:00:00Z')

const settings = () => JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'))
const writeSettings = (s) => writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify(s))
// A fresh home folder for each test: no applied actions, no state of the defaults, no config.
let homes = 0
function fresh(s = { theme: 'dark' }) {
  process.env.WIDAL_HOME = join(dir, `home-${++homes}`)
  writeSettings(s)
}

// What "widal advise" proposes when no session called four of the tools.
const PROPOSAL = { id: 'tools-unused', title: 'Leave out 4 built-in tools that no session called', apply: true, args: '--tools Workflow,ScheduleWakeup,ListAgents,WebSearch' }
const proposing = (list) => () => list
// The measures of one side, as `measures` in analyze.mjs gives them.
const side = (cost, { calls = 800, sessions = 30, errors = 2, fixRounds = 1 } = {}) => ({ calls, sessions, cost, errors, fixRounds })
const sides = (before, after) => () => ({ before, after })
const never = () => {
  throw new Error('not expected to be called')
}

test('a default is applied when the proposals show that it fits, and told once', () => {
  fresh({ theme: 'dark', permissions: { deny: ['Read(./.env)'] } })
  const done = defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]), sidesOf: never })
  assert.equal(done.length, 1)
  assert.match(done[0], /^Widal\.Code applied "tools-unused": leave out 4 built-in tools that no session called\. A benchmark stage proved it\./)
  assert.match(done[0], /widal undo tools-unused$/)
  assert.deepEqual(settings().permissions.deny, ['Read(./.env)', 'Workflow', 'ScheduleWakeup', 'ListAgents', 'WebSearch'])
  assert.equal(actions.applied()['tools-unused'].at, NOW)
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'applied')
  assert.equal(defaults.takeNotes(), done[0])
  assert.equal(defaults.takeNotes(), undefined)
  assert.deepEqual(defaults.defaultsRows(), [['tools-unused', 'applied on 2026-12-01, being measured on your sessions']])
})

test('nothing is applied when the sessions do not show that a change fits', () => {
  fresh()
  assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([]) }), [])
  assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([{ ...PROPOSAL, apply: false }]) }), [])
  assert.deepEqual(settings(), { theme: 'dark' })
  assert.equal(defaults.defaultsState().changes['tools-unused'], undefined)
  assert.match(defaults.defaultsRows()[0][1], /^not applied/)
})

test('an applied default waits while it is too early, and is kept when it is cheaper and the work looks the same', () => {
  fresh()
  defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]) })
  defaults.takeNotes()
  // Too few calls since the change: no decision.
  assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW + DAY, proposalsOf: never, sidesOf: sides(side(10), side(8, { calls: 100, sessions: 3 })) }), [])
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'applied')
  // No clear difference: still applied, and measured again on the next run.
  defaults.runDefaults([], { bin: OWN, now: NOW + 2 * DAY, proposalsOf: never, sidesOf: sides(side(10), side(10.3)) })
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'applied')
  // 12% cheaper and the same signs: kept, and not measured again.
  assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW + 9 * DAY, proposalsOf: never, sidesOf: sides(side(10), side(8.8)) }), [])
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'kept')
  assert.deepEqual(defaults.defaultsRows(), [['tools-unused', 'applied on 2026-12-01 and kept: 12% cheaper on your sessions, and the work looks the same']])
  defaults.runDefaults([], { bin: OWN, now: NOW + 10 * DAY, proposalsOf: never, sidesOf: never })
  assert.ok(settings().permissions.deny.includes('Workflow'))
  assert.equal(defaults.takeNotes(), undefined)
})

test('an applied default is taken back when it costs 10% more or the work looks worse, and stays off', () => {
  for (const [after, why] of [
    [side(11.2), /the calls it acts on cost 12% more/],
    [side(9, { errors: 3 }), /the signs of the work got worse/],
  ]) {
    fresh({ theme: 'dark' })
    defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]) })
    defaults.takeNotes()
    const done = defaults.runDefaults([], { bin: OWN, now: NOW + 8 * DAY, proposalsOf: never, sidesOf: sides(side(10), after) })
    assert.equal(done.length, 1)
    assert.match(done[0], /^Widal\.Code took back "tools-unused", which it applied on 2026-12-01: on your sessions since then, /)
    assert.match(done[0], why)
    assert.deepEqual(settings(), { theme: 'dark' })
    assert.equal(actions.applied()['tools-unused'], undefined)
    assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'taken back')
    assert.equal(defaults.takeNotes(), done[0])
    // It is not applied again, also when the sessions still propose it.
    assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW + 9 * DAY, proposalsOf: proposing([PROPOSAL]), sidesOf: never }), [])
    assert.deepEqual(settings(), { theme: 'dark' })
  }
  // A cost rise below 10% is noise in a person's own work: the change stays.
  fresh()
  defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]) })
  defaults.runDefaults([], { bin: OWN, now: NOW + 8 * DAY, proposalsOf: never, sidesOf: sides(side(10), side(10.8)) })
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'applied')
})

test('a default that the person took back, or applied by hand, is theirs', () => {
  fresh()
  defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]) })
  actions.undo('tools-unused', OWN)
  defaults.runDefaults([], { bin: OWN, now: NOW + DAY, proposalsOf: proposing([PROPOSAL]), sidesOf: never })
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'declined')
  assert.deepEqual(settings(), { theme: 'dark' })
  assert.match(defaults.defaultsRows()[0][1], /^you took it back/)

  fresh()
  actions.apply('tools-unused', OWN, NOW - DAY, ['--tools', 'Task'])
  assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]), sidesOf: never }), [])
  assert.deepEqual(settings().permissions.deny, ['Task'])
  assert.equal(defaults.defaultsState().changes['tools-unused'].status, 'by hand')
})

test('"widal defaults off" takes back what the defaults applied and stops them; "on" starts them again', () => {
  fresh()
  defaults.runDefaults([], { bin: OWN, now: NOW, proposalsOf: proposing([PROPOSAL]) })
  const out = defaults.setDefaults(false, OWN)
  assert.match(out[0], /^tools-unused is taken back/)
  assert.match(out.at(-1), /^The default changes are off/)
  assert.deepEqual(settings(), { theme: 'dark' })
  assert.deepEqual(defaults.runDefaults([], { bin: OWN, now: NOW + DAY, proposalsOf: never, sidesOf: never }), [])
  assert.deepEqual(defaults.defaultsRows(), [['tools-unused', 'off (turn on with: widal defaults on)']])
  assert.equal(defaults.startDefaults(NOW + 3 * DAY, never), false)
  defaults.setDefaults(true, OWN)
  // Taken back by "off", so the person's choice holds after "on" too.
  defaults.runDefaults([], { bin: OWN, now: NOW + 2 * DAY, proposalsOf: proposing([PROPOSAL]), sidesOf: never })
  assert.deepEqual(settings(), { theme: 'dark' })
})

test('the hook starts at most one run a day', () => {
  fresh()
  const started = []
  const spawner = (cmd, args) => {
    started.push(args.slice(1))
    return { unref() {} }
  }
  assert.equal(defaults.startDefaults(NOW, spawner), true)
  assert.equal(defaults.startDefaults(NOW + DAY / 2, spawner), false)
  assert.equal(defaults.startDefaults(NOW + DAY, spawner), true)
  assert.deepEqual(started, [['defaults', 'run'], ['defaults', 'run']])
  // The logs a run reads: 30 days, or from 14 days before a change it still measures.
  assert.equal(defaults.runSince(NOW), NOW - 30 * DAY)
})

test('the hook at the start of a session tells the person once what the last run did, as a message to them', () => {
  fresh()
  defaults.runDefaults([], { bin: OWN, now: Date.now(), proposalsOf: proposing([PROPOSAL]) })
  const run = () => spawnSync(process.execPath, [WIDAL, 'hook', 'check-settings'], { input: '{}', encoding: 'utf8', env: { ...process.env } })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const message = JSON.parse(first.stdout)
  assert.deepEqual(Object.keys(message), ['systemMessage'])
  assert.match(message.systemMessage, /^widal: Widal\.Code applied "tools-unused"/)
  assert.equal(run().stdout, '')
})

test('the rule of "widal measure" as a word, and its sentence', () => {
  assert.equal(judge(side(10), side(8, { calls: 10 })), 'early')
  assert.equal(judge(side(10, { calls: 0 }), side(8)), 'nothing')
  assert.equal(judge(side(10), side(9.5)), 'cheaper')
  assert.equal(judge(side(10), side(9, { errors: 3 })), 'worse')
  assert.equal(judge(side(10), side(10)), 'unclear')
  assert.equal(verdict(side(10), side(9)), 'Cheaper, and the work looks the same.')
  assert.equal(verdict(side(10), side(10)), 'No clear difference.')
})
