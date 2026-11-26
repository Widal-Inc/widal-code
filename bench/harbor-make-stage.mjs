// Makes a stage file for bench/harbor-stage.mjs from the committed task lists, the oracle check and
// the stage files that came before, so that every stage of version 1 is made by code in this repository.
//
//   node bench/harbor-make-stage.mjs --name main --tasks bench/harbor/v1-tasks.json \
//     --oracle /opt/bench/oracle-summary.jsonl --exclude-from /opt/bench/stages/pilot.json \
//     --setups baseline,baseline-2,widal-on,widal-on-2 --model anthropic/claude-sonnet-5-5 --provider api \
//     --cap 500 --out /opt/bench/stages/main.json [--setups-file /opt/bench/setups/setups-v1.json]
//
// A stage is refused, and nothing is written, when it cannot be compared with its own baseline: when its
// reference setup is not among its setups, when the reference has fewer runs than another setup, or when
// a setup runs another model than the reference (see referenceOf and checkStage).
//
// Options:
//   --tasks         one or more task lists (comma), each {"tasks": [{"dataset", "task"}]}
//   --oracle        the oracle summary (one JSON line per trial): only tasks whose reference solution
//                   reached reward 1 are kept
//   --exclude-from  stage files (comma) whose tasks are left out, for example the pilot's, on which
//                   Widal.Code's setup is made
//   --per-set N     at most N tasks per task set, picked with the seed
//   --sample N      at most N tasks in all, picked with the seed (after --per-set)
//   --setups        setup ids (comma). An id ending in "-2" (or -3 ...) is the second (third) run of the
//                   setup without that ending: same arm, run number 2. "id=spec" makes the setup "id"
//                   a copy of the setup "spec" in --setups-file, written there if it is missing.
//   --reference     the id of the stage's own baseline among --setups. The report sets every other setup
//                   against it, and the safety rule compares with it. Without this option it is the
//                   first setup called "baseline" or with an id that ends in "-baseline", such as
//                   "opus-baseline". A stage that has neither is refused.
//   --compare-models   the stage is meant to compare models, so a setup may run another model than the
//                   reference. (--model gives every setup of a stage the same model, so today this
//                   check can only refuse a stage that other code passes to checkStage.)
//   --model, --provider, --agent   for every setup of the stage (one provider per stage)
//   --cap, --concurrency, --block-size, --seed
//   --disk-cleanup N   while the stage runs, Docker's build cache and the images that no container uses
//                   are removed whenever the disk is more than N percent full ("diskCleanup" in the
//                   stage file). For a machine that only runs the benchmark.
//   --budget        the most one session may spend, in dollars, for the copies this stage writes
//   --effort        the effort level of those copies (low, medium, high, xhigh, max)
//   --fast          those copies run in fast mode (Claude Opus 5.5 and Claude Fable 5.2, at twice the price)
//   --settings      a JSON object merged into the Claude Code settings of those copies, for example {"effortLevel": "xhigh"}
//   --env           a JSON object of variables for the agent, for example {"OPENAI_API_KEY": "${env:OPENAI_API_KEY}"}
//   --command       the command that starts Harbor for this provider (comma), default by provider
//   --codex         the version of Codex to install for setups with --agent codex
//   --base          the folder of records, jobs and setups on the runner (default /opt/bench)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shuffled, stageOf } from './harbor-stage.mjs'

const SEED = 20261122

/** The fields of a setup that only Claude Code reads (bench/harbor/codex_setup_agent.py refuses them). */
const CLAUDE_ONLY = ['settings', 'allowedTools', 'appendSystemPrompt', 'pluginDirs', 'budget', 'fastMode']

/** The tasks of the task lists that passed the oracle and are in no excluded stage. */
export function pickTasks({ lists, passed = null, excluded = [], perSet = null, sample = null, seed = SEED }) {
  const seen = new Set()
  let tasks = []
  for (const list of lists) {
    for (const t of list.tasks) {
      if (seen.has(t.task)) continue
      seen.add(t.task)
      tasks.push({ dataset: t.dataset, task: t.task })
    }
  }
  const skip = new Set(excluded)
  tasks = tasks.filter((t) => !skip.has(t.task) && (!passed || passed.has(t.task)))
  if (perSet) tasks = [...new Set(tasks.map((t) => t.dataset))].flatMap((d) => shuffled(tasks.filter((t) => t.dataset === d), seed).slice(0, perSet))
  if (sample && tasks.length > sample) tasks = shuffled(tasks, seed).slice(0, sample)
  return tasks
}

