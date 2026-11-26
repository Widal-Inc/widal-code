// The analysis of the stage "effort" (bench/harbor/v1-effort/analyze.mjs): which records count, the
// measures of the registered plan, and the check that every session ran at its setup's effort level.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { analysis, BASE, compare, loadSetup, LOW, sessionOf } from '../bench/harbor/v1-effort/analyze.mjs'

/** A records folder and a jobs folder with the trials of both setups. */
function stage(trials, { stage = 'effort' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'widal-effort-'))
  const records = join(root, 'v1')
  const jobs = join(root, 'jobs')
  for (const [i, t] of trials.entries()) {
    const trial = `${t.task}__${t.setup}`
    const dir = join(records, 'harbor', t.setup)
    mkdirSync(dir, { recursive: true })
    const record = {
      v: 1, source: 'harbor', taskSet: t.set ?? 'sets/one', task: `sets/${t.task}`, arm: t.setup, rep: 1, trial, model: 'claude-sonnet-5-5',
      seconds: t.seconds ?? 60, reward: t.reward ?? 0, closed: (t.reward ?? 0) === 1, cost: t.cost ?? 0, tokens: { input: 1000 * (t.cost ?? 0), cache: 0, output: 100 * (t.cost ?? 0) },
      error: t.error ?? null, harnessError: t.harnessError ?? null, stage, provider: 'api', setup: t.setup,
    }
    writeFileSync(join(dir, `${t.task}-r1.json`), JSON.stringify(record))
    if (t.efforts === undefined) continue
    const folder = join(jobs, stage, t.setup, 'block-1', '2026-12-01__00-00-00', trial)
    mkdirSync(join(folder, 'agent', 'sessions', 'projects', '-app'), { recursive: true })
    const lines = t.efforts.map((effort) => JSON.stringify({ type: 'api-request', params: effort ? { output_config: { effort } } : {} }))
    lines.push(JSON.stringify({ type: 'assistant', effort: 'not read from here' }), 'not json "api-request"')
    writeFileSync(join(folder, 'agent', 'sessions', 'projects', '-app', `s${i}.jsonl`), lines.join('\n'))
    const turns = t.efforts.map((_, n) => JSON.stringify({ type: 'assistant', message: { id: `m${n}`, usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: n === 0 ? 30000 : 40000 } } }))
    // One message in two lines (text, then a tool call) is one request, and a subagent's line is none.
    turns.push(JSON.stringify({ type: 'assistant', message: { id: 'm0', usage: {} } }), JSON.stringify({ type: 'assistant', parent_tool_use_id: 'x', message: { id: 'sub', usage: {} } }), 'plain text')
    writeFileSync(join(folder, 'agent', 'claude-code.txt'), turns.join('\n'))
  }
  return { records, jobs }
}

const pair = (task, base, low, more = {}) => [
  { task, setup: BASE, efforts: ['medium', 'medium', 'medium'], ...more, ...base },
  { task, setup: LOW, efforts: ['low', 'low'], ...more, ...low },
]

test('a record counts once per task, and never with an error of the harness or without a cost', () => {
  const { records } = stage([
    { task: 'a', setup: BASE, cost: 1, reward: 1 },
    { task: 'b', setup: BASE, cost: 0, harnessError: 'RuntimeError' },
    { task: 'c', setup: BASE, cost: 0 },
    { task: 'd', setup: BASE, cost: 2, error: 'AgentTimeoutError' },
  ])
  const s = loadSetup(records, BASE)
  assert.deepEqual([...s.byTask.keys()], ['sets/a', 'sets/d'])
  assert.deepEqual(s.errors, { RuntimeError: 1, 'no cost': 1 })
  assert.equal(s.all, 4)
  assert.equal(loadSetup(records, BASE, 'another-stage').all, 0)
})

test('a session: the effort level of each request, the first prompt and the requests of the main session', () => {
  const { jobs } = stage([{ task: 'a', setup: BASE, cost: 1, efforts: ['medium', 'low', null] }])
  const s = sessionOf(join(jobs, 'effort', BASE, 'block-1', '2026-12-01__00-00-00', `a__${BASE}`))
  assert.deepEqual(s.efforts, { medium: 1, low: 1, none: 1 })
  assert.equal(s.first, 30030)
  assert.equal(s.requests, 3)
  assert.deepEqual(sessionOf(join(jobs, 'no-such-trial')), { efforts: {}, first: null, requests: 0 })
})

