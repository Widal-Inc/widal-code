// The stage files of version 1 (bench/harbor-make-stage.mjs): which tasks a stage gets, its setups, and
// the stages it refuses to write.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { addCopies, checkStage, pickTasks, referenceOf, setupOf } from '../bench/harbor-make-stage.mjs'

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

test('a copy can run in fast mode, and a copy for Codex keeps only what Codex reads', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'widal-make-stage-')), 'setups.json')
  const block = ['echo 0.0.0.0 github.com >> /etc/hosts']
  writeFileSync(file, JSON.stringify({ setups: [{ id: 'baseline', name: 'B', budget: 4, settings: { env: { A: '1' } }, rootInstall: block }] }))
  addCopies(file, [setupOf('opus-fast=baseline', { model: 'm', provider: 'api' })], { fast: true, budget: 8 })
  addCopies(file, [setupOf('openai-sol=baseline', { model: 'openai/gpt-6.2-sol', provider: 'openai', agent: 'codex' })], { budget: 8, fast: true })
  const doc = JSON.parse(readFileSync(file, 'utf8')).setups
  const fast = doc.find((s) => s.id === 'opus-fast')
  assert.equal(fast.fastMode, true)
  assert.equal(fast.budget, 8)
  const codex = doc.find((s) => s.id === 'openai-sol')
  assert.deepEqual(codex.rootInstall, block)
  for (const key of ['settings', 'budget', 'fastMode']) assert.ok(!(key in codex), key)
})

// The stages that are refused. A stage is compared with its own baseline, the reference setup.

const SONNET = 'anthropic/claude-sonnet-5-5'
const OPUS = 'anthropic/claude-opus-5-5'
const setupsOf = (ids, model = SONNET) => ids.map((id) => setupOf(id, { model, provider: 'api' }))

test('the reference is the setup named, or else the stage\'s baseline by its id', () => {
  assert.equal(referenceOf(setupsOf(['baseline', 'baseline-2', 'tool', 'tool-2'])), 'baseline')
  assert.equal(referenceOf(setupsOf(['tool', 'opus-baseline=baseline', 'opus-baseline-2=baseline'])), 'opus-baseline', 'not the first setup, and not run 2')
  assert.equal(referenceOf(setupsOf(['opus-fast=baseline'])), null, 'a copy of the baseline under another id is not the baseline')
  assert.equal(referenceOf(setupsOf(['baselines', 'tool'])), null)
  assert.equal(referenceOf(setupsOf(['opus-fast=baseline']), 'opus-fast'), 'opus-fast', 'the one named wins')
})

test('a stage is refused when its reference setup is not among its setups', () => {
  const setups = setupsOf(['opus-fast=baseline'])
  assert.throws(() => checkStage({ name: 'opus-fast', reference: referenceOf(setups), setups }), /^Error: The stage "opus-fast" has no baseline among its setups \(opus-fast\): .* Add the missing setup "baseline" to --setups, or name the baseline of this stage with --reference\.$/)
  // A reference that is named and not there is named in the error.
  const two = setupsOf(['tool', 'tool-2'])
  assert.throws(() => checkStage({ name: 'main', reference: 'opus-baseline', setups: two }), /The stage "main" has no setup "opus-baseline" \(its setups: tool, tool-2\)\. .* Add the missing setup "opus-baseline" to --setups/)
  // The same setups pass once the person says that this setup is the stage's own reference.
  checkStage({ name: 'opus-fast', reference: 'opus-fast', setups })
})

test('a stage is refused when its reference has fewer runs than another setup, and the missing run is named', () => {
  const setups = setupsOf(['baseline', 'tool', 'tool-2'])
  assert.throws(() => checkStage({ name: 'main', reference: 'baseline', setups }), /The stage "main" has no setup "baseline-2": the reference "baseline" has fewer runs than "tool"\. .* Add "baseline-2" to --setups\./)
  const three = setupsOf(['opus-baseline=baseline', 'a', 'a-2', 'a-3', 'b', 'b-2'])
  assert.throws(() => checkStage({ name: 'main', reference: 'opus-baseline', setups: three }), /has no setup "opus-baseline-2", "opus-baseline-3": the reference "opus-baseline" has fewer runs than "a", "b"\./)
  // Run 2 without run 1 is a missing run as well.
  assert.throws(() => checkStage({ name: 'main', reference: 'baseline-2', setups: setupsOf(['baseline-2', 'tool', 'tool-2']) }), /has no setup "baseline":/)
  // As many runs, or more runs of the reference, are fine.
  checkStage({ name: 'main', reference: 'baseline', setups: setupsOf(['baseline', 'baseline-2', 'tool', 'tool-2']) })
  checkStage({ name: 'main', reference: 'baseline', setups: setupsOf(['baseline', 'baseline-2', 'tool']) })
  checkStage({ name: 'noise', reference: 'baseline', setups: setupsOf(['baseline', 'baseline-2']) })
})

