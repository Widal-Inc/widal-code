// The analysis of the stage "effort" (bench/PREREGISTRATION.md, change 7), written and committed before
// the stage has a result. It prints every number the registered plan names, in the plan's order, as
// Markdown.
//
//   node bench/harbor/v1-effort/analyze.mjs --records <the stage's "out" folder> --jobs <the stage's "jobs" folder> [--json <file>]
//
// For a dry run on the records of another stage (the test of 25 Nov 2026, the harness check of 26 Nov
// 2026), the stage, its two setups and their effort levels can be named:
//   --stage lean-pilot --base lp-sonnet-lean --low lp-sonnet-lean-low [--base-level medium] [--low-level low]
//
// The records are harbor/<setup>/<task>-r1.json in the "out" folder (bench/harbor.mjs writes them). The
// jobs folder holds Harbor's trial folders, <jobs>/<stage>/<setup>/block-<n>/<job>/<trial>, with Claude
// Code's own output and session files of each trial. From them the analysis reads the effort level
// that each request of a session ran at, the prompt tokens of the first request and the number of
// requests. A pair of setups is compared on the tasks that both ran without an error of the harness.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ratioOfTotals, signTest, solvedDifference, typicalRatio } from '../../stats.mjs'

export const STAGE = 'effort'
export const BASE = 'effort-base'
export const LOW = 'effort-low'
/** The effort level each setup must run at: Claude Code 2.1.330 starts Sonnet 5.5 at medium. */
export const LEVEL = { [BASE]: 'medium', [LOW]: 'low' }

const sum = (list) => list.reduce((n, x) => n + x, 0)
const median = (list) => {
  const s = [...list].sort((a, b) => a - b)
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null
}
const pct = (ratio) => `${ratio < 1 ? '-' : '+'}${Math.abs((ratio - 1) * 100).toFixed(1)}%`
const interval = (x) => (x ? `${pct(x.ratio)} (${pct(x.low)} to ${pct(x.high)})` : 'n/a')
const points = (x) => (x ? `${(x.difference * 100).toFixed(1)} (${(x.low * 100).toFixed(1)} to ${(x.high * 100).toFixed(1)})` : 'n/a')
const money = (n) => `$${n.toFixed(2)}`
const count = (o) => (Object.keys(o).length ? Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(', ') : '0')
const solved = (r) => r.reward === 1

/**
 * The records of one setup. A record that ended on an error of the harness, or that has no cost, counts
 * in no number and is listed by the kind of its error.
 */
export function loadSetup(records, setup, stage = STAGE) {
  const dir = join(records, 'harbor', setup)
  const byTask = new Map()
  const errors = {}
  let all = 0
  for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!file.endsWith('.json')) continue
    const r = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    if (r.stage !== stage) continue
    all++
    if (r.harnessError) {
      errors[r.harnessError] = (errors[r.harnessError] ?? 0) + 1
      continue
    }
    if (!(r.cost > 0)) {
      errors['no cost'] = (errors['no cost'] ?? 0) + 1
      continue
    }
    if (byTask.has(r.task)) throw new Error(`Two records of ${r.task} in ${setup}.`)
    byTask.set(r.task, r)
  }
  return { setup, byTask, errors, all }
}

/** The trial folders of one setup, by the name of the trial. */
function trialFolders(jobs, setup, stage) {
  const found = new Map()
  const root = join(jobs, stage, setup)
  const folders = (dir) => (existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)).filter((p) => statSync(p).isDirectory()) : [])
  for (const block of folders(root)) for (const job of folders(block)) for (const trial of folders(job)) found.set(trial.split('/').pop(), trial)
  return found
}

/** Every file below a folder whose name ends in .jsonl. */
function sessionFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sessionFiles(join(dir, e.name)) : e.name.endsWith('.jsonl') ? [join(dir, e.name)] : []))
}

/**
 * What happened inside one trial, from Claude Code's own files: the effort level of each request that
 * the session files record ("api-request", params.output_config.effort), the prompt tokens of the first
 * request and the number of requests of the main session (from the session's output, one JSON object
 * per line).
 */
