// The benchmark on public task sets, run through Harbor (bench/harbor/setup_agent.py): its results
// as records of the benchmark, and a report with 95% intervals.
//
//   node bench/harbor.mjs import --jobs <Harbor's jobs folder> --out <folder> [--arm <id>] [--rep 1]
//   node bench/harbor.mjs report --out <folder> [--baseline baseline] [--stage <name>]
//
// "import" reads every trial of Harbor's jobs folder (each one is a folder with a result.json) and
// writes one record per trial to <folder>/harbor/<arm>/<task>-r<rep>.json. The arm is the setup
// that the trial ran (Harbor's agent option "setup"), or --arm. A trial that ended on an error of
// the harness, not of the agent, is kept with that error and counts in no total.
//
// "report" sets each arm against the baseline on the tasks that both finished without such an
// error: the share of tasks solved, the cost and the time, each with a 95% interval, and a sign
// test. It prints Markdown and writes <folder>/harbor-results.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closedShare, ratioOfTotals, signTest } from './stats.mjs'

/** Every folder under `root` that holds a result.json of a trial, at any depth. */
function trialFolders(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (!statSync(path).isDirectory()) continue
      const result = join(path, 'result.json')
      if (existsSync(result) && isTrial(result)) out.push(path)
      else walk(path)
    }
  }
  walk(root)
  return out.sort()
}

function isTrial(file) {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'))
    return typeof r.task_name === 'string' && typeof r.trial_name === 'string'
  } catch {
    return false
  }
}

const seconds = (timing) => (timing?.started_at && timing?.finished_at ? (Date.parse(timing.finished_at) - Date.parse(timing.started_at)) / 1000 : null)

/** A file name for a task: Harbor's task names hold slashes and other signs. */
export const taskFile = (task) => task.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)

/**
 * The record of one trial of Harbor.
 * @param {object} r The trial's result.json.
 */
export function recordOf(r, { arm, rep = 1, extra = {} } = {}) {
  const agent = r.agent_result ?? {}
  const rewards = r.verifier_result?.rewards ?? null
  const reward = rewards ? (rewards.reward ?? Object.values(rewards)[0] ?? null) : null
  const setup = r.config?.agent?.kwargs?.setup
  // An error before the agent ran, or one of the harness, is not the agent's miss.
  const harnessError = r.exception_info && !(agent.cost_usd > 0) ? r.exception_info.exception_type : null
  return {
    v: 1,
    source: 'harbor',
    taskSet: r.config?.task?.source ?? r.source ?? null,
    task: r.task_name,
    arm: arm ?? setup ?? r.agent_info?.name ?? 'agent',
    rep,
    trial: r.trial_name,
    model: r.agent_info?.model_info?.name ?? r.config?.agent?.model_name ?? null,
    agentVersion: r.agent_info?.version ?? null,
    started: r.started_at ?? null,
    seconds: seconds(r.agent_execution),
    reward,
    closed: reward !== null && reward >= 1,
    cost: typeof agent.cost_usd === 'number' ? agent.cost_usd : null,
    tokens: { input: agent.n_input_tokens ?? null, cache: agent.n_cache_tokens ?? null, output: agent.n_output_tokens ?? null },
    error: r.exception_info?.exception_type ?? null,
    harnessError,
    ...extra,
  }
}

