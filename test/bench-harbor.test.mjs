// The benchmark on public task sets through Harbor (bench/harbor.mjs): reading Harbor's results
// into records, and the report with intervals. Uses a made-up jobs folder in a temp folder.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { endOf, importJobs, markdown, markVerifier, readRecords, recordOf, report, taskFile, trialsOf, USAGE_LIMIT, usageLimitReached, verifierBlocked } from '../bench/harbor.mjs'
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
  // The tokens of a whole trial are many calls: 5 million input tokens at $2 a million is $10, not the
  // price of one long prompt.
  const sum = costOf({ n_input_tokens: 5_000_000, n_cache_tokens: 4_000_000, n_output_tokens: 100_000 }, 'openai/gpt-6.2-sol')
  assert.ok(Math.abs(sum.cost - (2 + 0.4 + 1)) < 1e-9, String(sum.cost))
})

test("a Codex trial that ended on an error after it spent tokens is the agent's miss, not the harness's", () => {
  const r = recordOf({
    task_name: 't1', trial_name: 't1__a', config: { agent: { model_name: 'openai/gpt-6.2-sol', kwargs: { setup: 'openai-sol' } } },
    agent_result: { cost_usd: null, n_input_tokens: 200_000, n_cache_tokens: 100_000, n_output_tokens: 5_000 },
    exception_info: { exception_type: 'AgentTimeoutError' },
  })
  assert.equal(r.costSource, 'tokens')
  assert.equal(r.harnessError, null)
  assert.equal(r.error, 'AgentTimeoutError')
})

test('import files a trial only under its own setup, and keeps a finished trial over a failed rerun', () => {
  const jobs = join(dir, 'jobs-two-runs')
  const out = join(dir, 'out-two-runs')
  const first = result({ task: 'a/t1', setup: 'baseline', cost: 2 })
  const second = result({ task: 'a/t1', setup: 'baseline-2', cost: 3 })
  writeTrial(jobs, first)
  writeTrial(jobs, second)
  importJobs(jobs, out, { arm: 'baseline', rep: 1, setup: 'baseline' })
  importJobs(jobs, out, { arm: 'baseline', rep: 2, setup: 'baseline-2' })
  const back = readRecords(out).sort((x, y) => x.rep - y.rep)
  assert.deepEqual(back.map((r) => [r.rep, r.cost]), [[1, 2], [2, 3]])

  const again = join(dir, 'jobs-rerun')
  writeTrial(again, { ...result({ task: 'a/t1', setup: 'baseline', cost: null, reward: null, error: 'AgentSetupTimeoutError' }), trial_name: 'a/t1__rerun' })
  const written = importJobs(again, out, { arm: 'baseline', rep: 1, setup: 'baseline' })
  assert.equal(written.length, 0)
  assert.equal(readRecords(out).find((r) => r.rep === 1).cost, 2, 'the finished trial stays')
})

test('a verifier that could not reach GitHub marks the record, at import and afterwards', () => {
  assert.equal(verifierBlocked('downloading uv 0.9.5\ncurl: (7) Failed to connect to github.com port 443 after 0 ms'), true)
  assert.equal(verifierBlocked('curl: (7) Failed to connect to raw.githubusercontent.com port 443'), true)
  assert.equal(verifierBlocked('1 passed'), false)
  const jobs = join(dir, 'jobs-verifier')
  const out = join(dir, 'out-verifier')
  const r = result({ task: 'tb/t1', setup: 'baseline', reward: 0 })
  writeTrial(jobs, r)
  const folder = join(jobs, 'job-1', r.trial_name)
  importJobs(jobs, out)
  assert.equal(readRecords(out)[0].verifierBlocked, false)
  mkdirSync(join(folder, 'verifier'), { recursive: true })
  writeFileSync(join(folder, 'verifier', 'test-stdout.txt'), 'curl: (7) Failed to connect to github.com port 443 after 0 ms')
  assert.deepEqual(markVerifier(jobs, out), { seen: 1, marked: 1 })
  assert.equal(readRecords(out)[0].verifierBlocked, true)
  importJobs(jobs, out)
  assert.equal(readRecords(out)[0].verifierBlocked, true, 'import reads the verifier log too')
})

