// The results of a benchmark run, as Markdown on the screen and as <folder>/results.json.
//
//   node bench/report.mjs --out <folder> [--rate 100] [--review 5] [--arms-file <file>]
//
// --rate is what an hour of an engineer costs, in dollars. --review is the minutes a person needs
// to look at what an agent left, for every run, closed or not. Both are assumptions: they only
// put a dollar value on a closed task. The counts, the costs and the times are measured.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verdict } from '../src/advise.mjs'
import { ARMS, BASELINE, EFFORTS, addArms, armOf, effortOf } from './arms.mjs'
import { collect } from './collect.mjs'
import { ROOT, flags, outDir, paths, readJson, runsOf, writeJson } from './lib.mjs'
import { TASKS, taskOf } from './tasks.mjs'

const f = flags()
const out = outDir(f)
// The arms of an arms file are in the report when the same file is given here.
if (typeof f['arms-file'] === 'string') addArms(f['arms-file'], out)
const RATE = Number(f.rate ?? 100)
const REVIEW = Number(f.review ?? 5)

const sum = (list, g = (x) => x) => list.reduce((n, x) => n + g(x), 0)
const median = (list) => {
  const s = [...list].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0
}
/** Dollars. An amount under 10 cents gets a third digit, so that a cheap run does not read as free. */
const money = (n, digits = 2) => (n === null || n === undefined || Number.isNaN(n) ? 'n/a' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(digits === 2 && Math.abs(n) > 0 && Math.abs(n) < 0.1 ? 3 : digits)}`)
const pct = (n) => `${Math.round(100 * n)}%`
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')
/** What a closed task is worth: the time an engineer would need for it by hand. */
const valueOf = (task) => (task.minutes * RATE) / 60
const costOf = (run) => run.claude?.cost ?? 0

/** The figures of a list of runs. */
function stats(runs) {
  const closed = runs.filter((r) => r.score.closed)
  const cost = sum(runs, costOf)
  const value = sum(closed, (r) => valueOf(taskOf(r.task)))
  const review = (runs.length * REVIEW * RATE) / 60
  return {
    runs: runs.length,
    closed: closed.length,
    closedRate: runs.length ? closed.length / runs.length : 0,
    quality: runs.length ? sum(runs, (r) => r.score.quality) / runs.length : 0,
    cost,
    costPerClosed: closed.length ? cost / closed.length : null,
    medianSeconds: median(runs.map((r) => r.wallMs / 1000)),
    seconds: sum(runs, (r) => r.wallMs / 1000),
    turns: sum(runs, (r) => r.claude?.turns ?? 0),
    refused: sum(runs, (r) => r.claude?.denials?.length ?? 0),
    value,
    review,
    net: value - cost - review,
    netPerClosed: closed.length ? (value - cost - review) / closed.length : null,
    perDollar: cost ? value / cost : null,
    // The minutes of work that a person still has to do by hand, for the tasks that stayed open.
    leftMinutes: sum(runs.filter((r) => !r.score.closed), (r) => taskOf(r.task).minutes),
  }
}

const arms = ARMS.map((arm) => ({ arm, runs: runsOf(out, arm.id), view: undefined })).filter((a) => a.runs.length)
for (const a of arms) {
  try {
    a.view = collect(out, a.arm.id)
  } catch (e) {
    a.viewError = e.message
  }
}
/** The first run of each task that counts. */
const first = (a) => a.runs.filter((r) => !a.runs.some((x) => x.task === r.task && x.rep < r.rep))
const lines = []
const say = (...text) => lines.push(...text, '')

say(`# Widal.Code benchmark`, `${sum(arms, (a) => a.runs.length)} real Claude Code sessions on ${TASKS.length} tasks. Agent cost in total: ${money(sum(arms, (a) => sum(a.runs, costOf)))} at list prices.`, `Assumptions for the dollar value: an engineer's hour costs ${money(RATE, 0)}, and a person spends ${REVIEW} minutes to look at each result.`)

const HEAD = ['arm', 'tasks closed', 'quality', 'agent cost', 'cost per closed task', 'median time', 'value of closed tasks', 'net value', 'net value per closed task', 'value per $1 of agent cost', 'work left for a person']
/** The row of an arm in a table of outcomes, for a list of its runs. */
const row = (a, runs) => {
  const s = stats(runs)
  return [a.arm.name, `${s.closed} of ${s.runs}`, pct(s.quality), money(s.cost), money(s.costPerClosed), `${Math.round(s.medianSeconds)}s`, money(s.value, 0), money(s.net, 0), money(s.netPerClosed), s.perDollar === null ? 'n/a' : `$${Math.round(s.perDollar)}`, `${s.leftMinutes} min`]
}

