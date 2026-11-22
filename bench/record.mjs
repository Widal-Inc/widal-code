// The record of a run in the form that may leave the computer: numbers, the benchmark's own ids,
// model names and versions. It holds no folder, no session id, no branch, and no text of a
// session, of a check or of an error. Every text in it has to match a strict form, so that a
// value from somewhere else cannot ride along: a record with any other text is refused.
//
// Two records can be compared when they have the same `taskHash`: the same issue text, the same
// start of the project and the same hidden checks. `setup` says with which versions and how the
// run was started, because a result holds only for the versions it was measured with.
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { armOf, settingsOf } from './arms.mjs'
import { startState } from './score.mjs'
import { taskOf } from './tasks.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
/** The version of the record's format. */
export const RECORD_VERSION = 1
/** The name of this set of tasks. */
export const TASK_SET = 'ledger'

const FORMS = {
  id: /^[a-z0-9][a-z0-9-]{0,39}$/,
  model: /^[a-z0-9][a-z0-9.:-]{0,79}$/,
  version: /^[A-Za-z0-9][A-Za-z0-9.+-]{0,39}$/,
  platform: /^[a-z0-9]{1,20} [a-z0-9_]{1,20}$/,
  day: /^\d{4}-\d{2}-\d{2}$/,
  hash: /^[0-9a-f]{16}$/,
}

/** A text that has the form, or an error that names the field. A missing value is null when `optional`. */
function text(value, form, field, { optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return null
  if (typeof value !== 'string' || !FORMS[form].test(value)) throw new Error(`the record's field "${field}" does not have the form of a ${form}`)
  return value
}
/** A number, or null when there is none. */
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const flag = (value) => (typeof value === 'boolean' ? value : null)

/** The files of a folder and of the folders in it, sorted. */
function filesOf(dir, under = '') {
  const out = []
  for (const name of readdirSync(join(dir, under)).sort()) {
    const path = join(under, name)
    if (statSync(join(dir, path)).isDirectory()) out.push(...filesOf(dir, path))
    else out.push(path)
  }
  return out
}

const hashes = new Map()
/**
 * What makes two runs of a task the same test: the issue text, the project as the task starts
 * with it, and the hidden checks with the code that runs them. 16 characters of a SHA-256.
 */
export function taskHash(task) {
  if (hashes.has(task.id)) return hashes.get(task.id)
  const hash = createHash('sha256')
  const add = (name, content) => hash.update(`${name}\0`).update(content).update('\0')
  add('prompt', task.prompt)
  if (task.other) {
    // A task of a tasks file: the state it starts from by its name, and the tests that score it.
    add('version', task.version ?? '')
    add('expect', readFileSync(task.hidden.expect))
    add('passing', readFileSync(task.still.passing))
    for (const file of filesOf(task.hidden.files)) add(file, readFileSync(join(task.hidden.files, file)))
    const value = hash.digest('hex').slice(0, 16)
    hashes.set(task.id, value)
    return value
  }
  add('checks', readFileSync(join(HERE, 'checks', `${task.checksOf ?? task.id}.mjs`)))
  add('runner', readFileSync(join(HERE, 'checks', 'run.mjs')))
  const dir = mkdtempSync(join(tmpdir(), 'bench-hash-'))
  try {
    startState(task, dir)
    for (const file of filesOf(dir)) add(file, readFileSync(join(dir, file)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const value = hash.digest('hex').slice(0, 16)
  hashes.set(task.id, value)
  return value
}

/**
 * The record of one run that may be shared. `settings` are the settings the arm ran with, as
 * Claude Code read them. A record made before the settings and the setup were kept gets them
 * from the caller, or null.
 */
export function publicRecord(run, settings = run.settings) {
  const task = taskOf(run.task)
  const arm = armOf(run.arm)
  const own = settings ?? (arm.from ? undefined : settingsOf(arm))
  const setup = run.setup ?? {}
  const models = Object.entries(run.claude?.modelUsage ?? {}).map(([model, u]) => ({
    model: text(model, 'model', 'models.model'),
    in: number(u.inputTokens),
    out: number(u.outputTokens),
    thinking: number(u.thinkingTokens),
    cacheRead: number(u.cacheReadInputTokens),
    cacheWrite5m: number(u.cacheCreationEphemeral5mInputTokens),
    cacheWrite1h: number(u.cacheCreationEphemeral1hInputTokens),
    cost: number(u.costUSD),
  }))
  return {
    v: RECORD_VERSION,
    taskSet: TASK_SET,
    task: text(task.id, 'id', 'task'),
    taskHash: text(run.taskHash ?? taskHash(task), 'hash', 'taskHash'),
    byHandMinutes: number(task.minutes),
    arm: text(arm.id, 'id', 'arm'),
    round: number(run.rep),
    day: text(String(run.started ?? '').slice(0, 10), 'day', 'day'),
    settings: {
      model: text(own?.model, 'model', 'settings.model', { optional: true }),
      effort: text(run.effort ?? arm.effort ?? own?.effortLevel, 'id', 'settings.effort', { optional: true }),
      subagentModel: text(own?.env?.CLAUDE_CODE_SUBAGENT_MODEL, 'model', 'settings.subagentModel', { optional: true }),
      bashOutputMaxChars: number(own?.bashOutputMaxChars),
      widalCodeHooks: arm.plugin === true,
    },
    setup: {
      claudeCode: text(setup.claudeCode, 'version', 'setup.claudeCode', { optional: true }),
      widalCode: text(setup.widalCode, 'version', 'setup.widalCode', { optional: true }),
      node: text(setup.node, 'version', 'setup.node', { optional: true }),
      platform: text(setup.platform, 'platform', 'setup.platform', { optional: true }),
      paired: flag(setup.paired),
      armsSideBySide: number(setup.armsSideBySide),
    },
    outcome: {
      closed: run.score?.closed === true,
      passed: number(run.score?.passed),
      total: number(run.score?.total),
      testsPass: flag(run.score?.testsPass),
      timedOut: run.timedOut === true,
    },
    cost: number(run.claude?.cost),
    wallSeconds: number(run.wallMs) === null ? null : Math.round(run.wallMs / 100) / 10,
    apiSeconds: number(run.claude?.apiMs) === null ? null : Math.round(run.claude.apiMs / 100) / 10,
    turns: number(run.claude?.turns),
    refused: Array.isArray(run.claude?.denials) ? run.claude.denials.length : null,
    models,
  }
}
