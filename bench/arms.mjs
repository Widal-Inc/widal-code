// The arms of the benchmark. An arm is one way to run the same tasks: a model, an effort, and
// whether Widal.Code is on. Each arm is a settings file that Claude Code gets with --settings.
//
// `number` goes into the ticket key of each run, so that the spend per ticket can be checked.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** The settings that every arm has. Claude Code's memory is off, so that one task tells the next one nothing. */
const COMMON = { autoMemoryEnabled: false, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', DISABLE_AUTOUPDATER: '1' } }

export const ARMS = [
  { id: 'fable-xhigh', number: 1, name: 'Fable 5.2, effort xhigh', settings: { model: 'claude-fable-5-2', effortLevel: 'xhigh' } },
  { id: 'fable-low', number: 2, name: 'Fable 5.2, effort low', settings: { model: 'claude-fable-5-2', effortLevel: 'low' } },
  { id: 'opus-xhigh', number: 3, name: 'Opus 5.5, effort xhigh', settings: { model: 'claude-opus-5-5', effortLevel: 'xhigh' } },
  { id: 'sonnet-xhigh', number: 4, name: 'Sonnet 5.5, effort xhigh', settings: { model: 'claude-sonnet-5-5', effortLevel: 'xhigh' } },
  { id: 'haiku', number: 5, name: 'Haiku 5.5', settings: { model: 'claude-haiku-5-5' } },
  // The baseline with Widal.Code on: its hooks run, and its settings are the baseline's after
  // "widal apply" for every proposal of "widal advise" that the tool can apply itself.
  { id: 'widal-on', number: 6, name: 'Fable 5.2 xhigh, Widal.Code on', from: 'fable-xhigh', plugin: true },
  // The arms below are `extra`: bench/run.mjs runs them only when --arms names them.
  // The steps between the baseline's effort and the lowest one, so that the cost of each effort level can be read.
  { id: 'fable-high', number: 7, name: 'Fable 5.2, effort high', extra: true, settings: { model: 'claude-fable-5-2', effortLevel: 'high' } },
  { id: 'fable-medium', number: 8, name: 'Fable 5.2, effort medium', extra: true, settings: { model: 'claude-fable-5-2', effortLevel: 'medium' } },
  // One change of Widal.Code alone on the baseline, on the tasks that the change acts on (`only`).
  { id: 'fable-sub-sonnet', number: 9, name: 'Fable 5.2 xhigh, subagents on Sonnet 5.5', extra: true, only: ['s1'], settings: { model: 'claude-fable-5-2', effortLevel: 'xhigh', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5' } } },
  { id: 'fable-cap', number: 10, name: 'Fable 5.2 xhigh, command output capped', extra: true, only: ['t2', 's2'], settings: { model: 'claude-fable-5-2', effortLevel: 'xhigh', bashOutputMaxChars: 10000 } },
]

/** The arm that the others are compared with. */
export const BASELINE = 'fable-xhigh'

/** What an arm of an arms file may hold. */
const FILE_KEYS = ['id', 'number', 'name', 'settings', 'only', 'pluginDir', 'tools', 'path', 'env', 'systemPrompt']

/**
 * Adds the arms of a file to the benchmark's own, for `--arms-file <file>`. This is how another
 * tool is run on the same tasks: the file is a JSON list of arms, and an arm can name
 * - `settings`: the settings Claude Code gets, with a `model` (as for the arms above);
 * - `pluginDir`: a plugin folder that the sessions load;
 * - `tools`: more tools that an agent may use without a person to ask;
 * - `path`: folders that come first in the sessions' PATH;
 * - `env`: more of the sessions' environment;
 * - `systemPrompt`: a text that is added to the system prompt, for what a tool's install would
 *   put into the person's own instructions;
 * - `only`: the only tasks the arm runs.
 * In every text, `${out}` is the folder of the benchmark run and `${dir}` the folder of the file.
 *
 * Such an arm has a `number` from 20 to 99 and runs only when --arms names it. Its runs are
 * never part of the records that may be shared (bench/export.mjs): a record there says the
 * settings of a run, and it has no field for another tool.
 * @returns {object[]} The arms that were added.
 */
export function addArms(file, out) {
  let list
  try {
    list = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`The arms file ${file} cannot be read as JSON: ${e.message}`)
  }
  if (!Array.isArray(list)) throw new Error(`The arms file ${file} must hold a list of arms.`)
  const dir = dirname(resolve(file))
  const fill = (value) => {
    if (typeof value === 'string') return value.replaceAll('${out}', out).replaceAll('${dir}', dir)
    if (Array.isArray(value)) return value.map(fill)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, fill(v)]))
    return value
  }
  const added = []
  for (const given of list) {
    const arm = fill(given)
    const wrong = (what) => new Error(`The arms file ${file}: the arm ${JSON.stringify(given?.id)} ${what}.`)
    if (!arm || typeof arm !== 'object' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(arm.id ?? '')) throw wrong('needs an "id" of lower case letters, digits and dashes')
    const unknown = Object.keys(arm).find((key) => !FILE_KEYS.includes(key))
    if (unknown) throw wrong(`has the field "${unknown}", which is not one of: ${FILE_KEYS.join(', ')}`)
    if (ARMS.some((a) => a.id === arm.id)) throw wrong('has the id of another arm')
    if (!Number.isInteger(arm.number) || arm.number < 20 || arm.number > 99 || ARMS.some((a) => a.number === arm.number)) throw wrong('needs a "number" from 20 to 99 that no other arm has')
    if (typeof arm.name !== 'string' || !arm.name.trim()) throw wrong('needs a "name"')
    if (typeof arm.settings?.model !== 'string') throw wrong('needs "settings" with a "model"')
    for (const key of ['tools', 'path', 'only']) if (arm[key] !== undefined && !(Array.isArray(arm[key]) && arm[key].every((x) => typeof x === 'string'))) throw wrong(`needs a list of texts as "${key}"`)
    for (const key of ['pluginDir', 'systemPrompt']) if (arm[key] !== undefined && typeof arm[key] !== 'string') throw wrong(`needs a text as "${key}"`)
    const full = { ...arm, extra: true, other: true }
    ARMS.push(full)
    added.push(full)
  }
  return added
}

export const armOf = (id) => {
  const arm = ARMS.find((a) => a.id === id)
  if (!arm) throw new RangeError(`no arm "${id}". The arms are: ${ARMS.map((a) => a.id).join(', ')}`)
  return arm
}

/** The settings of an arm as Claude Code reads them. */
export function settingsOf(arm) {
  const own = arm.settings ?? armOf(arm.from).settings
  return { ...COMMON, ...own, env: { ...COMMON.env, ...(own.env ?? {}) } }
}

/**
 * The tools that an agent may use without a person to ask. A run has no person, so every other
 * tool call is refused. The shell is limited to the test command, node and reading commands.
 */
export const TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent',
  'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)', 'Bash(TZ=*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(wc:*)', 'Bash(printf:*)', 'Bash(echo:*)',
]
