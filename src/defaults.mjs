// The changes that Widal.Code makes on its own, without "widal advise" and "widal apply".
//
// A change becomes a default only after a stage of the benchmark proved it: it saved money with a
// 95% interval that excludes no saving, and kept the solved tasks within the margin set before the
// stage (bench/PREREGISTRATION.md). DEFAULTS lists each one with the stage that proved it.
//
// Once a day, the hook at the start of a session starts a run in the background ("widal defaults
// run"). For each default the run does one of these:
//   - It applies the change when the person's own sessions show that it fits: "widal advise" would
//     propose it, from the last 30 days. The change is applied with "widal apply", so "widal undo"
//     takes it back, and "widal doctor" lists it.
//   - Once applied, it measures the change as "widal measure" does: the calls that the change acts
//     on, in the 14 days before and since. When there is enough after it, a change that made those
//     calls 10% or more costlier, or whose signs of the work rose past the rule of "widal measure",
//     is taken back. A change that is cheaper and keeps the work the same is kept, and is not
//     measured again.
//   - A change that the person took back, or applied by hand, is theirs: the run leaves it alone.
// What a run did is told once, at the start of the next session, as a message to the person.
//
// "widal defaults off" takes back what the defaults applied and stops them.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTIONS, applied, apply, undo } from './actions.mjs'
import { changeOf, judge, measureSides, proposals } from './advise.mjs'
import { config, saveConfig } from './config.mjs'
import { day } from './format.mjs'
import { home } from './paths.mjs'

/**
 * The default changes, with the stage of the benchmark that proved each one. The README lists the
 * same. A change gets in here only after its own stage, never on an estimate.
 */
export const DEFAULTS = {
  'tools-unused': {
    what: 'Leaves out the built-in tools of Claude Code that none of your sessions called',
    proof: 'Benchmark stages "current" and "confirm" (24 and 25 Nov 2026): on 199 tasks with Sonnet 5.5, 11% less cost (95% interval 18% to 3% less), and solved tasks within the margin (+1.3 points).',
  },
}

// A run at most once a day. The sessions of the last 30 days decide whether a change fits.
const RUN_EVERY = 86400e3
const PROPOSAL_DAYS = 30
// Measured on the 14 days before a change (as "widal measure").
const BEFORE_DAYS = 14
// The calls that the change acts on costing this much more is a reason to take it back. It is above
// the 5% that "widal measure" calls cheaper, so that noise in a person's own work does not undo a
// proven change.
const COSTLIER = 0.1
// A rise in errors or rounds of fixing past this part is a reason to take it back: the rule of
// "widal measure" for "the work looks worse".
const WORSE = 0.25

const stateFile = () => join(home(), 'defaults.json')
// The command file that the background run starts, as the board's sync does.
const COMMAND = fileURLToPath(new URL('../cli/widal.mjs', import.meta.url))

/** What the defaults did: { lastRun, changes: { id: { status, at, checked, words } }, notes: [] }. */
export function defaultsState() {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8'))
    return { lastRun: s.lastRun ?? 0, changes: s.changes ?? {}, notes: s.notes ?? [] }
  } catch {
    return { lastRun: 0, changes: {}, notes: [] }
  }
}