test('the pair is compared on the tasks both ran, with every measure of the plan', () => {
  const { records } = stage([
    ...pair('a', { cost: 1, reward: 1 }, { cost: 0.5, reward: 1 }),
    ...pair('b', { cost: 2, reward: 1 }, { cost: 1, reward: 0, error: 'AgentTimeoutError' }),
    ...pair('c', { cost: 1, reward: 0 }, { cost: 0, harnessError: 'RuntimeError' }),
    { task: 'd', setup: LOW, cost: 9, reward: 1 },
  ])
  const c = compare(loadSetup(records, LOW), loadSetup(records, BASE))
  assert.equal(c.tasks, 2)
  assert.equal(c.costA, 1.5)
  assert.equal(c.costB, 3)
  assert.equal(c.totals.ratio, 0.5)
  assert.equal(c.typical.ratio, 0.5)
  assert.deepEqual([c.solvedA, c.solvedB], [1, 2])
  assert.equal(c.solved.difference, -0.5)
  assert.deepEqual([c.onlyA, c.onlyB], [[], ['sets/b']])
  assert.deepEqual([c.perSolvedA, c.perSolvedB], [1.5, 1.5])
  assert.deepEqual(c.endedA, { AgentTimeoutError: 1 })
  assert.deepEqual(c.endedB, {})
})

test('the analysis: a proven saving with no loss lets the advice cite it, and changes no default', () => {
  const trials = []
  for (let i = 0; i < 30; i++) trials.push(...pair(`t${i}`, { cost: 1 + (i % 5) / 10, reward: i % 2 }, { cost: 0.6 + (i % 4) / 10, reward: i % 2 }, { set: i < 20 ? 'sets/one' : 'sets/two' }))
  const { text, data } = analysis(stage(trials))
  assert.equal(data.primary.tasks, 30)
  assert.ok(data.primary.totals.high < 1)
  assert.deepEqual(data.rule, { savingProven: true, solvedNotLower: true, levelHeld: true, adviceMayCiteTheSaving: true })
  assert.deepEqual(data.setups[BASE].efforts, { medium: 90 })
  assert.deepEqual(data.setups[LOW].efforts, { low: 60 })
  assert.deepEqual(data.sets.map((s) => [s.set, s.tasks]), [['one', 20], ['two', 10]])
  assert.equal(data.primary.requests.a, 2)
  assert.equal(data.primary.requests.b, 3)
  assert.match(text, /the upper end of the interval is below 1, so the saving counts as proven/)
  assert.match(text, /No default changes from this stage, whatever it shows\./)
  assert.match(text, /in every session whose files were read: yes\./)
  assert.equal([...text].some((c) => c.charCodeAt(0) === 0x2013 || c.charCodeAt(0) === 0x2014), false, 'no dash in the report')
})

test('the analysis: a session at another effort level than its setup fails the level check', () => {
  const trials = []
  for (let i = 0; i < 12; i++) trials.push(...pair(`t${i}`, { cost: 1, reward: 1 }, { cost: 0.5, reward: 1, efforts: i === 3 ? ['low', 'medium'] : ['low'] }))
  const { text, data } = analysis(stage(trials))
  assert.deepEqual(data.setups[LOW].otherLevel, ['sets/t3'])
  assert.equal(data.rule.levelHeld, false)
  assert.equal(data.rule.adviceMayCiteTheSaving, false)
  assert.match(text, /Sessions of `effort-low` with a request at another level: sets\/t3\./)
})

test('the analysis: without the jobs folder the level check is not done, and nothing may be cited', () => {
  const trials = []
  for (let i = 0; i < 12; i++) trials.push(...pair(`t${i}`, { cost: 1, reward: 1 }, { cost: 0.5, reward: 1 }))
  const { records } = stage(trials)
  const { text, data } = analysis({ records })
  assert.equal(data.rule.levelHeld, null)
  assert.equal(data.rule.adviceMayCiteTheSaving, false)
  assert.match(text, /not checked, no jobs folder was given/)
})