// 1. The arms, on the first run of each task.
// An arm with `only` ran a few tasks, so its totals cannot stand next to the totals of a whole arm.
const whole = arms.filter((a) => !a.arm.only)
const alone = arms.filter((a) => a.arm.only)
say('## Outcomes per arm (the first run of each task)')
say(
  table(
    HEAD,
    whole.map((a) => row(a, first(a))),
  ),
)
say('"Quality" is the share of hidden checks that pass, as the mean over the tasks. "Net value" is the value of the closed tasks, minus the agent cost, minus the time a person needs to look at every result. "Work left for a person" is the time by hand of the tasks that stayed open.')

// 1b. The hard tasks alone: the easy tasks hide the difference between the arms.
const HARD = new Set(TASKS.filter((task) => task.id.startsWith('h')).map((task) => task.id))
if (arms.some((a) => a.runs.some((r) => HARD.has(r.task)))) {
  say('## The hard tasks alone (all runs)')
  say(table(HEAD, arms.filter((a) => a.runs.some((r) => HARD.has(r.task))).map((a) => row(a, a.runs.filter((r) => HARD.has(r.task))))))
  const missed = new Map()
  for (const a of arms) for (const r of a.runs) if (HARD.has(r.task)) for (const c of r.score.checks) if (!c.ok) missed.set(`${r.task}: ${c.name}`, [...(missed.get(`${r.task}: ${c.name}`) ?? []), a.arm.id])
  if (missed.size) say('The hidden checks that failed, and in how many runs of which arm:', ...[...missed].sort((x, y) => y[1].length - x[1].length).map(([name, list]) => `- ${name} (${[...new Set(list)].map((id) => `${id} ${list.filter((x) => x === id).length}`).join(', ')})`))
}

// 2. Task by arm.
say('## Each task in each arm (the first run)')
say(
  table(
    ['task', 'kind', 'by hand', ...whole.map((a) => a.arm.name)],
    TASKS.map((task) => [
      task.id,
      task.kind,
      `${task.minutes} min`,
      ...whole.map((a) => {
        const r = first(a).find((x) => x.task === task.id)
        return r ? `${r.score.closed ? 'closed' : `open (${r.score.passed}/${r.score.total})`} ${money(costOf(r))} ${Math.round(r.wallMs / 1000)}s` : 'not run'
      }),
    ]),
  ),
)

// 3. Repeats: how much the same arm differs from run to run.
/** For each task that an arm ran more than once: the highest cost minus the lowest, as a share of the mean. */
const spreadOf = (a) =>
  TASKS.map((task) => ({ task: task.id, costs: a.runs.filter((r) => r.task === task.id).map(costOf) }))
    .filter((x) => x.costs.length > 1 && sum(x.costs) > 0)
    .map((x) => ({ task: x.task, spread: (Math.max(...x.costs) - Math.min(...x.costs)) / (sum(x.costs) / x.costs.length) }))
const repeated = arms.filter((a) => a.runs.some((r) => r.rep > 1))
if (repeated.length) {
  say('## The same tasks again (run to run difference)')
  say(
    table(
      ['arm', 'tasks closed per round', 'cost per round', 'tasks with a different result between rounds', 'tasks run more than once', 'median spread of the cost of one task', 'largest spread'],
      repeated.map((a) => {
        const rounds = [...new Set(a.runs.map((r) => r.rep))].sort()
        const flips = TASKS.filter((task) => new Set(a.runs.filter((r) => r.task === task.id).map((r) => r.score.closed)).size > 1).map((t) => t.id)
        const spreads = spreadOf(a)
        const widest = spreads.reduce((x, y) => (y.spread > (x?.spread ?? -1) ? y : x), undefined)
        return [a.arm.name, rounds.map((rep) => `${a.runs.filter((r) => r.rep === rep && r.score.closed).length} of ${a.runs.filter((r) => r.rep === rep).length}`).join(', '), rounds.map((rep) => money(sum(a.runs.filter((r) => r.rep === rep), costOf))).join(', '), flips.join(', ') || 'none', String(spreads.length), spreads.length ? pct(median(spreads.map((x) => x.spread))) : 'n/a', widest ? `${pct(widest.spread)} (${widest.task})` : 'n/a']
      }),
    ),
  )
  say('"Spread" is the highest cost of a task in an arm minus the lowest, as a share of the mean. A difference between two arms on one task that is smaller than this spread can be chance.')
}

const base = arms.find((a) => a.arm.id === BASELINE)
const change = (x, y) => (x ? `${y < x ? '-' : '+'}${pct(Math.abs(y - x) / x)}` : 'n/a')
const seconds = (r) => r.wallMs / 1000
const outcome = (r) => `${r.score.closed ? 'closed' : `open (${r.score.passed}/${r.score.total})`} ${money(costOf(r))} ${Math.round(seconds(r))}s`