test('a task whose verifier could not reach GitHub counts in cost but in no solved number', () => {
  const rec = (task, arm, rep, cost, closed, verifierBlocked = false) => ({ task, arm, rep, cost, closed, seconds: 10, stage: 'main', taskSet: 's', harnessError: null, verifierBlocked })
  const records = []
  for (let i = 0; i < 10; i++) for (const rep of [1, 2]) records.push(rec(`t${i}`, 'baseline', rep, 2, true), rec(`t${i}`, 'tool', rep, 1, i !== 0))
  // The blocked task: one trial of one arm is marked, and the task leaves every arm's solved numbers.
  for (const rep of [1, 2]) records.push(rec('tb', 'baseline', rep, 2, false, rep === 1), rec('tb', 'tool', rep, 1, false))
  const r = report(records)
  const tool = r.arms.find((x) => x.arm === 'tool')
  const base = r.arms.find((x) => x.arm === 'baseline')
  assert.deepEqual(r.unscored, ['tb'])
  assert.equal(tool.tasks, 11, 'the task still counts in cost')
  assert.equal(tool.scoredRuns, 20)
  assert.equal(tool.solved, 18)
  assert.equal(base.solved, 20)
  assert.equal(base.solvedShare.share, 1)
  assert.equal(tool.solvedOnlyBaseline, 2)
  assert.ok(Math.abs(tool.costRatio.ratio - 0.5) < 1e-9)
  assert.equal(r.noise.tasks, 10)
  assert.equal(r.noise.costTasks, 11)
  const text = markdown(r)
  assert.match(text, /1 tasks count in cost and time but in no solved number/)
  assert.match(text, /## Tasks whose tests could not reach GitHub/)
  assert.match(text, /- tb/)
})

// The usage limit of the model account. The texts are made up after what the runs showed: the API's
// error 400 as Claude Code prints it, in the last line of the agent's output or in Harbor's exception.

const LIMIT_MESSAGE = 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'
const API_ERROR = `API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"${LIMIT_MESSAGE}"}}`
/** Lines of Claude Code's output: what the model says, what a tool gives back, and how the session ends. */
const says = (text) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const tool = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] } })
const ends = (text, over = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, ...over })

function writeOutput(jobs, r, text, name = 'claude-code.txt') {
  const folder = join(jobs, 'job-1', r.trial_name, 'agent')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, name), text)
}

test('the text of the usage limit is matched in any case of letters, and nothing near it', () => {
  assert.ok(USAGE_LIMIT.test(LIMIT_MESSAGE))
  assert.ok(USAGE_LIMIT.test('API ERROR 400: USAGE LIMITS REACHED'))
  assert.ok(USAGE_LIMIT.test('Claude AI usage limit reached'))
  assert.ok(USAGE_LIMIT.test("You've hit your usage limit."))
  assert.ok(USAGE_LIMIT.test('harbor.agents.installed.base.ApiUsageLimitError'))
  for (const other of ['API Error: 429 rate limit', 'Reached maximum budget ($4)', 'API Error: 500 Internal server error', 'the limit of the context window', '']) assert.ok(!USAGE_LIMIT.test(other), other)
})

test('only the agent\'s own last words count, not the model\'s text or a tool\'s output', () => {
  const quoted = [says(`The test expects "${LIMIT_MESSAGE}"`), tool(`raise UsageError("usage limit reached")`), ends('Done. The client now reports "usage limit reached".')].join('\n')
  assert.equal(endOf(quoted), '', 'a session that ended well has no error line')
  assert.equal(usageLimitReached({}, quoted), false)

  const refused = [says('I will read the file.'), says(API_ERROR), ends(API_ERROR, { is_error: true })].join('\n')
  assert.equal(endOf(refused), ends(API_ERROR, { is_error: true }))
  assert.equal(usageLimitReached({}, refused), true)

  assert.equal(usageLimitReached({}, JSON.stringify({ type: 'result', subtype: 'error_during_execution', result: 'usage limit reached' })), true, 'a result whose subtype is an error')
  assert.equal(usageLimitReached({}, JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } })), true, 'a failed turn of Codex is an error line too')
  assert.equal(usageLimitReached({}, 'Claude AI usage limit reached|1764547200\n'), true, 'a line that is not JSON is the program\'s own')
  assert.equal(usageLimitReached({}, ends('Reached maximum budget ($4)', { subtype: 'error_max_budget_usd', is_error: true })), false, 'the budget of one session is the agent\'s own limit')
  assert.equal(usageLimitReached({}, '{"type":"result","is_error":true,"result":"usage limit reached'), false, 'half a line is not read')

  const exception = (type, message) => ({ exception_info: { exception_type: type, exception_message: message } })
  assert.equal(usageLimitReached(exception('NonZeroAgentExitCodeError', `Command failed (exit 1): claude --print\nstdout: ${API_ERROR}\nstderr: None`)), true)
  assert.equal(usageLimitReached(exception('ApiUsageLimitError', 'Command failed (exit 1)')), true, 'Harbor names the error itself')
  assert.equal(usageLimitReached(exception('AgentTimeoutError', 'Agent execution timed out after 3000 seconds')), false)
})

