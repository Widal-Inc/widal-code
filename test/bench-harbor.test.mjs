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
  assert.match(text, /\| cheaper \| 6 \| 6 \| 5 = 83%/)
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

test('report with two runs per task, an unranked arm, a quality margin and excluded tasks', () => {
  const rec = (task, arm, rep, cost, closed, stage = 'main') => ({ task, arm, rep, cost, closed, seconds: 10, stage, taskSet: 's', harnessError: null })
  const records = []
  for (let i = 0; i < 20; i++) {
    const t = `t${i}`
    for (const rep of [1, 2]) {
      records.push(rec(t, 'baseline', rep, 2, i % 5 !== 0 || rep === 1))
      records.push(rec(t, 'tool', rep, 1, true))
      records.push(rec(t, 'other', rep, 1.9, true))
      records.push(rec(t, 'limited', rep, 1.5, true))
    }
  }
  records.push(rec('tuned', 'tool', 1, 0.1, true), rec('tuned', 'baseline', 1, 9, false))
  records.push(rec('t0', 'tool', 1, 5, true, 'pilot'))
  const r = report(records, { stages: ['main'], unranked: ['limited'], margin: 0.03, exclude: ['tuned'] })
  const tool = r.arms.find((x) => x.arm === 'tool')
  assert.equal(tool.tasks, 20)
  assert.equal(tool.runs, 40)
  assert.ok(Math.abs(tool.costRatio.ratio - 0.5) < 1e-9, 'the excluded task and the other stage count in no number')
  assert.ok(tool.costChanceHolm >= tool.costSign.chance)
  assert.equal(tool.keepsQuality, true)
  assert.deepEqual(r.unranked.map((x) => x.arm), ['limited'])
  assert.ok(!r.arms.some((x) => x.arm === 'limited'))
  assert.equal(r.unranked[0].costChanceHolm, undefined)
  assert.equal(r.noise.tasks, 20)
  assert.ok(Math.abs(r.noise.discordance - 0.2) < 1e-9)
  const text = markdown(r)
  assert.match(text, /## Reported, not ranked/)
  assert.match(text, /## Noise between two runs of the baseline/)
  assert.match(text, /keeps quality \(margin 3 points\)/)
  assert.match(text, /1 tasks are left out/)
})

test('a trial with tokens but no reported cost is priced from its tokens', async () => {
  const { costOf } = await import('../bench/harbor.mjs')
  assert.deepEqual(costOf({ cost_usd: 1.5 }, 'x'), { cost: 1.5, costSource: 'reported' })
  const c = costOf({ cost_usd: null, n_input_tokens: 100_000, n_cache_tokens: 0, n_output_tokens: 0 }, "openai/gpt-6.1-sol")
  assert.equal(c.costSource, 'tokens')
  assert.ok(Math.abs(c.cost - 0.2) < 1e-9, String(c.cost))
  assert.deepEqual(costOf({ n_input_tokens: 5, n_output_tokens: 5 }, 'no-such-model'), { cost: null, costSource: null })
})
