// The benchmark on public task sets, run through Harbor (bench/harbor/setup_agent.py): its results
// as records of the benchmark, and a report with 95% intervals.
//
//   node bench/harbor.mjs import --jobs <Harbor's jobs folder> --out <folder> [--arm <id>] [--rep 1]
//   node bench/harbor.mjs report --out <folder> [--baseline baseline] [--stage <name> | --stages a,b] [--unranked a,b] [--margin 0.03] [--exclude <stage file>]
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
import { cost as callCost } from '../src/prices.mjs'
import { closedShare, clusteredRatio, clusteredSolvedDifference, holm, repeatNoise, taskSignTest } from './stats.mjs'

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
  const model = r.agent_info?.model_info?.name ?? r.config?.agent?.model_name ?? null
  const spend = costOf(agent, model)
  // An error before the agent ran, or one of the harness, is not the agent's miss. A trial that spent
  // money ran the agent, also when the cost comes from its tokens (Codex reports none).
  const harnessError = r.exception_info && !(spend.cost > 0) ? r.exception_info.exception_type : null
  return {
    v: 1,
    source: 'harbor',
    taskSet: r.config?.task?.source ?? r.source ?? null,
    task: r.task_name,
    arm: arm ?? setup ?? r.agent_info?.name ?? 'agent',
    rep,
    trial: r.trial_name,
    model,
    agentVersion: r.agent_info?.version ?? null,
    started: r.started_at ?? null,
    seconds: seconds(r.agent_execution),
    reward,
    closed: reward !== null && reward >= 1,
    ...spend,
    tokens: { input: agent.n_input_tokens ?? null, cache: agent.n_cache_tokens ?? null, output: agent.n_output_tokens ?? null },
    error: r.exception_info?.exception_type ?? null,
    harnessError,
    ...extra,
  }
}

/**
 * The cost of a trial: what the agent reported, or, when it reported none but counted its tokens (Harbor's
 * Codex agent leaves the cost empty for a model its price list does not know), the cost worked out from
 * the tokens at Widal.Code's list prices. Input that is not read from the cache is priced as uncached
 * input, because Harbor does not count cache writes apart, and at the price of prompts under the
 * long-prompt limit, because the sizes of single calls are not known; `costSource` says which one it is.
 */