export function sessionOf(trial) {
  const efforts = {}
  for (const file of sessionFiles(join(trial, 'agent', 'sessions'))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"api-request"')) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.type !== 'api-request') continue
      const level = o.params?.output_config?.effort ?? 'none'
      efforts[level] = (efforts[level] ?? 0) + 1
    }
  }
  let first = null
  const requests = new Set()
  const output = join(trial, 'agent', 'claude-code.txt')
  if (existsSync(output)) {
    for (const line of readFileSync(output, 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.type !== 'assistant' || o.parent_tool_use_id) continue
      const id = o.message?.id
      if (!id || requests.has(id)) continue
      requests.add(id)
      const u = o.message.usage ?? {}
      first ??= (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    }
  }
  return { efforts, first, requests: requests.size }
}

/** Two setups on the tasks both ran: every measure of the plan. `only` keeps the tasks of one task set. */
export function compare(a, b, { session = () => null, only = null } = {}) {
  const tasks = [...a.byTask.keys()].filter((t) => b.byTask.has(t) && (!only || only(a.byTask.get(t)))).sort()
  const A = tasks.map((t) => a.byTask.get(t))
  const B = tasks.map((t) => b.byTask.get(t))
  const of = (f) => tasks.map((_, i) => ({ a: f(A[i]), b: f(B[i]) }))
  const cost = of((r) => r.cost)
  const out = {
    setup: a.setup,
    against: b.setup,
    tasks: tasks.length,
    costA: sum(A.map((r) => r.cost)),
    costB: sum(B.map((r) => r.cost)),
    totals: tasks.length ? ratioOfTotals(cost) : null,
    typical: tasks.length ? typicalRatio(cost) : null,
    sign: signTest(cost),
    solvedA: A.filter(solved).length,
    solvedB: B.filter(solved).length,
    solved: tasks.length ? solvedDifference(of(solved)) : null,
    onlyA: tasks.filter((_, i) => solved(A[i]) && !solved(B[i])),
    onlyB: tasks.filter((_, i) => !solved(A[i]) && solved(B[i])),
    input: tasks.length ? ratioOfTotals(of((r) => r.tokens?.input)) : null,
    output: tasks.length ? ratioOfTotals(of((r) => r.tokens?.output)) : null,
    seconds: tasks.length ? ratioOfTotals(of((r) => r.seconds)) : null,
    endedA: {},
    endedB: {},
  }
  out.perSolvedA = out.solvedA ? out.costA / out.solvedA : null
  out.perSolvedB = out.solvedB ? out.costB / out.solvedB : null
  for (const r of A) if (r.error) out.endedA[r.error] = (out.endedA[r.error] ?? 0) + 1
  for (const r of B) if (r.error) out.endedB[r.error] = (out.endedB[r.error] ?? 0) + 1
  const SA = A.map(session)
  const SB = B.map(session)
  const have = tasks.map((_, i) => i).filter((i) => SA[i]?.requests && SB[i]?.requests)
  if (have.length) {
    out.first = { sessions: have.length, a: median(have.map((i) => SA[i].first)), b: median(have.map((i) => SB[i].first)) }
    out.requests = { a: sum(have.map((i) => SA[i].requests)) / have.length, b: sum(have.map((i) => SB[i].requests)) / have.length, ratio: ratioOfTotals(have.map((i) => ({ a: SA[i].requests, b: SB[i].requests }))) }
  }
  return out
}