/** Reads every trial of a jobs folder and writes its record. Returns the records. */
export function importJobs(jobs, out, { arm, rep = 1, extra = {} } = {}) {
  const records = []
  for (const folder of trialFolders(jobs)) {
    const record = recordOf(JSON.parse(readFileSync(join(folder, 'result.json'), 'utf8')), { arm, rep, extra })
    const dir = join(out, 'harbor', record.arm)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${taskFile(record.task)}-r${rep}.json`), `${JSON.stringify(record, null, 2)}\n`)
    records.push(record)
  }
  return records
}

/** Every record under <out>/harbor. */
export function readRecords(out) {
  const root = join(out, 'harbor')
  if (!existsSync(root)) return []
  const records = []
  for (const arm of readdirSync(root).sort()) {
    const dir = join(root, arm)
    if (!statSync(dir).isDirectory()) continue
    for (const name of readdirSync(dir).sort()) if (name.endsWith('.json')) records.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
  }
  return records
}

const pct = (x) => `${Math.round(100 * x)}%`
const asChange = (ratio) => `${ratio < 1 ? '-' : '+'}${pct(Math.abs(ratio - 1))}`
const interval = (x) => (x ? `${asChange(x.ratio)} (${asChange(x.low)} to ${asChange(x.high)})` : 'n/a')
const chance = (t) => (t.chance === null ? 'n/a' : t.chance < 0.001 ? 'under 0.1%' : `${(100 * t.chance).toFixed(1)}%`)
const money = (x) => `$${x.toFixed(2)}`
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')

/** The report: each arm against the baseline, overall and per task set. */
export function report(records, { baseline = 'baseline', stage } = {}) {
  const usable = records.filter((r) => !r.harnessError && (!stage || r.stage === stage))
  const key = (r) => `${r.task}\u0000${r.rep}`
  const base = new Map(usable.filter((r) => r.arm === baseline).map((r) => [key(r), r]))
  const arms = [...new Set(usable.map((r) => r.arm))].sort((a, b) => (a === baseline ? -1 : b === baseline ? 1 : a.localeCompare(b)))
  const sets = [...new Set(usable.map((r) => r.taskSet ?? 'unknown'))].sort()
  const rowOf = (arm, filter = () => true) => {
    const mine = usable.filter((r) => r.arm === arm && filter(r))
    const pairs = mine.map((r) => ({ r, b: base.get(key(r)) })).filter((p) => p.b && filter(p.b))
    const priced = pairs.filter((p) => p.r.cost !== null && p.b.cost !== null)
    const timed = pairs.filter((p) => p.r.seconds !== null && p.b.seconds !== null)
    const solved = mine.filter((r) => r.closed).length
    return {
      arm,
      tasks: mine.length,
      solved,
      solvedShare: closedShare(solved, mine.length),
      cost: mine.reduce((n, r) => n + (r.cost ?? 0), 0),
      costPerSolved: solved ? mine.reduce((n, r) => n + (r.cost ?? 0), 0) / solved : null,
      paired: pairs.length,
      costRatio: arm === baseline ? null : ratioOfTotals(priced.map((p) => ({ a: p.r.cost, b: p.b.cost }))),
      costSign: arm === baseline ? null : signTest(priced.map((p) => ({ a: p.r.cost, b: p.b.cost }))),
      timeRatio: arm === baseline ? null : ratioOfTotals(timed.map((p) => ({ a: p.r.seconds, b: p.b.seconds }))),
      solvedBoth: pairs.filter((p) => p.r.closed && p.b.closed).length,
      solvedOnlyArm: pairs.filter((p) => p.r.closed && !p.b.closed).length,
      solvedOnlyBaseline: pairs.filter((p) => !p.r.closed && p.b.closed).length,
    }
  }
  const overall = arms.map((arm) => rowOf(arm))
  const bySet = sets.map((set) => ({ set, rows: arms.map((arm) => rowOf(arm, (r) => (r.taskSet ?? 'unknown') === set)) }))
  const failed = records.filter((r) => r.harnessError).map((r) => ({ arm: r.arm, task: r.task, rep: r.rep, error: r.harnessError }))
  return { baseline, arms: overall, bySet, failed }
}

/** The report as Markdown. */
export function markdown(result) {
  const lines = ['# Benchmark on public task sets', '']
  const head = ['arm', 'tasks', 'solved (95% interval)', 'cost', 'cost per solved task', 'cost against the baseline (95% interval)', 'tasks cheaper', 'chance', 'time against the baseline (95% interval)', 'solved only here / only by the baseline']
  const rows = (list) =>
    list.map((x) => [
      x.arm,
      String(x.tasks),
      `${x.solved} = ${pct(x.solvedShare.share)} (${pct(x.solvedShare.low)} to ${pct(x.solvedShare.high)})`,
      money(x.cost),
      x.costPerSolved === null ? 'n/a' : money(x.costPerSolved),
      x.costRatio ? interval(x.costRatio) : '',
      x.costSign ? `${x.costSign.less} of ${x.costSign.n}` : '',
      x.costSign ? chance(x.costSign) : '',
      x.timeRatio ? interval(x.timeRatio) : '',
      x.arm === result.baseline ? '' : `${x.solvedOnlyArm} / ${x.solvedOnlyBaseline}`,
    ])
  lines.push(`Each arm is set against "${result.baseline}" on the tasks that both ran. The intervals come from resampling the tasks. The chance is a sign test on the cost of each task.`, '')
  lines.push(table(head, rows(result.arms)), '')
  for (const s of result.bySet) {
    lines.push(`## ${s.set}`, '')
    lines.push(table(head, rows(s.rows)), '')
  }
  if (result.failed.length) {
    lines.push('## Trials that ended on an error of the harness', '', 'They count in no number above.', '')
    lines.push(table(['arm', 'task', 'rep', 'error'], result.failed.map((f) => [f.arm, f.task, String(f.rep), f.error])), '')
  }
  return lines.join('\n')
}

function flags(argv) {
  const f = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const name = argv[i].slice(2)
    f[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return f
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  const f = flags(rest)
  if (command === 'import' && typeof f.jobs === 'string' && typeof f.out === 'string') {
    const records = importJobs(f.jobs, f.out, { arm: typeof f.arm === 'string' ? f.arm : undefined, rep: Number(f.rep ?? 1) })
    console.log(`${records.length} trials read, ${records.filter((r) => r.harnessError).length} of them ended on an error of the harness.`)
  } else if (command === 'report' && typeof f.out === 'string') {
    const result = report(readRecords(f.out), { baseline: typeof f.baseline === 'string' ? f.baseline : 'baseline', stage: typeof f.stage === 'string' ? f.stage : undefined })
    writeFileSync(join(f.out, 'harbor-results.json'), `${JSON.stringify(result, null, 2)}\n`)
    console.log(markdown(result))
  } else {
    console.error('usage:\n  node bench/harbor.mjs import --jobs <folder> --out <folder> [--arm <id>] [--rep 1]\n  node bench/harbor.mjs report --out <folder> [--baseline baseline]')
    process.exit(1)
  }
}
