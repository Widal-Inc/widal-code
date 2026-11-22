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