// 3b. Rounds in which every arm started a task at the same moment. The arms of such a round ran
// under the same load, so their times can be compared. In another round they cannot.
/** How many ways there are to pick k of n. */
const choose = (n, k) => {
  let c = 1
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i
  return Math.round(c)
}
/**
 * The sign test, for both directions: the chance of a split of the tasks at least this one-sided
 * when the arm makes no difference. Tasks with the same value on both sides do not count.
 */
function signTest(pairs, value) {
  const less = pairs.filter((p) => value(p.a) < value(p.b)).length
  const more = pairs.filter((p) => value(p.a) > value(p.b)).length
  const n = less + more
  if (!n) return { less, n, chance: null }
  let tail = 0
  for (let i = Math.max(less, more); i <= n; i++) tail += choose(n, i)
  return { less, n, chance: Math.min(1, (2 * tail) / 2 ** n) }
}
const chanceText = (t) => (t.chance === null ? 'n/a' : t.chance < 0.001 ? 'under 0.1%' : `${(100 * t.chance).toFixed(t.chance < 0.1 ? 1 : 0)}%`)
/** An arm that differs from the other arms of its model in the effort level only. */
const plainEffort = (a) => !a.arm.from && !a.arm.only && !a.arm.other && Object.keys(a.arm.settings).every((key) => key === 'model' || key === 'effortLevel')
/** The runs of an arm in a paired round. */
const pairedRuns = (a, rep) => a.runs.filter((r) => r.rep === rep && r.setup?.paired)
/**
 * The arm that the others of a paired round are set against: the baseline when it ran in the
 * round, and else the arm at effort xhigh with no other change. So a round of one model's arms
 * is read against that model at effort xhigh.
 */
const referenceOf = (rep) => {
  const group = whole.filter((a) => pairedRuns(a, rep).length)
  return group.find((a) => a === base) ?? group.find((a) => plainEffort(a) && effortOf(a.arm) === 'xhigh')
}
/** The tasks that two arms both ran in a round, as pairs of runs. The second arm is the baseline, or the one given. */
const pairsOf = (a, rep, ref = base) => (ref ? a.runs.filter((r) => r.rep === rep).map((r) => ({ task: r.task, a: r, b: ref.runs.find((x) => x.task === r.task && x.rep === rep) })).filter((p) => p.b) : [])
/** The pairs of a paired round: both runs started at the same moment. */
const sideBySide = (a, rep, ref) => pairsOf(a, rep, ref).filter((p) => p.a.setup?.paired && p.b.setup?.paired)
const pairedRounds = [...new Set(whole.flatMap((a) => a.runs.filter((r) => r.setup?.paired).map((r) => r.rep)))].sort()
const paired = []
for (const rep of pairedRounds) {
  const ref = referenceOf(rep)
  if (!ref) continue
  const rows = whole.filter((a) => a !== ref).map((a) => ({ a, pairs: sideBySide(a, rep, ref) })).filter((x) => x.pairs.length)
  if (!rows.length) continue
  const figures = rows.map(({ a, pairs }) => {
    const mine = pairs.map((p) => p.a)
    const theirs = pairs.map((p) => p.b)
    return { arm: a.arm.id, name: a.arm.name, tasks: pairs.length, closed: mine.filter((r) => r.score.closed).length, baselineClosed: theirs.filter((r) => r.score.closed).length, cost: sum(mine, costOf), baselineCost: sum(theirs, costOf), costSign: signTest(pairs, costOf), seconds: sum(mine, seconds), baselineSeconds: sum(theirs, seconds), medianSeconds: median(mine.map(seconds)), baselineMedianSeconds: median(theirs.map(seconds)), timeSign: signTest(pairs, seconds) }
  })
  paired.push({ round: rep, reference: ref.arm.id, arms: figures })
  // The words for the arm that the others are set against.
  const it = ref === base ? 'in the baseline' : 'at effort xhigh'
  const short = ref === base ? 'baseline' : 'effort xhigh'
  say(`## Round ${rep}: every arm started each task at the same moment`)
  say(`The arms of this round ran side by side on each task, so they ran under the same load. Each arm is set against ${ref === base ? `the baseline (${ref.arm.name})` : `the arm "${ref.arm.name}"`} of the same round, on the tasks that both ran.`)
  say(table(['arm', `tasks closed (${short})`, 'cost', `cost ${it}`, 'difference', `tasks that cost less than ${it}`, 'chance of such a split without a real difference'], figures.map((x) => [x.name, `${x.closed} of ${x.tasks} (${x.baselineClosed})`, money(x.cost), money(x.baselineCost), change(x.baselineCost, x.cost), `${x.costSign.less} of ${x.costSign.n}`, chanceText(x.costSign)])))
  say(table(['arm', 'time for the tasks', `time ${it}`, 'difference', `median time (${short})`, `tasks that took less time than ${it}`, 'chance of such a split without a real difference'], figures.map((x) => [x.name, `${Math.round(x.seconds)}s`, `${Math.round(x.baselineSeconds)}s`, change(x.baselineSeconds, x.seconds), `${Math.round(x.medianSeconds)}s (${Math.round(x.baselineMedianSeconds)}s)`, `${x.timeSign.less} of ${x.timeSign.n}`, chanceText(x.timeSign)])))
  say('The last column is a sign test: how likely it is to see the tasks split at least this one-sidedly when the arm makes no difference. Under 5% is the usual line for a real difference. It says nothing about how large the difference is.')
}