function table(c) {
  const chance = c.sign.chance === null ? 'n/a' : c.sign.chance < 0.0001 ? 'below 0.0001' : c.sign.chance.toFixed(4)
  const rows = [
    '| Measure | Result |',
    '| --- | --- |',
    `| Tasks both ran | ${c.tasks} |`,
    `| Cost of these tasks | ${money(c.costA)} against ${money(c.costB)} |`,
    `| Cost, ratio of the totals (95% interval) | ${interval(c.totals)} |`,
    `| Cost of a typical task, geometric mean of the per-task ratios (95% interval) | ${interval(c.typical)} |`,
    `| Tasks that cost less | ${c.sign.less} of ${c.sign.n} (sign test, chance ${chance}) |`,
    `| Solved | ${c.solvedA} of ${c.tasks} against ${c.solvedB} of ${c.tasks} |`,
    `| Solved, difference in points (95% interval) | ${points(c.solved)} |`,
    `| Solved by one side only | ${c.onlyA.length} by ${c.setup}, ${c.onlyB.length} by ${c.against} |`,
    `| Cost per solved task | ${c.perSolvedA === null ? 'n/a' : money(c.perSolvedA)} against ${c.perSolvedB === null ? 'n/a' : money(c.perSolvedB)} |`,
    `| Output tokens, ratio of the totals (95% interval) | ${interval(c.output)} |`,
    `| Input tokens, ratio of the totals (95% interval) | ${interval(c.input)} |`,
    `| Session time, ratio of the totals (95% interval) | ${interval(c.seconds)} |`,
    `| Sessions that ended on a limit or an error of the agent | ${count(c.endedA)} against ${count(c.endedB)} |`,
  ]
  if (c.first) {
    rows.push(`| Prompt tokens of the first request, median | ${c.first.a} against ${c.first.b} (${c.first.sessions} sessions on both sides) |`)
    rows.push(`| Requests per session, mean | ${c.requests.a.toFixed(1)} against ${c.requests.b.toFixed(1)}; ratio of the totals ${interval(c.requests.ratio)} |`)
  }
  return rows.join('\n')
}

/**
 * The whole analysis: the Markdown text and the numbers behind it.
 * @param {{records: string, jobs?: string | null, stage?: string, base?: string, low?: string, levels?: Record<string, string>}} options
 *   The stage's "out" folder and its "jobs" folder. The other options are for a dry run on another stage.
 */
