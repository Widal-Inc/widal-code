// The arms of the benchmark. An arm is one way to run the same tasks: a model, an effort, and
// whether Widal.Code is on. Each arm is a settings file that Claude Code gets with --settings.
//
// `number` goes into the ticket key of each run, so that the spend per ticket can be checked.
// `effort` is an effort level that the sessions get with "--effort": Claude Code's "effortLevel"
// setting takes low, medium, high and xhigh, and not max.
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
  // The other effort levels of the four models, so that every level of every model can be read.
  { id: 'fable-max', number: 11, name: 'Fable 5.2, effort max', extra: true, effort: 'max', settings: { model: 'claude-fable-5-2' } },
  { id: 'opus-low', number: 12, name: 'Opus 5.5, effort low', extra: true, settings: { model: 'claude-opus-5-5', effortLevel: 'low' } },
  { id: 'opus-medium', number: 13, name: 'Opus 5.5, effort medium', extra: true, settings: { model: 'claude-opus-5-5', effortLevel: 'medium' } },
  { id: 'opus-high', number: 14, name: 'Opus 5.5, effort high', extra: true, settings: { model: 'claude-opus-5-5', effortLevel: 'high' } },
  { id: 'opus-max', number: 15, name: 'Opus 5.5, effort max', extra: true, effort: 'max', settings: { model: 'claude-opus-5-5' } },
  { id: 'sonnet-low', number: 16, name: 'Sonnet 5.5, effort low', extra: true, settings: { model: 'claude-sonnet-5-5', effortLevel: 'low' } },
  { id: 'sonnet-medium', number: 17, name: 'Sonnet 5.5, effort medium', extra: true, settings: { model: 'claude-sonnet-5-5', effortLevel: 'medium' } },
  { id: 'sonnet-high', number: 18, name: 'Sonnet 5.5, effort high', extra: true, settings: { model: 'claude-sonnet-5-5', effortLevel: 'high' } },
  { id: 'sonnet-max', number: 19, name: 'Sonnet 5.5, effort max', extra: true, effort: 'max', settings: { model: 'claude-sonnet-5-5' } },
  // The numbers 20 to 99 are for the arms of an arms file.
  { id: 'haiku-low', number: 100, name: 'Haiku 5.5, effort low', extra: true, settings: { model: 'claude-haiku-5-5', effortLevel: 'low' } },
  { id: 'haiku-medium', number: 101, name: 'Haiku 5.5, effort medium', extra: true, settings: { model: 'claude-haiku-5-5', effortLevel: 'medium' } },
  { id: 'haiku-high', number: 102, name: 'Haiku 5.5, effort high', extra: true, settings: { model: 'claude-haiku-5-5', effortLevel: 'high' } },
  { id: 'haiku-xhigh', number: 103, name: 'Haiku 5.5, effort xhigh', extra: true, settings: { model: 'claude-haiku-5-5', effortLevel: 'xhigh' } },
  { id: 'haiku-max', number: 104, name: 'Haiku 5.5, effort max', extra: true, effort: 'max', settings: { model: 'claude-haiku-5-5' } },
  // Widal.Code on for another model: the tool advises from that arm's runs (bench/widal-on.mjs --arm <id>).
  { id: 'opus-widal-on', number: 105, name: 'Opus 5.5 xhigh, Widal.Code on', extra: true, from: 'opus-xhigh', plugin: true },
  { id: 'sonnet-widal-on', number: 106, name: 'Sonnet 5.5 xhigh, Widal.Code on', extra: true, from: 'sonnet-xhigh', plugin: true },
]

/** The effort levels of Claude Code, lowest first. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** The effort level an arm sets, or undefined when it leaves the level to Claude Code. */
export const effortOf = (arm) => arm.effort ?? arm.settings?.effortLevel

/** The arm that the others are compared with. */
export const BASELINE = 'fable-xhigh'

/** What an arm of an arms file may hold. */
const FILE_KEYS = ['id', 'number', 'name', 'agent', 'settings', 'only', 'pluginDir', 'tools', 'path', 'env', 'systemPrompt']
/** What only Claude Code can take: an arm that runs Codex has none of these. */
const CLAUDE_ONLY = ['pluginDir', 'tools', 'systemPrompt']

/**
 * Adds the arms of a file to the benchmark's own, for `--arms-file <file>`. This is how another
 * tool is run on the same tasks: the file is a JSON list of arms, and an arm can name
 * - `agent`: "codex" to run the tasks through Codex in place of Claude Code (bench/codex.mjs). The
 *   `model` and the `effortLevel` of its `settings` are then Codex's, and it takes no `pluginDir`,
 *   `tools` or `systemPrompt`;
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
    if (arm.agent !== undefined && arm.agent !== 'claude' && arm.agent !== 'codex') throw wrong('has an "agent" that is neither "claude" nor "codex"')
    if (arm.agent === 'codex') {
      const key = CLAUDE_ONLY.find((k) => arm[k] !== undefined)
      if (key) throw wrong(`runs Codex, which cannot take "${key}"`)
      if (arm.settings.effortLevel !== undefined && typeof arm.settings.effortLevel !== 'string') throw wrong('needs a text as the "effortLevel" of its settings')
    }
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
  // Codex reads its settings from a config.toml of its own (bench/codex.mjs): none of Claude Code's are added.
  if (arm.agent === 'codex') return { ...arm.settings }
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