test('a trial that ended at the usage limit is an error of the harness, also when it spent money', () => {
  const refused = ends(API_ERROR, { is_error: true })
  // The session spent $0.07 before the account was refused, and the verifier gave reward 0.
  const spent = recordOf(result({ task: 't', setup: 'x', cost: 0.07, reward: 0, error: 'NonZeroAgentExitCodeError' }), { output: refused })
  assert.equal(spent.harnessError, 'UsageLimitReached')
  assert.equal(spent.error, 'UsageLimitReached')
  assert.equal(spent.closed, false)
  assert.equal(spent.cost, 0.07, 'the money was spent, so the ledger still counts it')
  // Claude Code ended with exit code 0, so Harbor saw no error at all.
  const quiet = recordOf(result({ task: 't', setup: 'x', cost: 0.07, reward: 0 }), { output: refused })
  assert.equal(quiet.harnessError, 'UsageLimitReached')
  // The same trial without that line is the agent's miss, as before.
  const miss = recordOf(result({ task: 't', setup: 'x', cost: 0.07, reward: 0, error: 'NonZeroAgentExitCodeError' }), { output: ends('I could not fix it.') })
  assert.equal(miss.harnessError, null)
  assert.equal(miss.error, 'NonZeroAgentExitCodeError')
})

test('import reads the end of the agent\'s output, and the report counts such a trial in no number', () => {
  const jobs = join(dir, 'jobs-limit')
  const out = join(dir, 'out-limit')
  const refused = `${ends(API_ERROR, { is_error: true })}\n`
  for (const task of ['a/t1', 'a/t2', 'a/t3']) {
    writeTrial(jobs, result({ task, setup: 'baseline', cost: 2 }))
    writeTrial(jobs, result({ task, setup: 'tool', cost: 1, reward: task === 'a/t3' ? 0 : 1 }))
  }
  // t3 of "tool" ended at the usage limit. t2 of "tool" only quotes the words, in megabytes of output:
  // the last part of the file is read from the start of a line, so the cut line of the model is dropped.
  writeOutput(jobs, result({ task: 'a/t3', setup: 'tool' }), `${says('I will read the file.')}\n${refused}`)
  writeOutput(jobs, result({ task: 'a/t2', setup: 'tool' }), `${says(`usage limit reached ${'x'.repeat(400_000)} usage limit reached`)}\n${ends('Done.')}\n`)
  // A Codex trial keeps its output under another name.
  writeTrial(jobs, result({ task: 'a/t4', setup: 'tool', cost: 1, reward: 0 }))
  writeOutput(jobs, result({ task: 'a/t4', setup: 'tool' }), `${JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } })}\n`, 'codex.txt')

  importJobs(jobs, out)
  const records = readRecords(out)
  assert.deepEqual(records.filter((r) => r.harnessError).map((r) => [r.arm, r.task, r.harnessError]), [['tool', 'a/t3', 'UsageLimitReached'], ['tool', 'a/t4', 'UsageLimitReached']])
  const r = report(records)
  const row = r.arms.find((x) => x.arm === 'tool')
  assert.equal(row.tasks, 2, 'the two trials at the usage limit count in no total')
  assert.equal(row.solved, 2, 'and not as tasks the tool failed')
  assert.deepEqual(r.failed.map((f) => [f.task, f.error]), [['a/t3', 'UsageLimitReached'], ['a/t4', 'UsageLimitReached']])
  assert.match(markdown(r), /\| tool \| a\/t3 \| 1 \| UsageLimitReached \|/)

  // A trial that finished is not replaced when it runs again and ends at the usage limit.
  const again = join(dir, 'jobs-limit-again')
  const rerun = { ...result({ task: 'a/t1', setup: 'tool', cost: 0.01, reward: 0 }), trial_name: 'a/t1__again' }
  writeTrial(again, rerun)
  writeOutput(again, rerun, refused)
  assert.equal(importJobs(again, out).length, 0)
  assert.equal(readRecords(out).find((x) => x.arm === 'tool' && x.task === 'a/t1').closed, true)
})

test('the trials of given tasks in a jobs folder are counted', () => {
  const jobs = join(dir, 'jobs-count')
  assert.equal(trialsOf(jobs, ['a/t1']), 0, 'a folder that is not there has no trial')
  writeTrial(jobs, result({ task: 'a/t1', setup: 'baseline' }))
  writeTrial(jobs, result({ task: 'a/t2', setup: 'baseline' }))
  assert.equal(trialsOf(jobs, ['a/t1', 'a/t9']), 1)
  assert.equal(trialsOf(jobs, ['a/t1', 'a/t2']), 2)
})
