// The statistics of the benchmark report (bench/stats.mjs): intervals, noise and sample sizes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closedShare, deviation, noise, ratioOfTotals, seeded, tasksNeeded, typicalRatio } from '../bench/stats.mjs'

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