test('a stage is refused when a setup runs another model than the reference, unless it compares models', () => {
  const setups = [...setupsOf(['baseline', 'tool']), ...setupsOf(['tool-on-opus'], OPUS)]
  const stage = { name: 'main', reference: 'baseline', setups }
  assert.throws(() => checkStage(stage), /The stage "main" has setups that run another model than the reference "baseline" \(anthropic\/claude-sonnet-5-5\): "tool-on-opus" \(anthropic\/claude-opus-5-5\)\. .* Pass --compare-models if the stage is meant to compare models\./)
  checkStage(stage, { compareModels: true })
  // The other refusals hold for a stage that compares models too.
  assert.throws(() => checkStage({ ...stage, reference: 'opus-baseline' }, { compareModels: true }), /has no setup "opus-baseline"/)
})

test('the command writes no stage file and no copy of a setup for a stage it refuses', () => {
  const folder = mkdtempSync(join(tmpdir(), 'widal-make-stage-'))
  const tasks = join(folder, 'tasks.json')
  const setupsFile = join(folder, 'setups.json')
  const out = join(folder, 'stage.json')
  writeFileSync(tasks, JSON.stringify(list(4)))
  writeFileSync(setupsFile, JSON.stringify({ setups: [{ id: 'baseline', name: 'B', budget: 4 }] }))
  const before = readFileSync(setupsFile, 'utf8')
  const make = (...more) =>
    spawnSync(process.execPath, [fileURLToPath(new URL('../bench/harbor-make-stage.mjs', import.meta.url)), '--name', 'opus-fast', '--tasks', tasks, '--model', OPUS, '--provider', 'api', '--cap', '50', '--out', out, '--setups-file', setupsFile, '--base', folder, ...more], { encoding: 'utf8' })

  const noBaseline = make('--setups', 'opus-fast=baseline', '--fast')
  assert.notEqual(noBaseline.status, 0)
  assert.match(noBaseline.stderr, /The stage "opus-fast" has no baseline among its setups \(opus-fast\)/)
  const fewerRuns = make('--setups', 'opus-baseline=baseline,opus-fast=baseline,opus-fast-2=baseline')
  assert.notEqual(fewerRuns.status, 0)
  assert.match(fewerRuns.stderr, /has no setup "opus-baseline-2"/)
  assert.ok(!existsSync(out), 'no stage file')
  assert.equal(readFileSync(setupsFile, 'utf8'), before, 'no copy of a setup')

  // With its own baseline the stage is written, and the baseline is its reference wherever it stands.
  const fine = make('--setups', 'opus-fast=baseline,opus-baseline=baseline')
  assert.equal(fine.status, 0, fine.stderr)
  const stage = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(stage.reference, 'opus-baseline')
  assert.deepEqual(stage.setups.map((x) => x.id), ['opus-fast', 'opus-baseline'])
  // A person can say that a setup is the stage's own reference.
  const named = make('--setups', 'opus-fast=baseline', '--reference', 'opus-fast')
  assert.equal(named.status, 0, named.stderr)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).reference, 'opus-fast')
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).diskCleanup, undefined, 'no disk cleanup unless it is asked for')

  // The disk cleanup is written into the stage file, and a value the stage runner would refuse writes no file.
  const cleanup = make('--setups', 'opus-fast=baseline,opus-baseline=baseline', '--disk-cleanup', '70')
  assert.equal(cleanup.status, 0, cleanup.stderr)
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).diskCleanup, { above: 70 })
  assert.equal('taskSetsTogether' in JSON.parse(readFileSync(out, 'utf8')), false, 'one task set after the other unless the option says otherwise')
  const together = make('--setups', 'opus-fast=baseline,opus-baseline=baseline', '--disk-cleanup', '70', '--task-sets-together')
  assert.equal(together.status, 0, together.stderr)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).taskSetsTogether, true)
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).diskCleanup, { above: 70 })
  const kept = readFileSync(out, 'utf8')
  const bad = make('--setups', 'opus-fast=baseline,opus-baseline=baseline', '--disk-cleanup', '100')
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /"diskCleanup" needs "above"/)
  assert.equal(readFileSync(out, 'utf8'), kept, 'the stage file of before stays')
})