export function analysis({ records, jobs = null, stage = STAGE, base = BASE, low = LOW, levels = null }) {
  const expected = levels ?? { [base]: LEVEL[BASE], [low]: LEVEL[LOW] }
  const S = { [base]: loadSetup(records, base, stage), [low]: loadSetup(records, low, stage) }
  const sessions = new Map()
  const folders = jobs ? { [base]: trialFolders(jobs, base, stage), [low]: trialFolders(jobs, low, stage) } : null
  const session = (r) => {
    const key = `${r.arm} ${r.trial}`
    if (!sessions.has(key)) {
      const folder = folders?.[r.arm]?.get(r.trial)
      sessions.set(key, folder ? sessionOf(folder) : null)
    }
    return sessions.get(key)
  }
  const out = []
  const data = { setups: {} }

  // 0. What ran, and the effort level that each request ran at.
  out.push('## What ran', '', '| Setup | Records | Counted | Errors of the harness | Cost of the counted | Solved | Sessions read | Requests by effort level | Sessions with a request at another level than the setup\'s |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const s of Object.values(S)) {
    const list = [...s.byTask.values()]
    const read = list.map((r) => ({ r, s: session(r) })).filter((x) => x.s)
    const efforts = {}
    for (const x of read) for (const [level, n] of Object.entries(x.s.efforts)) efforts[level] = (efforts[level] ?? 0) + n
    const withLevel = read.filter((x) => Object.keys(x.s.efforts).length)
    const other = withLevel.filter((x) => Object.keys(x.s.efforts).some((level) => level !== expected[s.setup])).map((x) => x.r.task)
    data.setups[s.setup] = { records: s.all, counted: list.length, errors: s.errors, cost: sum(list.map((r) => r.cost)), solved: list.filter(solved).length, sessionsRead: read.length, sessionsWithLevel: withLevel.length, efforts, otherLevel: other }
    out.push(`| ${s.setup} | ${s.all} | ${list.length} | ${count(s.errors)} | ${money(sum(list.map((r) => r.cost)))} | ${list.filter(solved).length} of ${list.length} | ${read.length} | ${count(efforts)} | ${other.length} of ${withLevel.length} |`)
  }
  out.push('')
  const levelHeld = Object.values(data.setups).every((x) => x.sessionsWithLevel > 0 && x.otherLevel.length === 0)
  out.push(`The setups ran at their effort level (\`${base}\` at ${expected[base]}, \`${low}\` at ${expected[low]}) in every session whose files were read: ${jobs ? (levelHeld ? 'yes' : 'no') : 'not checked, no jobs folder was given'}.`, '')
  for (const [setup, x] of Object.entries(data.setups)) if (x.otherLevel.length) out.push(`Sessions of \`${setup}\` with a request at another level: ${x.otherLevel.join(', ')}.`, '')

  // 1 to 3. The primary measure, the named secondary measure and the check.
  const primary = compare(S[low], S[base], { session })
  const models = [...new Set([...S[base].byTask.values(), ...S[low].byTask.values()].map((r) => r.model))].sort()
  out.push(`## Primary: ${low} against ${base} (${models.join(', ') || 'no records'})`, '', table(primary), '')
  const proven = Boolean(primary.totals && primary.totals.high < 1)
  out.push(`Primary measure (ratio of the totals): ${proven ? 'the upper end of the interval is below 1, so the saving counts as proven' : 'the interval includes no change, so the saving is not shown'}.`, '')
  const lower = Boolean(primary.solved && primary.solved.high < 0)
  const margin = primary.solved ? Math.max(Math.abs(primary.solved.difference - primary.solved.low), Math.abs(primary.solved.high - primary.solved.difference)) * 100 : null
  out.push(`The check (share solved, \`${low}\` minus \`${base}\`): ${points(primary.solved)} points. The margin the tasks reached is ${margin === null ? 'n/a' : margin.toFixed(1)} points to each side, against the 3 points that the registered plan asks for before it says that nothing is lost. ${lower ? 'The share solved is lower, with an interval that excludes no change.' : 'The interval includes no change, which at this margin shows no loss and proves none absent.'}`, '')
  if (primary.onlyA.length || primary.onlyB.length) out.push(`Solved by \`${low}\` only: ${primary.onlyA.join(', ') || 'none'}.`, '', `Solved by \`${base}\` only: ${primary.onlyB.join(', ') || 'none'}.`, '')

  // 4. Per task set.
  out.push('## Per task set (reported, not used for the decision)', '', '| Task set | Tasks | Cost, ratio of the totals (95% interval) | Typical task (95% interval) | Solved |', '| --- | --- | --- | --- | --- |')
  data.sets = []
  const setOf = (r) => String(r.taskSet ?? '').split('/').pop()
  for (const set of [...new Set([...S[base].byTask.values()].map(setOf))].sort()) {
    const c = compare(S[low], S[base], { only: (r) => setOf(r) === set })
    if (!c.tasks) continue
    data.sets.push({ set, tasks: c.tasks, totals: c.totals, typical: c.typical, solvedA: c.solvedA, solvedB: c.solvedB })
    out.push(`| ${set} | ${c.tasks} | ${interval(c.totals)} | ${interval(c.typical)} | ${c.solvedA} against ${c.solvedB} |`)
  }
  out.push('')

  // 5. The decision rule, as registered.
  const rule = { savingProven: proven, solvedNotLower: !lower, levelHeld: jobs ? levelHeld : null }
  rule.adviceMayCiteTheSaving = rule.savingProven && rule.solvedNotLower && rule.levelHeld === true
  out.push('## The decision rule', '', '| Condition | Holds |', '| --- | --- |')
  out.push(`| The saving is proven (the primary measure) | ${rule.savingProven ? 'yes' : 'no'} |`)
  out.push(`| The share solved is not lower with an interval that excludes no change | ${rule.solvedNotLower ? 'yes' : 'no'} |`)
  out.push(`| Every session ran at its setup's effort level | ${rule.levelHeld === null ? 'not checked' : rule.levelHeld ? 'yes' : 'no'} |`)
  out.push('', `Widal.Code's advice may state the measured saving and the measured interval of the share solved: ${rule.adviceMayCiteTheSaving ? 'yes' : 'no'}. No default changes from this stage, whatever it shows.`, '')

  return { text: out.join('\n'), data: { stage, models, ...data, primary, rule } }
}

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : null
  }
  if (!arg('records')) {
    console.error('usage: node bench/harbor/v1-effort/analyze.mjs --records <out folder> --jobs <jobs folder> [--json <file>] [--stage <name> --base <setup> --low <setup> --base-level <level> --low-level <level>]')
    process.exit(1)
  }
  const base = arg('base') ?? BASE
  const low = arg('low') ?? LOW
  const { text, data } = analysis({
    records: arg('records'),
    jobs: arg('jobs'),
    stage: arg('stage') ?? STAGE,
    base,
    low,
    levels: { [base]: arg('base-level') ?? LEVEL[BASE], [low]: arg('low-level') ?? LEVEL[LOW] },
  })
  console.log(text)
  if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(data, null, 1)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