/** A setup id of the stage: "widal-on-2" is run 2 of the arm "widal-on"; "x=baseline" copies a spec. */
export function setupOf(entry, { model, provider, agent }) {
  const [id, spec] = entry.split('=')
  const m = /^(.*)-(\d+)$/.exec(id)
  const arm = m && Number(m[2]) >= 2 ? m[1] : id
  const rep = m && Number(m[2]) >= 2 ? Number(m[2]) : 1
  return { id, arm, rep, model, provider, ...(agent ? { agent } : {}), ...(spec ? { spec } : {}) }
}

/**
 * Makes sure every setup id of the stage has an entry in the file of setups: a run 2 copies its arm's
 * entry, and "id=spec" copies the entry "spec". A copy for Codex keeps only what Codex reads. Returns the
 * ids it added.
 */
export function addCopies(file, setups, { budget = null, settings = null, effort = null, fast = false } = {}) {
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const byId = new Map(doc.setups.map((s) => [s.id, s]))
  const added = []
  for (const s of setups) {
    if ((s.agent && s.agent !== 'codex') || byId.has(s.id)) continue
    const from = byId.get(s.spec ?? s.arm)
    if (!from) throw new Error(`The file of setups has no setup "${s.spec ?? s.arm}" to copy for "${s.id}".`)
    const copy = { ...structuredClone(from), id: s.id, name: `${from.name}${s.rep > 1 ? ` (run ${s.rep})` : ''}` }
    if (effort !== null) copy.effort = effort
    if (s.agent === 'codex') {
      // Codex reads only the commands, uploads, variables and effort of a setup: the block of GitHub
      // comes with the commands, and a field that only Claude Code reads is left out.
      for (const key of CLAUDE_ONLY) delete copy[key]
      copy.name = `${copy.name}, run by Codex`
    } else {
      if (budget !== null) copy.budget = budget
      if (fast) copy.fastMode = true
      if (settings) copy.settings = { ...(copy.settings ?? {}), ...settings, env: { ...(copy.settings?.env ?? {}), ...(settings.env ?? {}) } }
    }
    doc.setups.push(copy)
    byId.set(s.id, copy)
    added.push(s.id)
  }
  if (added.length) writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`)
  return added
}

/**
 * The id of the reference setup of a stage, which is the stage's own baseline: the one named with
 * --reference, or else the first setup called "baseline" or with an id that ends in "-baseline".
 * @returns {string | null} null when no setup is named and none has such an id.
 */
export function referenceOf(setups, named = null) {
  return named ?? setups.find((s) => /(^|-)baseline$/.test(s.id))?.id ?? null
}

/**
 * Refuses a stage that cannot be compared with its own baseline. The reference setup is that baseline:
 * the report sets every other setup against it, a run against the same run number. So the reference
 * must be among the setups, it must have every run number that another setup has, and every setup must
 * run the reference's model, unless the stage is meant to compare models. Each error names the setup
 * that is missing or differs.
 * @param {{name: string, reference: string | null, setups: {id: string, arm: string, rep: number, model: string}[]}} stage
 * @param {{compareModels?: boolean}} [options]
 */
export function checkStage({ name, reference, setups }, { compareModels = false } = {}) {
  const ids = setups.map((s) => s.id).join(', ')
  const why = "The reference setup is the stage's own baseline: every other setup of the stage is set against it."
  if (!reference) throw new Error(`The stage "${name}" has no baseline among its setups (${ids}): no setup is called "baseline" or has an id that ends in "-baseline". ${why} Add the missing setup "baseline" to --setups, or name the baseline of this stage with --reference.`)
  const ref = setups.find((s) => s.id === reference)
  if (!ref) throw new Error(`The stage "${name}" has no setup "${reference}" (its setups: ${ids}). ${why} Add the missing setup "${reference}" to --setups, or name another setup with --reference.`)
  const runs = new Set(setups.filter((s) => s.arm === ref.arm).map((s) => s.rep))
  const more = setups.filter((s) => s.arm !== ref.arm && !runs.has(s.rep))
  if (more.length) {
    const missing = [...new Set(more.map((s) => s.rep))].sort((a, b) => a - b).map((n) => (n === 1 ? ref.arm : `${ref.arm}-${n}`))
    throw new Error(`The stage "${name}" has no setup ${missing.map((id) => `"${id}"`).join(', ')}: the reference "${ref.arm}" has fewer runs than ${[...new Set(more.map((s) => `"${s.arm}"`))].join(', ')}. A run is compared with the reference's run of the same number. Add ${missing.map((id) => `"${id}"`).join(', ')} to --setups.`)
  }
  const other = setups.filter((s) => s.model !== ref.model)
  if (other.length && !compareModels) throw new Error(`The stage "${name}" has setups that run another model than the reference "${ref.id}" (${ref.model}): ${other.map((s) => `"${s.id}" (${s.model})`).join(', ')}. A setup is compared with a baseline on the same model. Pass --compare-models if the stage is meant to compare models.`)
}