// 3c. The effort levels of each model, each next to the same model at effort xhigh.
const NOT_SET = 'not set'
/** The effort level of an arm, or "not set" for an arm that leaves the level to Claude Code. */
const levelOf = (a) => effortOf(a.arm) ?? NOT_SET
const levelOrder = (a) => (EFFORTS.includes(levelOf(a)) ? EFFORTS.indexOf(levelOf(a)) : EFFORTS.length)
const outputOf = (r) => sum(Object.values(r.claude?.modelUsage ?? {}), (u) => u.outputTokens ?? 0)
const efforts = []
for (const model of [...new Set(whole.filter(plainEffort).map((a) => a.arm.settings.model))]) {
  const group = whole.filter((a) => plainEffort(a) && a.arm.settings.model === model).sort((x, y) => levelOrder(x) - levelOrder(y))
  const ref = group.find((a) => levelOf(a) === 'xhigh')
  if (!ref || group.length < 2) continue
  const figures = (a, runs, pairs, sameLoad, mine = pairs.map((p) => p.a), theirs = pairs.map((p) => p.b)) => ({ model, arm: a.arm.id, effort: levelOf(a), runs, tasks: pairs.length, closed: mine.filter((r) => r.score.closed).length, quality: sum(mine, (r) => r.score.quality) / mine.length, cost: sum(mine, costOf), baselineCost: sum(theirs, costOf), medianSeconds: median(mine.map(seconds)), seconds: sum(mine, seconds), turns: sum(mine, (r) => r.claude?.turns ?? 0), outputTokens: sum(mine, outputOf), sameLoad })
  const rows = []
  for (const a of group) {
    // The runs outside a paired round: the first run of each task, against the first run of each task at xhigh.
    const loose = first(a).filter((r) => !r.setup?.paired).map((r) => ({ a: r, b: first(ref).find((x) => x.task === r.task) })).filter((p) => p.b)
    if (loose.length) rows.push(figures(a, 'the first run of each task', loose, a === ref))
    for (const rep of pairedRounds) {
      const pairs = sideBySide(a, rep, ref)
      if (pairs.length) rows.push(figures(a, `round ${rep}`, pairs, true))
    }
  }
  efforts.push(...rows)
  say(`## The effort levels of ${model}`)
  say(table(['effort', 'runs', 'tasks closed', 'quality', 'cost', 'cost as a share of effort xhigh, on the same tasks', 'median time', 'time for the tasks', 'turns', 'output tokens'], rows.map((e) => [e.effort, `${e.runs}${e.sameLoad ? '' : ' (its time was not under the same load as xhigh)'}`, `${e.closed} of ${e.tasks}`, pct(e.quality), money(e.cost), e.baselineCost ? pct(e.cost / e.baselineCost) : 'n/a', `${Math.round(e.medianSeconds)}s`, `${Math.round(e.seconds)}s`, String(e.turns), e.outputTokens.toLocaleString('en-US')])))
  say(`A row for a round sets the level against effort xhigh in the same round, where both started each task at the same moment. A row for "the first run of each task" sets it against the first run of each task at effort xhigh, which can be from another day: its cost can be compared, and its time cannot.${group.some((a) => levelOf(a) === NOT_SET) ? ' "not set" is the arm that names no effort level, so Claude Code picks one.' : ''}`)
}

// 3d. One change alone on the baseline, on the tasks that the change acts on.
const on = arms.find((a) => a.arm.id === 'widal-on')
const single = []
for (const a of alone) {
  for (const r of a.runs) {
    const b = base?.runs.find((x) => x.task === r.task && x.rep === r.rep)
    const w = on?.runs.find((x) => x.task === r.task && x.rep === r.rep)
    single.push({ arm: a.arm.id, name: a.arm.name, task: r.task, round: r.rep, run: r, baseline: b, all: w })
  }
}
if (single.length) {
  say('## One change alone on the baseline')
  say(`Each row is the baseline with one setting changed, on a task that the change acts on, next to the baseline and to the arm with all of Widal.Code's changes in the same round.`)
  say(table(['change', 'task', 'round', 'baseline', 'with this change alone', 'change in cost', 'change in time', "with all of Widal.Code's changes", "the baseline's cost of this task in all its rounds"], single.map((x) => [x.name, x.task, String(x.round), x.baseline ? outcome(x.baseline) : 'not run', outcome(x.run), x.baseline ? change(costOf(x.baseline), costOf(x.run)) : 'n/a', x.baseline ? change(seconds(x.baseline), seconds(x.run)) : 'n/a', x.all ? outcome(x.all) : 'not run', base.runs.filter((r) => r.task === x.task).map((r) => money(costOf(r))).join(', ')])))
  say('Each change ran once per task here. The last column shows how much the baseline itself differs from round to round on the same task: a change in cost that is smaller than that can be chance.')
}