test('the analysis: a lower share solved with an interval that excludes no change is said, and nothing may be cited', () => {
  const trials = []
  for (let i = 0; i < 40; i++) trials.push(...pair(`t${i}`, { cost: 1, reward: 1 }, { cost: 0.5, reward: i < 16 ? 0 : 1 }))
  const { text, data } = analysis(stage(trials))
  assert.equal(data.rule.savingProven, true)
  assert.equal(data.rule.solvedNotLower, false)
  assert.equal(data.rule.adviceMayCiteTheSaving, false)
  assert.match(text, /The share solved is lower, with an interval that excludes no change\./)
})

test('a dry run names another stage, other setups and other levels', () => {
  const trials = []
  for (let i = 0; i < 6; i++) {
    trials.push({ task: `t${i}`, setup: 'x-base', cost: 1, reward: 1, efforts: ['high'] }, { task: `t${i}`, setup: 'x-low', cost: 0.9, reward: 1, efforts: ['low'] })
  }
  const folders = stage(trials, { stage: 'x' })
  const { data } = analysis({ ...folders, stage: 'x', base: 'x-base', low: 'x-low', levels: { 'x-base': 'high', 'x-low': 'low' } })
  assert.equal(data.primary.tasks, 6)
  assert.equal(data.rule.levelHeld, true)
  assert.equal(analysis(folders).data.primary.tasks, 0)
})

test('the command prints the analysis, and refuses records in which no task was run by both setups', () => {
  const script = fileURLToPath(new URL('../bench/harbor/v1-effort/analyze.mjs', import.meta.url))
  const trials = []
  for (let i = 0; i < 6; i++) trials.push(...pair(`t${i}`, { cost: 1, reward: 1 }, { cost: 0.5, reward: 1 }))
  const { records, jobs } = stage(trials)
  const json = join(records, 'analysis.json')
  const good = spawnSync(process.execPath, [script, '--records', records, '--jobs', jobs, '--json', json], { encoding: 'utf8' })
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /^## What ran/)
  assert.ok(existsSync(json))
  const empty = spawnSync(process.execPath, [script, '--records', join(records, 'nothing-here'), '--json', join(records, 'none.json')], { encoding: 'utf8' })
  assert.equal(empty.status, 1)
  assert.match(empty.stderr, /No task of the stage "effort" was run by both setups/)
  assert.equal(empty.stdout, '')
  assert.equal(existsSync(join(records, 'none.json')), false)
})

test('the registered files of the stage: two setups that differ in the effort level only, on tasks the test did not run', async () => {
  const { readFileSync } = await import('node:fs')
  const { stageOf } = await import('../bench/harbor-stage.mjs')
  const read = (name) => JSON.parse(readFileSync(new URL(`../bench/harbor/${name}`, import.meta.url), 'utf8'))
  const { setups } = read('v1-effort/setups.json')
  assert.deepEqual(setups.map((s) => s.id), [BASE, LOW])
  const [base, low] = setups.map(({ id, name, ...rest }) => rest)
  assert.equal('effort' in base, false, 'the baseline sets no effort level')
  assert.deepEqual(low, { ...base, effort: 'low' })
  const file = read('v1-effort/stage.json')
  const stage = stageOf(structuredClone(file))
  assert.equal(stage.name, 'effort')
  assert.deepEqual(stage.setups.map((s) => [s.id, s.model, s.rep]), [[BASE, 'anthropic/claude-sonnet-5-5', 1], [LOW, 'anthropic/claude-sonnet-5-5', 1]])
  assert.equal(stage.reference, BASE)
  assert.equal(stage.tasks.length, 125)
  assert.equal(new Set(stage.tasks.map((t) => t.task)).size, 125)
  assert.deepEqual([stage.cap, stage.blockSize, stage.concurrency, stage.taskSetsTogether, stage.diskCleanup.above], [40, 25, 3, true, 70])
  const pool = new Set(read('v1-tasks.json').tasks.map((t) => t.task))
  const test20 = new Set(read('v1-lean/stage.json').testTasksLeftOut)
  assert.equal(test20.size, 20)
  assert.deepEqual(stage.tasks.filter((t) => !pool.has(t.task) || test20.has(t.task)), [])
  assert.ok(file.setupsFile.endsWith('bench/harbor/v1-effort/setups.json'))
})
