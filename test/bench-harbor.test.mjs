// The benchmark on public task sets through Harbor (bench/harbor.mjs): reading Harbor's results
// into records, and the report with intervals. Uses a made-up jobs folder in a temp folder.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importJobs, markdown, readRecords, recordOf, report, taskFile } from '../bench/harbor.mjs'
import { signTest } from '../bench/stats.mjs'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-bench-harbor-test-'))

/** A result.json of Harbor's, with only the fields the benchmark reads. */
function result({ task, setup, set = 'set-a', cost = 1, reward = 1, seconds = 100, error = null }) {
  const start = Date.parse('2026-11-22T10:00:00Z')
  return {
    task_name: task,
    trial_name: `${task}__${setup}`,
    config: { task: { source: set }, agent: { kwargs: { setups: '/x/setups.json', setup }, model_name: 'anthropic/claude-fable-5-2' } },
    agent_info: { name: 'claude-code', version: '2.1.330', model_info: { name: 'claude-fable-5-2', provider: 'anthropic' } },
    agent_result: cost === null ? null : { cost_usd: cost, n_input_tokens: 1000, n_cache_tokens: 800, n_output_tokens: 50 },
    verifier_result: reward === null ? null : { rewards: { reward } },
    exception_info: error ? { exception_type: error, exception_message: 'x', exception_traceback: '', occurred_at: '2026-11-22T10:00:00Z' } : null,
    started_at: new Date(start).toISOString(),
    agent_execution: { started_at: new Date(start).toISOString(), finished_at: new Date(start + seconds * 1000).toISOString() },
  }
}

function writeTrial(jobs, r) {
  const folder = join(jobs, 'job-1', r.trial_name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'result.json'), JSON.stringify(r))
}

test('a trial becomes a record with the setup as its arm', () => {
  const r = recordOf(result({ task: 'org/task-1', setup: 'baseline', cost: 2.5, reward: 1, seconds: 90 }))
  assert.equal(r.arm, 'baseline')
  assert.equal(r.task, 'org/task-1')
  assert.equal(r.taskSet, 'set-a')
  assert.equal(r.cost, 2.5)
  assert.equal(r.seconds, 90)
  assert.equal(r.closed, true)
  assert.equal(r.harnessError, null)
  assert.deepEqual(r.tokens, { input: 1000, cache: 800, output: 50 })
  assert.equal(recordOf(result({ task: 't', setup: 'x', reward: 0.5 })).closed, false, 'a partial reward is not solved')
  assert.equal(recordOf(result({ task: 't', setup: 'x' }), { arm: 'given' }).arm, 'given')
})

test('an error before the agent spent anything is the harness', () => {
  const r = recordOf(result({ task: 't', setup: 'x', cost: null, reward: null, error: 'EnvironmentStartError' }))
  assert.equal(r.harnessError, 'EnvironmentStartError')
  const agentError = recordOf(result({ task: 't', setup: 'x', cost: 1.2, reward: 0, error: 'AgentTimeoutError' }))
  assert.equal(agentError.harnessError, null, 'a session that spent money and then failed is the agent\'s miss')
  assert.equal(agentError.error, 'AgentTimeoutError')
})

test('task names become file names without slashes', () => {
  assert.equal(taskFile('org/name:1.0 x'), 'org_name_1.0_x')
})

test('import and report: each arm against the baseline, with intervals', () => {
  const jobs = join(dir, 'jobs')
  const out = join(dir, 'out')
  const tasks = ['a/t1', 'a/t2', 'a/t3', 'b/t4', 'b/t5', 'b/t6']
  tasks.forEach((task, i) => {
    const set = task.startsWith('a/') ? 'set-a' : 'set-b'
    writeTrial(jobs, result({ task, setup: 'baseline', set, cost: 2 + i, seconds: 200 }))
    writeTrial(jobs, result({ task, setup: 'cheaper', set, cost: (2 + i) / 2, seconds: 100, reward: i === 5 ? 0 : 1 }))
  })
  writeTrial(jobs, result({ task: 'b/t7', setup: 'cheaper', set: 'set-b', cost: null, reward: null, error: 'EnvironmentStartError' }))

  const records = importJobs(jobs, out)
  assert.equal(records.length, 13)
  assert.ok(existsSync(join(out, 'harbor', 'cheaper', 'a_t1-r1.json')))
  const back = readRecords(out)
  assert.equal(back.length, 13)

  const r = report(back)
  const cheaper = r.arms.find((x) => x.arm === 'cheaper')
  assert.equal(cheaper.tasks, 6, 'the trial with the harness error counts in no total')
  assert.equal(cheaper.solved, 5)
  assert.equal(cheaper.solvedOnlyBaseline, 1)
  assert.ok(Math.abs(cheaper.costRatio.ratio - 0.5) < 1e-9)
  assert.ok(Math.abs(cheaper.timeRatio.ratio - 0.5) < 1e-9)
  assert.equal(cheaper.costSign.less, 6)
  assert.equal(r.failed.length, 1)
  assert.deepEqual(r.bySet.map((s) => s.set), ['set-a', 'set-b'])

  const text = markdown(r)
  assert.match(text, /\| cheaper \| 6 \| 5 = 83%/)
  assert.match(text, /-16\.7 \(/)
  assert.match(text, /-50% \(-50% to -50%\)/)
  assert.match(text, /## set-b/)
  assert.match(text, /EnvironmentStartError/)
})

test('the sign test counts both directions and leaves ties out', () => {
  assert.deepEqual(signTest([{ a: 1, b: 2 }, { a: 1, b: 1 }]), { less: 1, n: 1, chance: 1 })
  const all = signTest(Array.from({ length: 13 }, () => ({ a: 1, b: 2 })))
  assert.equal(all.less, 13)
  assert.ok(Math.abs(all.chance - 2 / 2 ** 13) < 1e-12)
  assert.deepEqual(signTest([]), { less: 0, n: 0, chance: null })
})