function saveState(state) {
  mkdirSync(home(), { recursive: true })
  const tmp = `${stateFile()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, stateFile())
}

/** True unless the person turned the defaults off with "widal defaults off". */
export const defaultsOn = () => config().defaults !== false

/**
 * Starts a run in the background when the last one is a day old. Called by the hook at the start of
 * a session: it never waits and prints nothing.
 */
export function startDefaults(now = Date.now(), spawner = spawn) {
  try {
    if (!defaultsOn()) return false
    const state = defaultsState()
    if (now - state.lastRun < RUN_EVERY) return false
    // Marked before the start, so that two sessions starting at once start one run.
    saveState({ ...state, lastRun: now })
    spawner(process.execPath, [COMMAND, 'defaults', 'run'], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

/** The days of session logs a run reads: 30 for the proposals, and from 14 days before the oldest change it still measures. */
export function runSince(now = Date.now()) {
  const measuring = Object.values(defaultsState().changes).filter((c) => c.status === 'applied').map((c) => c.at - BEFORE_DAYS * 86400e3)
  return Math.min(now - PROPOSAL_DAYS * 86400e3, ...measuring)
}

/**
 * One run over the session logs. `records` are the parsed calls since `runSince()`. `bin` is the
 * path of this tool's command, for the actions that set a hook. The two functions are the
 * proposals and the measured sides, so that a test can hand in its own. Returns what it did, as
 * lines; the same words wait in the state for the next session's start.
 */
export function runDefaults(records, { bin, now = Date.now(), proposalsOf = proposals, sidesOf = measureSides } = {}) {
  const state = defaultsState()
  state.lastRun = now
  if (!defaultsOn()) {
    saveState(state)
    return []
  }
  const done = []
  const byHand = applied()
  let found
  for (const id of Object.keys(DEFAULTS)) {
    const mine = state.changes[id]
    if (mine?.status === 'applied' && !byHand[id]) {
      // Taken back by the person since the last run: theirs from now on.
      state.changes[id] = { ...mine, status: 'declined', checked: now }
      continue
    }
    if (!mine) {
      if (byHand[id]) {
        state.changes[id] = { status: 'by hand', at: byHand[id].at, checked: now }
        continue
      }
      found ??= proposalsOf(records.filter((r) => r.ts >= now - PROPOSAL_DAYS * 86400e3))
      const proposal = found.find((p) => p.id === id && p.apply)
      if (!proposal) continue
      apply(id, bin, now, proposal.args ? proposal.args.split(' ') : [])
      const words = `Widal.Code applied "${id}": ${proposal.title.charAt(0).toLowerCase()}${proposal.title.slice(1)}. A benchmark stage proved it. It is measured on your own sessions and taken back if it does not help. Take it back yourself with: widal undo ${id}`
      state.changes[id] = { status: 'applied', at: now, checked: now }
      done.push(words)
      continue
    }
    if (mine.status !== 'applied') continue
    const sides = sidesOf(records, { id, at: byHand[id].at, before: byHand[id].before })
    const verdict = judge(sides.before, sides.after)
    state.changes[id] = { ...mine, checked: now }
    if (verdict === 'early' || verdict === 'nothing') continue
    const { cheaper, worse } = changeOf(sides.before, sides.after)
    if (-cheaper >= COSTLIER - 1e-9 || worse > WORSE + 1e-9) {
      undo(id, bin)
      const why = worse > WORSE + 1e-9 ? 'the signs of the work got worse' : `the calls it acts on cost ${Math.round(-cheaper * 100)}% more`
      state.changes[id] = { ...state.changes[id], status: 'taken back', words: why }
      done.push(`Widal.Code took back "${id}", which it applied on ${day(mine.at)}: on your sessions since then, ${why}. It stays off. See what was measured with: widal defaults`)
    } else if (verdict === 'cheaper') {
      state.changes[id] = { ...state.changes[id], status: 'kept', words: `${Math.round(cheaper * 100)}% cheaper on your sessions, and the work looks the same` }
    }
  }
  state.notes = [...state.notes, ...done]
  saveState(state)
  return done
}

/** The words that wait for the person, once: they are taken out of the state. */
export function takeNotes() {
  const state = defaultsState()
  if (!state.notes.length) return undefined
  saveState({ ...state, notes: [] })
  return state.notes.join('\n')
}

const STATUS = {
  applied: (c) => `applied on ${day(c.at)}, being measured on your sessions`,
  kept: (c) => `applied on ${day(c.at)} and kept: ${c.words}`,
  'taken back': (c) => `taken back: ${c.words}`,
  declined: (c) => `you took it back after ${day(c.at)}, so it stays off`,
  'by hand': () => 'applied by you, so the defaults leave it alone',
}

/** One row per default: its id and what happened to it. For "widal defaults" and "widal doctor". */
export function defaultsRows() {
  const state = defaultsState()
  return Object.keys(DEFAULTS).map((id) => {
    const c = state.changes[id]
    if (!defaultsOn()) return [id, 'off (turn on with: widal defaults on)']
    return [id, c ? STATUS[c.status]?.(c) ?? c.status : 'not applied: your sessions do not show yet that it fits']
  })
}

/** "widal defaults": what each default is, the stage that proved it, and what happened to it here. */
export function defaultsReport() {
  const rows = defaultsRows()
  const out = ['Changes that Widal.Code makes on its own, after a benchmark stage proved them:', '']
  for (const [id, status] of rows) out.push(`${id}: ${DEFAULTS[id].what}.`, `  Here: ${status}.`, `  Proof: ${DEFAULTS[id].proof}`, '')
  out.push(defaultsOn() ? 'Turn them off, and take back what they applied, with: widal defaults off' : 'Turn them on with: widal defaults on')
  return out.join('\n')
}

/** "widal defaults off": takes back what the defaults applied and still hold, and stops them. "on" starts them again. */
export function setDefaults(on, bin) {
  saveConfig({ ...config(), defaults: on })
  if (on) return ['The default changes are on. The next session start checks your sessions.']
  const state = defaultsState()
  const out = []
  for (const [id, c] of Object.entries(state.changes)) {
    if ((c.status === 'applied' || c.status === 'kept') && applied()[id] && ACTIONS[id]) {
      out.push(...undo(id, bin))
      state.changes[id] = { ...c, status: 'declined', checked: Date.now() }
    }
  }
  saveState(state)
  return [...out, 'The default changes are off. Widal.Code makes no change on its own until: widal defaults on']
}