export function costOf(agent, model) {
  if (typeof agent.cost_usd === 'number') return { cost: agent.cost_usd, costSource: 'reported' }
  const input = agent.n_input_tokens
  const cache = agent.n_cache_tokens ?? 0
  const output = agent.n_output_tokens
  if (typeof input !== 'number' || typeof output !== 'number' || !model) return { cost: null, costSource: null }
  // The tokens are the sum of the trial's calls, so the price of long prompts (which depends on each
  // call's prompt) is not applied: `sum` says so.
  const c = callCost({ m: model.replace(/^[a-z-]+\//, ''), in: Math.max(0, input - cache), w5: 0, w1: 0, cr: cache, out: output, sum: true })
  return c.known ? { cost: c.total, costSource: 'tokens' } : { cost: null, costSource: null }
}

/**
 * Reads every trial of a jobs folder and writes its record. Returns the records it wrote.
 *
 * With `setup`, a trial whose own setup (Harbor's agent option "setup") is another one is skipped: two
 * runs of one arm must never be filed as each other. A record of a trial that finished is never replaced
 * by one that ended on an error of the harness, so running a block again after a failure keeps what was done.
 */
export function importJobs(jobs, out, { arm, rep = 1, setup = null, extra = {} } = {}) {
  const records = []
  for (const folder of trialFolders(jobs)) {
    const result = JSON.parse(readFileSync(join(folder, 'result.json'), 'utf8'))
    const own = result.config?.agent?.kwargs?.setup
    if (setup && own && own !== setup) continue
    const record = recordOf(result, { arm, rep, extra })
    const dir = join(out, 'harbor', record.arm)
    const file = join(dir, `${taskFile(record.task)}-r${rep}.json`)
    if (record.harnessError && existsSync(file) && !JSON.parse(readFileSync(file, 'utf8')).harnessError) continue
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
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
const points = (x) => `${x > 0 ? '+' : ''}${(100 * x).toFixed(1)}`
const asChange = (ratio) => `${ratio < 1 ? '-' : '+'}${pct(Math.abs(ratio - 1))}`
const interval = (x) => (x ? `${asChange(x.ratio)} (${asChange(x.low)} to ${asChange(x.high)})` : 'n/a')
const chance = (t) => (t.chance === null ? 'n/a' : t.chance < 0.001 ? 'under 0.1%' : `${(100 * t.chance).toFixed(1)}%`)
const money = (x) => `$${x.toFixed(2)}`
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')

/**
 * The report: each arm against the baseline, overall and per task set.
 *
 * Runs are paired by task and run number (an arm's run 2 of a task with the baseline's run 2), and
 * every interval resamples tasks first and then the runs inside each task, so a task counts once
 * however many runs it has. Options (pre-registration, changes of 22 Nov 2026):
 * - stages: the stages whose records count, for example ["main", "quality"]; `stage` is one stage.
 * - unranked: arms reported in a table of their own, without a rank or a test against the others,
 *   for example a tool that ran with one of its features turned off.
 * - margin: the quality margin in points (0.03 for 3 points); an arm keeps quality when the lower end
 *   of the interval of its solved difference lies above minus the margin.
 * - exclude: task names that count in no number (the tasks Widal.Code was tuned on).
 * The chance of the cost test is corrected with Holm's method over the ranked arms.
 */
export function report(records, { baseline = 'baseline', stage, stages, unranked = [], margin = null, exclude = [] } = {}) {
  const want = stages ?? (stage ? [stage] : null)
  const skip = new Set(exclude)
  const usable = records.filter((r) => !r.harnessError && (!want || want.includes(r.stage)) && !skip.has(r.task))
  const key = (r) => `${r.task}\u0000${r.rep}`
  const base = new Map(usable.filter((r) => r.arm === baseline).map((r) => [key(r), r]))
  const arms = [...new Set(usable.map((r) => r.arm))].sort((a, b) => (a === baseline ? -1 : b === baseline ? 1 : a.localeCompare(b)))
  const sets = [...new Set(usable.map((r) => r.taskSet ?? 'unknown'))].sort()
  const grouped = (pairs, pick) => {
    const byTask = new Map()
    for (const p of pairs) byTask.set(p.r.task, [...(byTask.get(p.r.task) ?? []), pick(p)])
    return [...byTask.values()]
  }
  const rowOf = (arm, filter = () => true) => {
    const mine = usable.filter((r) => r.arm === arm && filter(r))
    const pairs = mine.map((r) => ({ r, b: base.get(key(r)) })).filter((p) => p.b && filter(p.b))
    const priced = pairs.filter((p) => p.r.cost !== null && p.b.cost !== null)
    const timed = pairs.filter((p) => p.r.seconds !== null && p.b.seconds !== null)
    const solved = mine.filter((r) => r.closed).length
    const cost = mine.reduce((n, r) => n + (r.cost ?? 0), 0)
    const other = arm !== baseline
    return {
      arm,
      tasks: new Set(mine.map((r) => r.task)).size,
      runs: mine.length,
      solved,
      solvedShare: closedShare(solved, mine.length),
      cost,
      costPerSolved: solved ? cost / solved : null,
      paired: pairs.length,
      costRatio: other ? clusteredRatio(grouped(priced, (p) => ({ a: p.r.cost, b: p.b.cost }))) : null,
      costSign: other ? taskSignTest(grouped(priced, (p) => ({ a: p.r.cost, b: p.b.cost }))) : null,
      timeRatio: other ? clusteredRatio(grouped(timed, (p) => ({ a: p.r.seconds, b: p.b.seconds }))) : null,
      solvedDiff: other ? clusteredSolvedDifference(grouped(pairs, (p) => ({ a: p.r.closed, b: p.b.closed }))) : null,
      solvedBoth: pairs.filter((p) => p.r.closed && p.b.closed).length,
      solvedOnlyArm: pairs.filter((p) => p.r.closed && !p.b.closed).length,
      solvedOnlyBaseline: pairs.filter((p) => !p.r.closed && p.b.closed).length,
    }
  }
  const withVerdicts = (rows) => {
    const ranked = rows.filter((x) => x.arm !== baseline && !unranked.includes(x.arm))
    const adjusted = holm(ranked.map((x) => x.costSign?.chance ?? null))
    ranked.forEach((x, i) => (x.costChanceHolm = adjusted[i]))
    for (const x of rows) {
      if (x.arm === baseline || !x.solvedDiff || margin === null) continue
      x.keepsQuality = x.solvedDiff.low > -margin
    }
    return rows
  }
  const all = withVerdicts(arms.map((arm) => rowOf(arm)))
  const overall = all.filter((x) => !unranked.includes(x.arm))
  const notRanked = all.filter((x) => unranked.includes(x.arm))
  const bySet = sets.map((set) => ({ set, rows: arms.filter((a) => !unranked.includes(a)).map((arm) => rowOf(arm, (r) => (r.taskSet ?? 'unknown') === set)) }))
  const failed = records.filter((r) => r.harnessError && (!want || want.includes(r.stage))).map((r) => ({ arm: r.arm, task: r.task, rep: r.rep, error: r.harnessError }))
  const noise = repeatNoise(usable.filter((r) => r.arm === baseline))
  return { baseline, stages: want, margin, excluded: skip.size, arms: overall, unranked: notRanked, bySet, failed, noise }
}

/** The report as Markdown. */
export function markdown(result) {
  const lines = ['# Benchmark on public task sets', '']
  const head = ['arm', 'tasks', 'runs', 'solved (95% interval)', 'solved against the baseline, points (95% interval)', 'cost', 'cost per solved task', 'cost against the baseline (95% interval)', 'tasks cheaper', 'chance', 'chance, Holm', 'time against the baseline (95% interval)', 'solved only here / only by the baseline']
  if (result.margin !== null && result.margin !== undefined) head.push(`keeps quality (margin ${(100 * result.margin).toFixed(0)} points)`)
  const rows = (list) =>
    list.map((x) => {
      const row = [
        x.arm,
        String(x.tasks),
        String(x.runs),
        `${x.solved} = ${pct(x.solvedShare.share)} (${pct(x.solvedShare.low)} to ${pct(x.solvedShare.high)})`,
        x.solvedDiff ? `${points(x.solvedDiff.difference)} (${points(x.solvedDiff.low)} to ${points(x.solvedDiff.high)})` : '',
        money(x.cost),
        x.costPerSolved === null ? 'n/a' : money(x.costPerSolved),
        x.costRatio ? interval(x.costRatio) : '',
        x.costSign ? `${x.costSign.less} of ${x.costSign.n}` : '',
        x.costSign ? chance(x.costSign) : '',
        x.costChanceHolm === undefined || x.costChanceHolm === null ? '' : chance({ chance: x.costChanceHolm }),
        x.timeRatio ? interval(x.timeRatio) : '',
        x.arm === result.baseline ? '' : `${x.solvedOnlyArm} / ${x.solvedOnlyBaseline}`,
      ]
      if (result.margin !== null && result.margin !== undefined) row.push(x.keepsQuality === undefined ? '' : x.keepsQuality ? 'yes' : 'not shown')
      return row
    })
  lines.push(`Each arm is set against "${result.baseline}" on the runs that both made, paired by task and run number. The intervals resample the tasks, then the runs inside each task. The chance is a sign test on each task's mean cost; "chance, Holm" corrects it for the number of ranked arms.${result.stages ? ` Stages: ${result.stages.join(', ')}.` : ''}${result.excluded ? ` ${result.excluded} tasks are left out because a setup was tuned on them.` : ''}`, '')
  lines.push(table(head, rows(result.arms)), '')
  if (result.unranked?.length) {
    lines.push('## Reported, not ranked', '', 'These arms ran under a condition that makes a fair rank impossible, so they get no Holm chance and no place in the ranking.', '')
    lines.push(table(head, rows(result.unranked)), '')
  }
  if (result.noise?.tasks) {
    const n = result.noise
    lines.push('## Noise between two runs of the baseline', '')
    lines.push(`On ${n.tasks} tasks run twice by the baseline, ${pct(n.discordance)} were solved in one run only, and the log cost ratio between the two runs has a standard deviation of ${n.costSpread === null ? 'n/a' : n.costSpread.toFixed(2)}.`, '')
  }
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
    const list = (x) => (typeof x === 'string' ? x.split(',').filter(Boolean) : undefined)
    const exclude = typeof f.exclude === 'string' ? JSON.parse(readFileSync(f.exclude, 'utf8')).tasks.map((t) => t.task ?? t) : []
    const result = report(readRecords(f.out), {
      baseline: typeof f.baseline === 'string' ? f.baseline : 'baseline',
      stage: typeof f.stage === 'string' ? f.stage : undefined,
      stages: list(f.stages),
      unranked: list(f.unranked) ?? [],
      margin: typeof f.margin === 'string' ? Number(f.margin) : null,
      exclude,
    })
    writeFileSync(join(f.out, 'harbor-results.json'), `${JSON.stringify(result, null, 2)}\n`)
    console.log(markdown(result))
  } else {
    console.error('usage:\n  node bench/harbor.mjs import --jobs <folder> --out <folder> [--arm <id>] [--rep 1]\n  node bench/harbor.mjs report --out <folder> [--baseline baseline] [--stage <name> | --stages a,b] [--unranked a,b] [--margin 0.03] [--exclude <stage file>]')
    process.exit(1)
  }
}