// 4. The cheapest arm that closes each task: what a model choice per task could reach at best.
const plain = arms.filter((a) => !a.arm.from)
const picks = TASKS.map((task) => {
  const closing = plain.map((a) => ({ a, r: first(a).find((x) => x.task === task.id) })).filter((x) => x.r?.score.closed).sort((x, y) => costOf(x.r) - costOf(y.r))
  return { task, best: closing[0], baseline: base && first(base).find((x) => x.task === task.id) }
})
if (base) {
  say('## The cheapest arm that closed each task')
  say(table(['task', 'cheapest arm that closed it', 'its cost', `cost in the baseline (${base.arm.name})`], picks.map((p) => [p.task.id, p.best?.a.arm.name ?? 'none', p.best ? money(costOf(p.best.r), 3) : 'n/a', p.baseline ? money(costOf(p.baseline), 3) : 'n/a'])))
  const bestCost = sum(picks, (p) => (p.best ? costOf(p.best.r) : 0))
  const baseCost = sum(picks, (p) => (p.baseline ? costOf(p.baseline) : 0))
  say(`With the cheapest closing arm for every task, the ${picks.filter((p) => p.best).length} tasks cost ${money(bestCost)} instead of ${money(baseCost)} in the baseline: ${baseCost ? pct(1 - bestCost / baseCost) : 'n/a'} less. This is the best case, known only after the fact.`)
}

// 5. Can the numbers be trusted: Widal.Code's cost against Claude Code's own, and the ticket.
const checked = []
for (const a of arms) {
  if (!a.view) continue
  const byId = new Map(a.view.sessions.map((s) => [s.id, s]))
  // Every session of the arm, also of the runs that do not count: the tool sees those as well.
  for (const r of runsOf(out, a.arm.id, { all: true })) {
    if (!r.claude?.session) continue
    const s = byId.get(r.claude.session)
    checked.push({ arm: a.arm.id, task: r.task, rep: r.rep, claude: costOf(r), widal: s?.cost, seen: Boolean(s), ticketRight: Boolean(s) && s.tickets.length === 1 && s.tickets[0] === r.ticket, ticketReport: a.view.tickets[r.ticket] })
  }
}
// Did a session copy from another run? A session may read files outside its own folder, and the
// folder of the benchmark holds what earlier runs left. So: of the long lines that a run added,
// the largest share that another run of the same task added too. Only runs that added 30 long
// lines or more count, because a small fix reads the same in every run.
const added = (r) => {
  const dir = paths(out).kept(r.arm, r.task, r.rep)
  const startDir = join(ROOT, 'bench', 'project')
  const lines = new Set()
  for (const file of r.score.changed) {
    if (!existsSync(join(dir, file))) continue
    const before = new Set(existsSync(join(startDir, file)) ? readFileSync(join(startDir, file), 'utf8').split('\n').map((l) => l.trim()) : [])
    for (const l of readFileSync(join(dir, file), 'utf8').split('\n').map((x) => x.trim())) if (l.length > 30 && !before.has(l)) lines.add(l)
  }
  return lines
}
// Two numbers: between different arms, and between rounds of one arm. One model writes much the
// same code for the same task each time, so the second number is high without any copying.
const alike = { arms: { share: 0 }, rounds: { share: 0 } }
for (const task of TASKS) {
  const sets = arms.flatMap((a) => a.runs.filter((r) => r.task === task.id)).map((r) => ({ r, lines: added(r) })).filter((x) => x.lines.size >= 30)
  for (const x of sets) for (const y of sets) {
    if (x === y) continue
    const share = [...x.lines].filter((l) => y.lines.has(l)).length / x.lines.size
    const kind = x.r.arm === y.r.arm ? 'rounds' : 'arms'
    if (share > alike[kind].share) alike[kind] = { share, task: task.id, a: `${x.r.arm} round ${x.r.rep}`, b: `${y.r.arm} round ${y.r.rep}` }
  }
}
const alikeText = (x) => (x.task ? `${pct(x.share)} (${x.task}: ${x.a} and ${x.b})` : 'n/a')
const seen = checked.filter((c) => c.seen)
const diffs = seen.map((c) => Math.abs(c.widal - c.claude))
say('## Can the numbers be trusted')
say(
  table(
    ['check', 'result'],
    [
      ['Sessions that Widal.Code found', `${seen.length} of ${checked.length}`],
      ["Cost by Widal.Code against Claude Code's own cost, all sessions", `${money(sum(seen, (c) => c.widal), 4)} against ${money(sum(seen, (c) => c.claude), 4)}`],
      ['Largest difference in one session', money(Math.max(0, ...diffs), 6)],
      ['Sessions off by more than 1%', String(seen.filter((c) => c.claude > 0 && Math.abs(c.widal - c.claude) / c.claude > 0.01).length)],
      ['Sessions counted to the right ticket', `${seen.filter((c) => c.ticketRight).length} of ${seen.length}`],
      ['Tickets in "widal tickets" with the right cost (to the cent)', `${seen.filter((c) => c.ticketReport !== undefined && Math.abs(c.ticketReport - c.claude) <= 0.0051).length} of ${seen.length}`],
      ['Largest share of added lines that two runs of one task have in common, between different arms', alikeText(alike.arms)],
      ['The same between rounds of one arm (one model writes much the same code each time)', alikeText(alike.rounds)],
    ],
  ),
)

