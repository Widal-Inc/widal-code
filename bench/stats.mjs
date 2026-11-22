// The statistics of the benchmark report: how sure a difference between two arms is, and how many
// tasks a difference of a given size needs.
//
// The unit is the task. Two arms are compared on the tasks that both ran, as pairs of runs. The
// intervals come from resampling the tasks (a bootstrap): draw as many tasks as there are, with
// replacement, work out the number again, and take the middle 95% of the draws. The draws use a
// fixed seed, so the same records always give the same interval.

/** A small random number generator with a seed (mulberry32), so that a report can be repeated exactly. */
export function seeded(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sum = (list) => list.reduce((n, x) => n + x, 0)

/** The value at a share of a sorted list, between two neighbours when it falls between them. */
function quantile(sorted, share) {
  const at = (sorted.length - 1) * share
  const low = Math.floor(at)
  const high = Math.ceil(at)
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low)
}

/**
 * The ratio of two totals over the same tasks, with a 95% interval: for example the cost of an
 * arm over the cost of the baseline. A ratio of 0.41 is 59% lower.
 * @param {{a: number, b: number}[]} pairs One pair per task: the arm's value and the other arm's.
 * @returns {{ratio: number, low: number, high: number, tasks: number} | null}
 */
export function ratioOfTotals(pairs, { draws = 10_000, seed = 1 } = {}) {
  const usable = pairs.filter((p) => Number.isFinite(p.a) && Number.isFinite(p.b))
  if (!usable.length || !(sum(usable.map((p) => p.b)) > 0)) return null
  const ratio = sum(usable.map((p) => p.a)) / sum(usable.map((p) => p.b))
  const random = seeded(seed)
  const n = usable.length
  const found = []
  for (let d = 0; d < draws; d++) {
    let a = 0
    let b = 0
    for (let i = 0; i < n; i++) {
      const p = usable[Math.floor(random() * n)]
      a += p.a
      b += p.b
    }
    if (b > 0) found.push(a / b)
  }
  found.sort((x, y) => x - y)
  return { ratio, low: quantile(found, 0.025), high: quantile(found, 0.975), tasks: n }
}

/**
 * The typical ratio of one task, as the mean on the log scale (a geometric mean), with a 95%
 * interval. Unlike the ratio of totals, a cheap task counts as much as an expensive one.
 * @returns {{ratio: number, low: number, high: number, tasks: number, spread: number} | null}
 */
export function typicalRatio(pairs, { draws = 10_000, seed = 1 } = {}) {
  const logs = pairs.filter((p) => p.a > 0 && p.b > 0).map((p) => Math.log(p.a / p.b))
  if (!logs.length) return null
  const mean = (list) => sum(list) / list.length
  const random = seeded(seed)
  const n = logs.length
  const found = []
  for (let d = 0; d < draws; d++) {
    let total = 0
    for (let i = 0; i < n; i++) total += logs[Math.floor(random() * n)]
    found.push(total / n)
  }
  found.sort((x, y) => x - y)
  return { ratio: Math.exp(mean(logs)), low: Math.exp(quantile(found, 0.025)), high: Math.exp(quantile(found, 0.975)), tasks: n, spread: deviation(logs) }
}

/** The standard deviation of a list (with n - 1), or null for fewer than two values. */
export function deviation(list) {
  if (list.length < 2) return null
  const mean = sum(list) / list.length
  return Math.sqrt(sum(list.map((x) => (x - mean) ** 2)) / (list.length - 1))
}

/**
 * The share of tasks closed, with a 95% interval (the Wilson interval, which stays inside 0 to 1
 * and works for 13 of 13).
 * @returns {{share: number, low: number, high: number}}
 */
export function closedShare(closed, total) {
  if (!total) return { share: 0, low: 0, high: 0 }
  const z = 1.959964
  const share = closed / total
  const middle = (share + (z * z) / (2 * total)) / (1 + (z * z) / total)
  const half = (z * Math.sqrt((share * (1 - share)) / total + (z * z) / (4 * total * total))) / (1 + (z * z) / total)
  return { share, low: Math.max(0, middle - half), high: Math.min(1, middle + half) }
}