function flags(argv) {
  const f = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) f[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  return f
}

function main() {
  const f = flags(process.argv.slice(2))
  for (const key of ['name', 'tasks', 'setups', 'model', 'provider', 'cap', 'out']) if (typeof f[key] !== 'string') throw new Error(`--${key} is needed.`)
  const base = f.base ?? '/opt/bench'
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
  const passed = f.oracle
    ? new Set(readFileSync(f.oracle, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.reward === 1).map((r) => r.task))
    : null
  const excluded = (f['exclude-from'] ?? '').split(',').filter(Boolean).flatMap((file) => read(file).tasks.map((t) => t.task))
  const tasks = pickTasks({
    lists: f.tasks.split(',').map(read),
    passed,
    excluded,
    perSet: f['per-set'] ? Number(f['per-set']) : null,
    sample: f.sample ? Number(f.sample) : null,
    seed: Number(f.seed ?? SEED),
  })
  const setups = f.setups.split(',').map((e) => setupOf(e, { model: f.model, provider: f.provider, agent: f.agent }))
  const reference = referenceOf(setups, typeof f.reference === 'string' ? f.reference : null)
  // Checked before anything is written, so a refused stage leaves no stage file and no copy of a setup.
  checkStage({ name: f.name, reference, setups }, { compareModels: f['compare-models'] === true })
  const setupsFile = f['setups-file'] ?? join(base, 'setups', 'setups-v1.json')
  if (existsSync(setupsFile)) {
    const added = addCopies(setupsFile, setups, { budget: f.budget ? Number(f.budget) : null, settings: f.settings ? JSON.parse(f.settings) : null, effort: typeof f.effort === 'string' ? f.effort : null, fast: f.fast === true })
    if (added.length) console.log(`added to ${setupsFile}: ${added.join(', ')}`)
  }
  const commands = {
    api: [join(base, 'with-key.sh'), join(base, 'harbor.sh')],
    bedrock: [join(base, 'with-bedrock.sh'), join(base, 'harbor.sh')],
    openai: [join(base, 'with-openai.sh'), join(base, 'harbor.sh')],
  }
  const stage = {
    name: f.name,
    out: join(base, 'v1'),
    jobs: join(base, 'jobs'),
    setupsFile,
    claudeCode: f['claude-code'] ?? '2.1.330',
    ...(f.codex ? { codex: f.codex } : {}),
    commands: { [f.provider]: f.command ? f.command.split(',') : commands[f.provider] },
    env: f.env ? { [f.provider]: JSON.parse(f.env) } : {},
    setups: setups.map(({ spec, ...s }) => s),
    reference,
    tasks,
    blockSize: Number(f['block-size'] ?? 25),
    seed: Number(f.seed ?? SEED),
    concurrency: Number(f.concurrency ?? 4),
    cap: Number(f.cap),
    providerCaps: { api: 1500, bedrock: 1500, openai: Number(f['openai-cap'] ?? 500) },
    ...(f['disk-cleanup'] ? { diskCleanup: { above: Number(f['disk-cleanup']) } } : {}),
  }
  // The stage runner would refuse the file for the same reasons when the stage starts.
  stageOf(stage)
  writeFileSync(f.out, `${JSON.stringify(stage, null, 1)}\n`)
  console.log(`${f.name}: ${tasks.length} tasks${passed ? ' that passed the oracle' : ''}${excluded.length ? `, ${excluded.length} excluded` : ''}; setups ${setups.map((s) => s.id).join(', ')}; cap $${f.cap}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
