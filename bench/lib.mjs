// What the benchmark's scripts share: the folders of a benchmark run, and the command line's flags.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The root of this repository. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '')
/** Widal.Code's command line, from this repository. */
export const WIDAL = join(ROOT, 'cli', 'widal.mjs')

/** The flags of a command line: "--name value" pairs, and "--name" alone as true. */
export function flags(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[argv[i].slice(2)] = true
    else out[argv[i].slice(2)] = argv[++i]
  }
  return out
}

/** The folder that holds a benchmark run. It must be given: the runs write a lot and start agents. */
export function outDir(f = flags()) {
  if (typeof f.out !== 'string') throw new Error('Give the folder of the benchmark run: --out <folder>. Use a folder outside any git repository.')
  mkdirSync(f.out, { recursive: true })
  return realpathSync(f.out)
}

/** The folders of one benchmark run. */
export const paths = (out) => ({
  /**
   * The folder in which an arm's agents work. One folder per arm, so that an arm is one project in
   * the logs. A lane is a second folder of the same arm, so that two of its tasks can run at once.
   * The folder has the name of the sample project, or the name that a task of a tasks file gives.
   */
  work: (arm, lane, folder = 'ledger') => join(out, 'w', arm, ...(lane ? [`lane${lane}`] : []), folder),
  /** What an agent left behind, kept for the score. */
  kept: (arm, task, rep) => join(out, 'kept', arm, `${task}-r${rep}`),
  /** The record of one run: what Claude Code reported, and the score. */
  result: (arm, task, rep) => join(out, 'runs', arm, `${task}-r${rep}.json`),
  settings: (arm) => join(out, 'arms', `${arm}.settings.json`),
  /** A home of its own for Widal.Code per arm: nothing of the person's real setup is read or changed. */
  view: (arm) => ({ root: join(out, 'widal', arm), person: join(out, 'widal', arm, 'person'), home: join(out, 'widal', arm, 'home'), claude: join(out, 'widal', arm, 'claude') }),
  plugin: (arm) => join(out, 'plugin', arm),
})

/** The work folders of an arm that are there: its own, and those of each lane. */
export function workFolders(out, arm) {
  const root = join(out, 'w', arm)
  const foldersIn = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    } catch {
      // The arm has not run.
      return []
    }
  }
  const isLane = (name) => /^lane\w+$/.test(name)
  const names = foldersIn(root)
  return [...names.filter((name) => !isLane(name)).map((name) => join(root, name)), ...names.filter(isLane).flatMap((lane) => foldersIn(join(root, lane)).map((name) => join(root, lane, name)))]
}

/** The environment in which Widal.Code runs for an arm: its own home, tool folder and Claude Code folder. */
export function viewEnv(out, arm) {
  const v = paths(out).view(arm)
  for (const dir of [v.person, v.home, join(v.claude, 'projects')]) mkdirSync(dir, { recursive: true })
  return { ...process.env, HOME: v.person, USERPROFILE: v.person, WIDAL_HOME: v.home, CLAUDE_CONFIG_DIR: v.claude, CODEX_HOME: join(v.person, '.codex') }
}

/** The folder in which Claude Code keeps the logs of the sessions that ran in a folder. */
export function logFolder(cwd) {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(base, 'projects', realpathSync(cwd).replace(/[^A-Za-z0-9]/g, '-'))
}

export const readJson = (file, otherwise) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return otherwise
  }
}

export const writeJson = (file, data) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

/** What the agent of a run reported: Claude Code's result, or the numbers of a Codex session (bench/codex.mjs). */
export const agentOf = (run) => run.claude ?? run.codex

/**
 * The records of the runs of an arm, in the order of the tasks. A record with a "void" reason is a
 * run that does not count, for example because the task was wrong when it ran. Such runs are left
 * out, unless `all` is set.
 */
export function runsOf(out, arm, { all = false } = {}) {
  const dir = join(out, 'runs', arm)
  let names = []
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    // The arm has not run.
  }
  return names.map((name) => readJson(join(dir, name))).filter((r) => r && (all || !r.void)).sort((a, b) => a.taskNumber - b.taskNumber || a.rep - b.rep)
}

/**
 * Notes the set of tasks that a folder of a benchmark run holds, and fails when the folder holds
 * runs of another set. The ids of two sets can be the same, so one folder holds one set.
 */
export function oneTaskSet(out, set, own) {
  const file = join(out, 'task-set.txt')
  const before = existsSync(file) ? readFileSync(file, 'utf8').trim() : existsSync(join(out, 'runs')) ? own : undefined
  if (before !== undefined && before !== set) throw new Error(`The folder ${out} holds runs of the task set "${before}". Use another folder for the task set "${set}".`)
  return file
}