/**
 * How much one arm differs from itself: for each task that the arm ran more than once, the log of
 * the ratio between two of its runs, over every pair of runs. Its standard deviation is the noise
 * that any difference between two arms has to stand out from.
 * @param {{task: string, value: number}[]} runs The runs of one arm.
 * @returns {{pairs: number, spread: number | null}}
 */
export function noise(runs) {
  const byTask = new Map()
  for (const r of runs) if (r.value > 0) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r.value])
  const logs = []
  for (const values of byTask.values()) for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) logs.push(Math.log(values[j] / values[i]))
  return { pairs: logs.length, spread: deviation(logs) }
}

/**
 * How many tasks a paired comparison needs to tell a true difference from noise, with a power of
 * 80% at the 5% level (two-sided), when the log ratio of one task has the given spread.
 * @param {number} spread The standard deviation of the log ratio of one task.
 * @param {number} difference The true difference, for example 0.1 for 10% lower.
 */
export function tasksNeeded(spread, difference) {
  const effect = Math.abs(Math.log(1 - difference))
  return Math.ceil((((1.959964 + 0.841621) * spread) / effect) ** 2)
}

/**
 * The sign test, for both directions: of the pairs that differ, how many have the lower value on
 * the arm's side, and the chance of a split at least this one-sided when the arm makes no
 * difference. Pairs with the same value on both sides do not count.
 * @param {{a: number, b: number}[]} pairs
 * @returns {{less: number, n: number, chance: number | null}}
 */
export function signTest(pairs) {
  const less = pairs.filter((p) => p.a < p.b).length
  const more = pairs.filter((p) => p.a > p.b).length
  const n = less + more
  if (!n) return { less, n, chance: null }
  let choose = 1
  const ways = [1]
  for (let k = 1; k <= n; k++) {
    choose = (choose * (n - k + 1)) / k
    ways.push(choose)
  }
  let tail = 0
  for (let k = Math.max(less, more); k <= n; k++) tail += ways[k]
  return { less, n, chance: Math.min(1, (2 * tail) / 2 ** n) }
}

/**
 * The difference in the share of tasks solved between two arms on the same tasks (the arm minus the
 * other), with a 95% interval from resampling the tasks. Used for the quality margin: the arm keeps
 * quality when the lower end stays above the margin.
 * @param {{a: boolean, b: boolean}[]} pairs One pair per task: solved by the arm, solved by the other.
 * @returns {{difference: number, low: number, high: number, tasks: number} | null}
 */
export function solvedDifference(pairs, { draws = 10_000, seed = 1 } = {}) {
  if (!pairs.length) return null
  const n = pairs.length
  const value = (p) => (p.a ? 1 : 0) - (p.b ? 1 : 0)
  const difference = pairs.reduce((s, p) => s + value(p), 0) / n
  const random = seeded(seed)
  const found = []
  for (let d = 0; d < draws; d++) {
    let total = 0
    for (let i = 0; i < n; i++) total += value(pairs[Math.floor(random() * n)])
    found.push(total / n)
  }
  found.sort((x, y) => x - y)
  return { difference, low: quantile(found, 0.025), high: quantile(found, 0.975), tasks: n }
}

// ---------- Several runs per task (pre-registration, change of 22 Nov 2026) ----------
//
// When a setup runs a task more than once, the runs of one task are not independent evidence: they
// share the task. The intervals below resample in two levels, as Miller (Anthropic, 2024) recommends
// for clustered data: first the tasks with replacement, then, inside each task drawn, its runs with
// replacement. A group is the list of runs of one task, each run a pair of the arm's value and the
// baseline's value on the same run number.

/** Draws one task's runs again, with replacement. */
function redraw(runs, random) {
  const out = []
  for (let i = 0; i < runs.length; i++) out.push(runs[Math.floor(random() * runs.length)])
  return out
}

/**
 * The ratio of two totals over tasks that have one or more runs each, with a 95% interval from
 * resampling tasks and then runs.
 * @param {{a: number, b: number}[][]} groups One list of paired runs per task.
 * @returns {{ratio: number, low: number, high: number, tasks: number, runs: number} | null}
 */