// 6. Widal.Code's own signs of quality, next to what the hidden checks say.
say("## Widal.Code's signs next to the measured quality")
say(
  table(
    ['arm', 'tasks closed (all runs)', 'quality (all runs)', 'tool errors per 1,000 calls', 'rounds of fixing per 1,000 calls', 'repeated tool calls per 1,000 calls', 'calls per session', 'cost per session'],
    arms.filter((a) => a.view).map((a) => {
      const s = stats(a.runs)
      // The signs of the arm's own sessions. The arm with Widal.Code on also sees the baseline's sessions, so its signs are left out.
      const g = a.arm.from ? undefined : a.view.signs
      return [a.arm.name, `${s.closed} of ${s.runs}`, pct(s.quality), g ? Math.round(g.errors) : 'n/a', g ? Math.round(g.fixRounds) : 'n/a', g ? Math.round(g.repeats) : 'n/a', g ? g.callsPerSession.toFixed(1) : 'n/a', g ? money(g.costPerSession) : 'n/a']
    }),
  ),
)

// 6b. What "widal advise" says for each arm's own sessions, next to the best case that the benchmark measured.
const advised = arms.filter((a) => !a.arm.from && a.view?.advise && !a.view.advise.error)
if (advised.length) {
  say('## What Widal.Code advises for each arm')
  say(
    table(
      ['arm', 'spend the tool saw', 'proposals, with the saving the tool expects', 'all proposals together', 'the best case that the benchmark measured'],
      advised.map((a) => {
        const list = a.view.advise.proposals
        const amount = sum(list, (p) => p.saving ?? 0)
        // The best case for the arm: the cheapest arm that closed each task, for the tasks the arm ran first.
        const own = first(a)
        const best = sum(own, (r) => {
          const p = picks.find((x) => x.task.id === r.task)
          return p?.best ? Math.min(costOf(p.best.r), costOf(r)) : costOf(r)
        })
        const cost = sum(own, costOf)
        return [a.arm.name, money(a.view.advise.total), list.map((p) => `${p.title} (${p.saving === null ? 'no amount' : money(p.saving)}${p.action ? '' : ', by hand'})`).join('; ') || 'none', a.view.advise.total ? `${money(amount)}, ${pct(amount / a.view.advise.total)}` : 'n/a', cost ? `${money(cost - best)}, ${pct((cost - best) / cost)} of ${money(cost)}` : 'n/a']
      }),
    ),
  )
  say('The best case is the cost of the arm\'s first runs minus the cost of the cheapest arm that closed each task. It is known only after the fact. It shows how much of the possible saving the proposals name.')
}

// 7. The directions: what "widal advise" proposed from an arm's runs, and what happened when it was applied.
/**
 * The part of the report on one arm with Widal.Code on. "Before" is the arm that it starts from
 * (`from` in arms.mjs): the tool advised from that arm's runs. Returns what goes into results.json.
 */
