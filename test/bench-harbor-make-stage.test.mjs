// The stage files of version 1 (bench/harbor-make-stage.mjs): which tasks a stage gets, and its setups.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { addCopies, pickTasks, setupOf } from '../bench/harbor-make-stage.mjs'

const list = (n, dataset = 'd') => ({ tasks: Array.from({ length: n }, (_, i) => ({ dataset, task: `${dataset}/t${i}` })) })

test('tasks: only those that passed the oracle, never an excluded one, no duplicates', () => {
  const passed = new Set(['d/t0', 'd/t1', 'd/t2', 'd/t3'])
  const tasks = pickTasks({ lists: [list(6), list(2)], passed, excluded: ['d/t1'] })
  assert.deepEqual(tasks.map((t) => t.task), ['d/t0', 'd/t2', 'd/t3'])
})

test('tasks: per set and a sample are picked the same way every time', () => {
  const lists = [list(10, 'a'), list(10, 'b')]
  const one = pickTasks({ lists, perSet: 3 })
  assert.equal(one.length, 6)
  assert.deepEqual(pickTasks({ lists, perSet: 3 }), one)
  assert.equal(pickTasks({ lists, sample: 5 }).length, 5)
})

test('a setup id ending in -2 is run 2 of its arm, and id=spec copies a spec', () => {
  assert.deepEqual(setupOf('widal-on-2', { model: 'm', provider: 'api' }), { id: 'widal-on-2', arm: 'widal-on', rep: 2, model: 'm', provider: 'api' })
  assert.deepEqual(setupOf('baseline', { model: 'm', provider: 'api' }), { id: 'baseline', arm: 'baseline', rep: 1, model: 'm', provider: 'api' })
  assert.equal(setupOf('opus-baseline=baseline', { model: 'm', provider: 'api' }).spec, 'baseline')
  assert.equal(setupOf('codex', { model: 'm', provider: 'openai', agent: 'codex' }).agent, 'codex')
})

test('copies of setups are written once, and a missing spec is an error', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'widal-make-stage-')), 'setups.json')
  writeFileSync(file, JSON.stringify({ setups: [{ id: 'baseline', name: 'B', budget: 4 }] }))
  const setups = ['baseline', 'baseline-2', 'opus-baseline=baseline', 'opus-baseline-2=baseline'].map((e) => setupOf(e, { model: 'm', provider: 'api' }))
  assert.deepEqual(addCopies(file, setups), ['baseline-2', 'opus-baseline', 'opus-baseline-2'])
  assert.deepEqual(addCopies(file, setups), [])
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(doc.setups.find((s) => s.id === 'baseline-2').budget, 4)
  assert.throws(() => addCopies(file, [setupOf('x-2', { model: 'm', provider: 'api' })]), /no setup "x"/)
})

test('copies can get their own budget and settings', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'widal-make-stage-')), 'setups.json')
  writeFileSync(file, JSON.stringify({ setups: [{ id: 'baseline', name: 'B', budget: 4, settings: { env: { A: '1' } } }] }))
  addCopies(file, [setupOf('fable-baseline=baseline', { model: 'm', provider: 'api' })], { budget: 15, settings: { effortLevel: 'xhigh', env: { B: '2' } } })
  const copy = JSON.parse(readFileSync(file, 'utf8')).setups.find((s) => s.id === 'fable-baseline')
  assert.equal(copy.budget, 15)
  assert.equal(copy.settings.effortLevel, 'xhigh')
  assert.deepEqual(copy.settings.env, { A: '1', B: '2' })
})
