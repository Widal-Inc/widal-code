// The statistics of the benchmark report (bench/stats.mjs): intervals, noise and sample sizes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closedShare, deviation, noise, ratioOfTotals, seeded, solvedDifference, tasksNeeded, typicalRatio } from '../bench/stats.mjs'

const near = (actual, expected, within = 1e-3) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not near ${expected}`)

test('the random numbers repeat for the same seed', () => {
  const a = seeded(7)
  const b = seeded(7)
  const first = Array.from({ length: 5 }, a)
  assert.deepEqual(first, Array.from({ length: 5 }, b))
  assert.ok(first.every((x) => x >= 0 && x < 1))
  assert.notDeepEqual(first, Array.from({ length: 5 }, seeded(8)))
})

test('the ratio of totals, with an interval that holds the ratio', () => {
  const pairs = [
    { a: 1, b: 2 },
    { a: 2, b: 4 },
    { a: 3, b: 5 },
    { a: 0.5, b: 2 },
  ]
  const r = ratioOfTotals(pairs)
  near(r.ratio, 6.5 / 13)
  assert.equal(r.tasks, 4)
  assert.ok(r.low <= r.ratio && r.ratio <= r.high)
  assert.deepEqual(ratioOfTotals(pairs), r, 'the same records give the same interval')
})

test('the same value on both sides gives a ratio of 1 with no width', () => {
  const r = ratioOfTotals([{ a: 3, b: 3 }, { a: 1, b: 1 }, { a: 2, b: 2 }])
  assert.deepEqual([r.ratio, r.low, r.high], [1, 1, 1])
})

test('no usable pair gives no ratio', () => {
  assert.equal(ratioOfTotals([]), null)
  assert.equal(ratioOfTotals([{ a: 1, b: 0 }]), null)
  assert.equal(typicalRatio([{ a: 0, b: 1 }]), null)
})

test('the typical ratio is the mean on the log scale', () => {
  const r = typicalRatio([{ a: 1, b: 2 }, { a: 5, b: 10 }, { a: 0.2, b: 0.4 }])
  near(r.ratio, 0.5)
  near(r.low, 0.5)
  near(r.high, 0.5)
  near(r.spread, 0)
  const mixed = typicalRatio([{ a: 1, b: 2 }, { a: 2, b: 1 }])
  near(mixed.ratio, 1)
})

test('the share of tasks closed has a Wilson interval', () => {
  const all = closedShare(13, 13)
  assert.equal(all.share, 1)
  assert.equal(all.high, 1)
  near(all.low, 0.772)
  const half = closedShare(5, 10)
  near(half.share, 0.5)
  near(half.low, 0.237)
  near(half.high, 0.763)
  assert.deepEqual(closedShare(0, 0), { share: 0, low: 0, high: 0 })
})

test('the noise is the spread of the log ratio between runs of one task', () => {
  const runs = [
    { task: 't1', value: 1 },
    { task: 't1', value: 2 },
    { task: 't2', value: 4 },
    { task: 't2', value: 2 },
    { task: 't3', value: 5 },
  ]
  const n = noise(runs)
  assert.equal(n.pairs, 2, 't3 ran once and has no pair')
  near(n.spread, deviation([Math.log(2), Math.log(0.5)]))
  assert.deepEqual(noise([{ task: 't1', value: 1 }]), { pairs: 0, spread: null })
})

test('the tasks a difference needs grow as the difference shrinks', () => {
  assert.equal(tasksNeeded(0.35, 0.1), 87)
  assert.equal(tasksNeeded(0.26, 0.1), 48)
  assert.equal(tasksNeeded(0.35, 0.3), 8)
  assert.ok(tasksNeeded(0.35, 0.05) > tasksNeeded(0.35, 0.1))
})

test('the difference in the share solved, paired by task, with an interval', () => {
  const pairs = [
    { a: true, b: true },
    { a: false, b: true },
    { a: true, b: false },
    { a: false, b: true },
  ]
  const d = solvedDifference(pairs)
  near(d.difference, -0.25)
  assert.ok(d.low <= d.difference && d.difference <= d.high)
  assert.deepEqual(solvedDifference([{ a: true, b: true }, { a: false, b: false }]), { difference: 0, low: 0, high: 0, tasks: 2 })
  assert.equal(solvedDifference([]), null)
})

test('two-level resampling: one run per task gives the plain ratio of totals', async () => {
  const { clusteredRatio } = await import('../bench/stats.mjs')
  const pairs = [{ a: 1, b: 2 }, { a: 2, b: 4 }, { a: 3, b: 5 }]
  const r = clusteredRatio(pairs.map((p) => [p]))
  near(r.ratio, 6 / 11)
  assert.equal(r.tasks, 3)
  assert.equal(r.runs, 3)
  assert.ok(r.low <= r.ratio && r.ratio <= r.high)
})

test('two-level resampling: noisy runs inside a task widen the interval', async () => {
  const { clusteredRatio } = await import('../bench/stats.mjs')
  const steady = Array.from({ length: 30 }, () => [{ a: 1, b: 2 }, { a: 1, b: 2 }])
  const noisy = Array.from({ length: 30 }, (_, i) => [{ a: 0.2 + (i % 3) * 0.4, b: 2 }, { a: 1.8 - (i % 3) * 0.4, b: 2 }])
  const s = clusteredRatio(steady)
  const n = clusteredRatio(noisy)
  near(s.ratio, 0.5)
  near(n.ratio, 0.5)
  assert.ok(n.high - n.low > s.high - s.low)
})

test('the solved difference averages each task over its runs', async () => {
  const { clusteredSolvedDifference } = await import('../bench/stats.mjs')
  const groups = [
    [{ a: true, b: true }, { a: false, b: true }],
    [{ a: true, b: false }, { a: true, b: false }],
    [{ a: false, b: false }],
  ]
  const d = clusteredSolvedDifference(groups)
  near(d.difference, (-0.5 + 1 + 0) / 3)
  assert.equal(d.tasks, 3)
  assert.equal(d.runs, 5)
})

test('Holm keeps the order and never lowers a chance', async () => {
  const { holm } = await import('../bench/stats.mjs')
  const out = holm([0.01, 0.04, null, 0.03])
  near(out[0], 0.03)
  near(out[3], 0.06)
  near(out[1], 0.06)
  assert.equal(out[2], null)
})

test('repeat noise: the share solved in one run only, and the cost spread', async () => {
  const { repeatNoise } = await import('../bench/stats.mjs')
  const n = repeatNoise([
    { task: 'x', rep: 1, closed: true, cost: 1 },
    { task: 'x', rep: 2, closed: false, cost: 2 },
    { task: 'y', rep: 1, closed: true, cost: 1 },
    { task: 'y', rep: 2, closed: true, cost: 1 },
    { task: 'z', rep: 1, closed: true, cost: 1 },
  ])
  assert.equal(n.tasks, 2)
  near(n.discordance, 0.5)
})