export function clusteredRatio(groups, { draws = 10_000, seed = 1 } = {}) {
  const usable = groups.map((g) => g.filter((p) => Number.isFinite(p.a) && Number.isFinite(p.b))).filter((g) => g.length)
  const all = usable.flat()
  if (!all.length || !(sum(all.map((p) => p.b)) > 0)) return null
  const ratio = sum(all.map((p) => p.a)) / sum(all.map((p) => p.b))
  const random = seeded(seed)
  const n = usable.length
  const found = []
  for (let d = 0; d < draws; d++) {
    let a = 0
    let b = 0
    for (let i = 0; i < n; i++) {
      for (const p of redraw(usable[Math.floor(random() * n)], random)) {
        a += p.a
        b += p.b
      }
    }
    if (b > 0) found.push(a / b)
  }
  found.sort((x, y) => x - y)
  return { ratio, low: quantile(found, 0.025), high: quantile(found, 0.975), tasks: n, runs: all.length }
}

/**
 * The difference in the share solved (the arm minus the baseline) over tasks with one or more paired
 * runs each: per task the mean over its runs, then the mean over tasks, with a 95% interval from
 * resampling tasks and then runs.
 * @param {{a: boolean, b: boolean}[][]} groups
 * @returns {{difference: number, low: number, high: number, tasks: number, runs: number} | null}
 */
export function clusteredSolvedDifference(groups, { draws = 10_000, seed = 1 } = {}) {
  const usable = groups.filter((g) => g.length)
  if (!usable.length) return null
  const value = (p) => (p.a ? 1 : 0) - (p.b ? 1 : 0)
  const meanOf = (runs) => sum(runs.map(value)) / runs.length
  const difference = sum(usable.map(meanOf)) / usable.length
  const random = seeded(seed)
  const n = usable.length
  const found = []
  for (let d = 0; d < draws; d++) {
    let total = 0
    for (let i = 0; i < n; i++) total += meanOf(redraw(usable[Math.floor(random() * n)], random))
    found.push(total / n)
  }
  found.sort((x, y) => x - y)
  return { difference, low: quantile(found, 0.025), high: quantile(found, 0.975), tasks: n, runs: usable.reduce((k, g) => k + g.length, 0) }
}

/** The sign test on the mean of each task's runs, so that a task counts once however many runs it has. */
export function taskSignTest(groups) {
  const mean = (list) => sum(list) / list.length
  return signTest(groups.filter((g) => g.length).map((g) => ({ a: mean(g.map((p) => p.a)), b: mean(g.map((p) => p.b)) })))
}

/**
 * Holm's correction for several comparisons against one baseline: the chances in the same order,
 * each made larger so that the chance of any false difference stays at the level chosen.
 * @param {(number | null)[]} chances
 * @returns {(number | null)[]}
 */
export function holm(chances) {
  const known = chances.map((p, i) => ({ p, i })).filter((x) => x.p !== null).sort((x, y) => x.p - y.p)
  const out = chances.map(() => null)
  let highest = 0
  known.forEach((x, rank) => {
    highest = Math.max(highest, Math.min(1, (known.length - rank) * x.p))
    out[x.i] = highest
  })
  return out
}

/**
 * How two runs of the same setup differ: the share of tasks solved in one run only (the discordance
 * that sets how many tasks a quality comparison needs), and the spread of the log cost ratio.
 * @param {{task: string, rep: number, closed: boolean, cost: number | null}[]} records One setup's records.
 */
export function repeatNoise(records) {
  const byTask = new Map()
  for (const r of records) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r])
  let both = 0
  let differ = 0
  const logs = []
  for (const runs of byTask.values()) {
    const one = runs.find((r) => r.rep === 1)
    const two = runs.find((r) => r.rep === 2)
    if (!one || !two) continue
    both++
    if (one.closed !== two.closed) differ++
    if (one.cost > 0 && two.cost > 0) logs.push(Math.log(two.cost / one.cost))
  }
  return { tasks: both, discordance: both ? differ / both : null, costSpread: deviation(logs) }
}