function directionsOf(arm) {
  const root = paths(out).view(arm.id).root
  const state = readJson(join(root, 'widal-on.json'))
  if (!state) return undefined
  const on = arms.find((a) => a.arm.id === arm.id)
  const from = arms.find((a) => a.arm.id === arm.from)
  // The words for the arm before the changes.
  const main = arm.from === BASELINE
  const before = main ? 'baseline' : armOf(arm.from).name
  const theBefore = main ? 'the baseline' : armOf(arm.from).name
  let directions
  say(main ? '## The directions: what Widal.Code proposed, and what it did' : `## The directions for ${before}: what Widal.Code proposed, and what it did`)
  say(
    table(
      ['proposal', 'saving the tool expects', main ? 'share of the baseline' : 'share of the spend the tool saw', 'can the tool apply it', 'applied'],
      state.proposals.map((p) => {
        const a = state.applied.find((x) => x.proposal === p.id)
        return [p.title, p.saving === null ? 'no amount yet' : money(p.saving), p.share === null ? 'n/a' : pct(p.share), p.action ? `yes: widal apply ${[p.action, ...p.args].join(' ')}` : 'no, by hand', a ? (a.status === 0 ? 'yes' : 'failed') : 'no']
      }),
    ),
  )
  say(`Settings before: \`${JSON.stringify(state.settingsBefore)}\``, `Settings after "widal apply": \`${JSON.stringify(state.settingsAfter)}\``)
  if (on && from) {
    // Each task in the arm's first run, next to the run before the changes in the same round, or else the first run before the changes.
    const pairs = TASKS.map((task) => {
      const w = first(on).find((r) => r.task === task.id)
      return { task, w, b: w && (from.runs.find((r) => r.task === task.id && r.rep === w.rep) ?? first(from).find((r) => r.task === task.id)) }
    }).filter((p) => p.b && p.w)
    const b = stats(pairs.map((p) => p.b))
    const w = stats(pairs.map((p) => p.w))
    directions = { tasks: pairs.length, baseline: b, widalOn: w, saved: b.cost - w.cost, expected: sum(state.applied, (a) => a.saving ?? 0) }
    say('### The same tasks before and after')
    say(
      table(
        ['task', before, 'Widal.Code on', 'change in cost'],
        [
          ...pairs.map((p) => [p.task.id, `${p.b.score.closed ? 'closed' : `open (${p.b.score.passed}/${p.b.score.total})`} ${money(costOf(p.b))} ${Math.round(p.b.wallMs / 1000)}s`, `${p.w.score.closed ? 'closed' : `open (${p.w.score.passed}/${p.w.score.total})`} ${money(costOf(p.w))} ${Math.round(p.w.wallMs / 1000)}s`, costOf(p.b) ? `${costOf(p.w) < costOf(p.b) ? '-' : '+'}${pct(Math.abs(costOf(p.w) - costOf(p.b)) / costOf(p.b))}` : 'n/a']),
          ['all', `${b.closed} of ${b.runs} closed, ${money(b.cost)}, ${Math.round(b.seconds)}s`, `${w.closed} of ${w.runs} closed, ${money(w.cost)}, ${Math.round(w.seconds)}s`, b.cost ? `${w.cost < b.cost ? '-' : '+'}${pct(Math.abs(w.cost - b.cost) / b.cost)}` : 'n/a'],
        ],
      ),
    )
    say(`Measured saving: ${money(b.cost - w.cost)} (${b.cost ? pct((b.cost - w.cost) / b.cost) : 'n/a'} of ${theBefore}). The tool expected: ${state.applied.some((a) => a.saving === null) ? 'no amount for at least one change, and ' : ''}${money(directions.expected)} for the changes with an amount.`)

    // What each change did. The changes were applied together, so each one is read from the tasks it can act on.
    const session = (a, r) => a.view?.sessions.find((x) => x.id === r?.claude?.session)
    const pair = (id) => pairs.find((p) => p.task.id === id)
    const applied = (action) => state.applied.find((a) => a.action === action)
    const rows = []
    const plainPairs = pairs.filter((p) => !p.task.id.startsWith('s'))
    if (plainPairs.length && applied('effort-default')) {
      const cost = sum(plainPairs, (p) => costOf(p.b))
      const after = sum(plainPairs, (p) => costOf(p.w))
      rows.push(['A lower effort (the only change that acts on the tasks without built-in waste)', `${plainPairs.length} tasks: ${money(cost)}`, money(after), change(cost, after), applied('effort-default').saving === null ? 'no amount' : money(applied('effort-default').saving)])
    }
    const s1 = pair('s1')
    if (applied('subagent-model') && s1 && session(from, s1.b) && session(on, s1.w)) {
      const x = session(from, s1.b)
      const y = session(on, s1.w)
      rows.push([`A cheaper model for subagents (task s1, the cost of the subagents alone; before on ${x.subagentModels.join(', ') || 'none'}, after on ${y.subagentModels.join(', ') || 'none'})`, `${money(x.subagentCost)} in ${x.subagentCalls} calls`, `${money(y.subagentCost)} in ${y.subagentCalls} calls`, change(x.subagentCost, y.subagentCost), money(applied('subagent-model').saving)])
    }
    const s2 = pair('s2')
    const t2 = pair('t2')
    if (applied('bash-output-cap') && s2 && t2) rows.push(['A cap on long command output (task s2; task t2 is the same work without the long output, and changed by ' + change(costOf(t2.b), costOf(t2.w)) + ')', money(costOf(s2.b)), money(costOf(s2.w)), change(costOf(s2.b), costOf(s2.w)), money(applied('bash-output-cap').saving)])
    if (rows.length) {
      say('### What each change did')
      say(table(['change', 'before', 'after', 'measured', 'the tool expected'], rows))
    }
  }
  const hookLog = join(root, 'hooks.jsonl')
  if (existsSync(hookLog)) {
    const calls = readFileSync(hookLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const byHook = new Map()
    for (const c of calls) byHook.set(c.hook, [...(byHook.get(c.hook) ?? []), c])
    say('### What the hooks cost')
    say(table(['hook', 'calls', 'median time', 'total time', 'calls that printed something'], [...byHook].map(([name, list]) => [name, list.length, `${Math.round(median(list.map((c) => c.ms)))} ms`, `${(sum(list, (c) => c.ms) / 1000).toFixed(1)}s`, list.filter((c) => c.printed > 0).length])))
    directions = { ...(directions ?? {}), hooks: { calls: calls.length, seconds: sum(calls, (c) => c.ms) / 1000, printed: calls.filter((c) => c.printed > 0).length } }
    say(`${calls.length} hook calls took ${(sum(calls, (c) => c.ms) / 1000).toFixed(1)} seconds in total${on ? `, in sessions that took ${Math.round(sum(on.runs, (r) => r.wallMs / 1000))} seconds` : ''}.`)
  }
  if (state.applied.some((a) => a.measure)) {
    say('### What "widal measure" said about each change')
    // The tool's own rule for its last line, on the same rates with enough calls and sessions. It
    // shows what the tool would say about this change on a larger sample of the same work.
    const withEnough = (text) => {
      const pick = (label) => {
        const m = new RegExp(`^${label}\\s+\\$?([\\d,.]+)\\s+\\$?([\\d,.]+)\\s*$`, 'm').exec(text)
        return m ? [Number(m[1].replaceAll(',', '')), Number(m[2].replaceAll(',', ''))] : undefined
      }
      const cost = pick('Cost, per 1,000 calls')
      const errors = pick('Tool errors, per 1,000 calls')
      const fixRounds = pick('Rounds of fixing, per 1,000 calls') ?? [0, 0]
      if (!cost || !errors) return undefined
      const side = (i) => ({ calls: 1e6, sessions: 1e6, cost: cost[i], errors: errors[i], fixRounds: fixRounds[i] })
      return verdict(side(0), side(1))
    }
    const measured = []
    for (const a of state.applied) {
      const text = a.measureFull ?? a.measure ?? '(not asked)'
      const said = text.split('\n').find((l) => /^(Too early|Nothing to compare|Cheaper|No clear)/.test(l)) ?? 'n/a'
      measured.push({ action: a.action, said, withEnough: withEnough(text) })
      say('```', text, '```')
    }
    say(table(['change', 'the last line of "widal measure"', 'the same rule with enough calls and sessions', 'what the hidden checks say'], measured.map((m) => [m.action, m.said, m.withEnough ?? 'n/a', directions?.baseline ? `${directions.baseline.closed} of ${directions.baseline.runs} closed before, ${directions.widalOn.closed} of ${directions.widalOn.runs} after` : 'n/a'])))
    directions = { ...(directions ?? {}), measure: measured }
    say(`"widal undo" put the settings back as they were: ${state.undoPutSettingsBack ? 'yes' : 'no'}.`)
  }
  return { arm: arm.id, from: arm.from, directions, proposals: state.proposals, applied: state.applied }
}
// The arm on the baseline first, then the arms on another model.
const widalOn = ARMS.filter((arm) => arm.from && arm.plugin).map(directionsOf).filter(Boolean)
const onBaseline = widalOn.find((x) => x.from === BASELINE)

console.log(lines.join('\n'))
writeJson(join(out, 'results.json'), {
  at: new Date().toISOString(),
  assumptions: { dollarsPerHour: RATE, reviewMinutes: REVIEW },
  arms: arms.map((a) => ({ id: a.arm.id, name: a.arm.name, first: stats(first(a)), all: stats(a.runs), signs: a.view?.signs, runs: a.runs.map((r) => ({ task: r.task, rep: r.rep, closed: r.score.closed, passed: r.score.passed, total: r.score.total, testsPass: r.score.testsPass, cost: costOf(r), seconds: r.wallMs / 1000, turns: r.claude?.turns, refused: r.claude?.denials?.length ?? 0 })) })),
  picks: picks.map((p) => ({ task: p.task.id, arm: p.best?.a.arm.id, cost: p.best ? costOf(p.best.r) : null, baseline: p.baseline ? costOf(p.baseline) : null })),
  paired,
  efforts,
  alone: single.map((x) => ({ arm: x.arm, task: x.task, round: x.round, closed: x.run.score.closed, cost: costOf(x.run), seconds: seconds(x.run), baselineCost: x.baseline ? costOf(x.baseline) : null, baselineSeconds: x.baseline ? seconds(x.baseline) : null, allCost: x.all ? costOf(x.all) : null })),
  trust: checked,
  alike,
  // The arm with Widal.Code on that starts from the baseline, and then every such arm.
  directions: onBaseline?.directions,
  proposals: onBaseline?.proposals,
  applied: onBaseline?.applied,
  widalOn,
})
