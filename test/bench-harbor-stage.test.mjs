// A stage of the benchmark on public task sets (bench/harbor-stage.mjs): blocks, the ledger, the stop
// rules, the status file, the Harbor commands and the order they run in. Nothing here starts Harbor or
// Docker: the loop of the stage runs on a made-up Harbor that writes made-up trial folders.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { blocksOf, cleanDisk, commandsOf, DISK_CLEANUP, diskUsed, DockerNotReady, dockerReady, groupsOf, ledgerOf, perSet, planOf, runStage, runWithRetry, shuffled, stageOf, statusOf, stopRule, togetherOf } from '../bench/harbor-stage.mjs'
import { readRecords } from '../bench/harbor.mjs'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-bench-stage-test-'))
const tasks = Array.from({ length: 7 }, (_, i) => ({ dataset: i < 4 ? 'org/set-a' : 'org/set-b', task: `org/task-${i}` }))
const base = {
  name: 'pilot',
  out: join(dir, 'out'),
  jobs: join(dir, 'jobs'),
  setupsFile: '/x/setups.json',
  claudeCode: '2.1.330',
  cap: 100,
  providerCaps: { api: 1500, bedrock: 1500 },
  commands: { api: ['/x/with-key.sh', '/x/harbor.sh'], bedrock: ['/x/harbor.sh'] },
  env: { bedrock: { CLAUDE_CODE_USE_BEDROCK: '1' } },
  setups: [
    { id: 'baseline', model: 'anthropic/claude-sonnet-5-5', provider: 'api' },
    { id: 'tool', model: 'anthropic/claude-sonnet-5-5', provider: 'api' },
  ],
  tasks,
  blockSize: 3,
  seed: 7,
}
const record = (over) => ({ stage: 'pilot', provider: 'api', setup: 'baseline', arm: 'baseline', task: 'org/task-0', rep: 1, cost: 1, closed: true, error: null, harnessError: null, ...over })

test('the shuffle and the blocks are fixed by the seed', () => {
  const a = shuffled(tasks, 7)
  assert.deepEqual(a, shuffled(tasks, 7))
  assert.notDeepEqual(a, shuffled(tasks, 8))
  assert.deepEqual([...a].sort((x, y) => x.task.localeCompare(y.task)), tasks)
  const blocks = blocksOf(tasks, 3, 7)
  assert.deepEqual(blocks.map((b) => b.length), [3, 3, 1])
})

test('a stage file is checked and filled in', () => {
  const s = stageOf(base)
  assert.equal(s.concurrency, 2)
  assert.equal(s.stopAt, 0.9)
  assert.equal(s.reference, 'baseline')
  assert.equal(s.setups[1].arm, 'tool')
  assert.equal(s.setups[1].rep, 1)
  assert.throws(() => stageOf({ ...base, cap: 0 }), /cap/)
  assert.throws(() => stageOf({ ...base, setups: [{ id: 'x', model: 'm', provider: 'other' }] }), /command for the provider "other"/)
  assert.throws(() => stageOf({ ...base, setups: [base.setups[0], { ...base.setups[1], provider: 'bedrock' }] }), /same provider/)
})

test('the ledger adds up the reported cost per provider and per stage', () => {
  const l = ledgerOf([record({ cost: 2 }), record({ provider: 'bedrock', cost: 3 }), record({ stage: 'main', cost: 4 }), record({ cost: null })])
  assert.equal(l.total, 9)
  assert.deepEqual(l.providers, { api: 6, bedrock: 3 })
  assert.deepEqual(l.stages, { pilot: 5, main: 4 })
})

test('the stage stops at 90% of its cap or of a provider\'s cap', () => {
  const s = stageOf(base)
  assert.equal(stopRule([record({ cost: 89 })], s, { blocksDone: 1 }).stop, false)
  assert.match(stopRule([record({ cost: 90 })], s, { blocksDone: 1 }).why, /the stage spent \$90\.00/)
  const other = [record({ stage: 'fable', cost: 1350 })]
  assert.match(stopRule(other, s, { blocksDone: 1 }).why, /provider "api"/)
})

test('the stage stops when too many trials of a block fail in the harness', () => {
  const s = stageOf(base)
  const block = [record({ harnessError: 'EnvironmentStartError', cost: 0 }), record({ task: 'org/task-1' }), record({ task: 'org/task-2' })]
  assert.match(stopRule(block, s, { blocksDone: 1, lastBlock: block }).why, /1 of 3 trials/)
})

test('the safety rule stops a setup that solves far fewer tasks, after two blocks only', () => {
  const s = stageOf(base)
  const records = [
    ...[0, 1, 2, 3].map((i) => record({ task: `org/task-${i}`, cost: 0.1 })),
    ...[0, 1, 2, 3].map((i) => record({ task: `org/task-${i}`, setup: 'tool', arm: 'tool', cost: 0.1, closed: i === 0 })),
  ]
  assert.equal(stopRule(records, s, { blocksDone: 1 }).stop, false)
  assert.match(stopRule(records, s, { blocksDone: 2 }).why, /safety rule/)
})

test('the status shows spend and health, and no solved tasks or cost per setup', () => {
  const s = stageOf(base)
  const text = statusOf([record({ cost: 12.5 }), record({ setup: 'tool', arm: 'tool', cost: 3, error: 'AgentTimeoutError', closed: false })], s, { blocksDone: 1, blocks: 3 })
  assert.match(text, /\| this stage \| \$15\.50 \| \$100\.00 \| 16% \|/)
  assert.match(text, /\| tool \| 1 \| 0 \| 1 \|/)
  assert.doesNotMatch(text, /solved \|/i)
  assert.doesNotMatch(text, /\$12\.50/)
})

test('the Harbor commands of a block, one per task set, without the tasks already done', () => {
  const s = stageOf(base)
  const block = [tasks[0], tasks[1], tasks[5]]
  const [a, b] = commandsOf(s, s.setups[0], block, 1)
  assert.equal(a.program, '/x/with-key.sh')
  assert.deepEqual(a.args.slice(0, 4), ['/x/harbor.sh', 'run', '-d', 'org/set-a'])
  assert.deepEqual(a.tasks, ['org/task-0', 'org/task-1'])
  assert.ok(a.args.includes('*task-0') && a.args.includes('setup=baseline') && a.args.includes('version=2.1.330'))
  assert.equal(b.tasks.length, 1)
  const bedrock = stageOf({ ...base, setups: base.setups.map((x) => ({ ...x, provider: 'bedrock' })) })
  const [bed] = commandsOf(bedrock, bedrock.setups[1], [tasks[0]], 1)
  assert.equal(bed.program, '/x/harbor.sh')
  assert.ok(bed.args.includes('CLAUDE_CODE_USE_BEDROCK=1'))

  mkdirSync(join(s.out, 'harbor', 'baseline'), { recursive: true })
  writeFileSync(join(s.out, 'harbor', 'baseline', 'org_task-0-r1.json'), JSON.stringify(record({})))
  const [again] = commandsOf(s, s.setups[0], block, 1)
  assert.deepEqual(again.tasks, ['org/task-1'], 'a finished task is not run again')
})

test('task sets that run together each get their trials at a time, a log and a start of their own', () => {
  assert.equal(perSet(20, 8), 8)
  assert.equal(perSet(12, 8), 6)
  assert.equal(perSet(3, 8), 2)
  assert.equal(perSet(1, 8), 1)
  const s = stageOf({ ...base, concurrency: 8, taskSetsTogether: true })
  const commands = commandsOf(s, s.setups[1], tasks, 1)
  const [a, b] = togetherOf(commands, s.concurrency)
  assert.equal(a.args[a.args.indexOf('-n') + 1], '2')
  assert.equal(b.args[b.args.indexOf('-n') + 1], '2')
  assert.equal(commands[0].args[commands[0].args.indexOf('-n') + 1], '8', 'the commands made for one after the other are left as they are')
  assert.equal(a.folder, b.folder)
  assert.notEqual(a.log, b.log)
  assert.deepEqual([a.delay, b.delay], [0, 2500])
})

test('a value ${env:NAME} is read from the environment and masked in logs', async () => {
  const { expand, mask } = await import('../bench/harbor-stage.mjs')
  process.env.BENCH_TEST_SECRET = 'very-secret-value-123'
  assert.equal(expand('${env:BENCH_TEST_SECRET}'), 'very-secret-value-123')
  assert.equal(expand('plain'), 'plain')
  assert.throws(() => expand('${env:BENCH_TEST_MISSING}'), /BENCH_TEST_MISSING/)
  assert.equal(mask('a very-secret-value-123 b sk-proj-abcdefghijklmnop1234 c'), 'a [key] b [key] c')
  delete process.env.BENCH_TEST_SECRET
})

test('Codex runs its setup with codex_setup_agent.py, and another Harbor agent gets no setup', async () => {
  const { commandsOf, stageOf } = await import('../bench/harbor-stage.mjs')
  const stage = stageOf({
    name: 'x', out: '/tmp/widal-bench-none', jobs: '/tmp/j', setupsFile: '/s.json', claudeCode: '2.1.330', cap: 10,
    commands: { openai: ['/run.sh', '/harbor.sh'] },
    setups: [
      { id: 'openai-sol', model: 'openai/gpt-6.2-sol', provider: 'openai', agent: 'codex' },
      { id: 'aider', model: 'openai/gpt-6.2-sol', provider: 'openai', agent: 'aider' },
    ],
    tasks: [{ dataset: 'd', task: 'd/t1' }],
  })
  const [c] = commandsOf(stage, stage.setups[0], stage.tasks, 1)
  assert.equal(c.args[c.args.indexOf('-a') + 1], 'bench.harbor.codex_setup_agent:CodexSetupAgent')
  assert.ok(c.args.includes('setup=openai-sol'))
  assert.ok(c.args.includes('setups=/s.json'))
  const [other] = commandsOf(stage, stage.setups[1], stage.tasks, 1)
  assert.equal(other.args[other.args.indexOf('-a') + 1], 'aider')
  assert.ok(!other.args.includes('--ak'))
})

test('each setup, also a second run of an arm, gets a job folder of its own', () => {
  const s = stageOf({ ...base, setups: [...base.setups, { id: 'baseline-2', arm: 'baseline', rep: 2, model: 'anthropic/claude-sonnet-5-5', provider: 'api' }] })
  const [one] = commandsOf(s, s.setups[0], [tasks[3]], 1)
  const [two] = commandsOf(s, s.setups[2], [tasks[3]], 1)
  assert.equal(one.folder, join(s.jobs, 'pilot', 'baseline', 'block-1'))
  assert.equal(two.folder, join(s.jobs, 'pilot', 'baseline-2', 'block-1'))
  const i = one.args.indexOf('--agent-setup-timeout-multiplier')
  assert.equal(one.args[i + 1], '5', 'the setup of an agent gets five times Harbor\'s time by default, which is 30 minutes')
  const none = stageOf({ ...base, setupTimeoutMultiplier: 0 })
  assert.ok(!commandsOf(none, none.setups[0], [tasks[3]], 1)[0].args.includes('--agent-setup-timeout-multiplier'))
})

test('the docker of bench/harbor/bin passes commands on and locks only builds', async () => {
  const { execFileSync } = await import('node:child_process')
  const { chmodSync } = await import('node:fs')
  const fake = mkdtempSync(join(tmpdir(), 'widal-code-fake-docker-'))
  writeFileSync(join(fake, 'docker'), '#!/bin/sh\necho "real $*"\n')
  chmodSync(join(fake, 'docker'), 0o755)
  const bin = join(import.meta.dirname, '..', 'bench', 'harbor', 'bin')
  const env = { ...process.env, PATH: `${bin}:${fake}:/usr/bin:/bin`, TMPDIR: fake }
  const run = (...args) => execFileSync(join(bin, 'docker'), args, { env, encoding: 'utf8' }).trim()
  assert.equal(run('ps', '-q'), 'real ps -q')
  assert.equal(run('compose', '--project-name', 'p', '--project-directory', '/x/task', 'build'), 'real compose --project-name p --project-directory /x/task build')
  assert.equal(run('compose', '--project-directory', '/x/task', 'up', '-d'), 'real compose --project-directory /x/task up -d')
})

// The loop of a stage, on a made-up Harbor.

const two = [
  { id: 'baseline', model: 'anthropic/claude-sonnet-5-5', provider: 'api' },
  { id: 'tool', model: 'anthropic/claude-sonnet-5-5', provider: 'api' },
  { id: 'baseline-2', arm: 'baseline', rep: 2, model: 'anthropic/claude-sonnet-5-5', provider: 'api' },
  { id: 'tool-2', arm: 'tool', rep: 2, model: 'anthropic/claude-sonnet-5-5', provider: 'api' },
]

/** A stage with folders of its own, two runs of two arms, one block, and no wait for Docker. */
const fresh = (name, over = {}) => stageOf({ ...base, out: join(dir, name, 'out'), jobs: join(dir, name, 'jobs'), setups: two, blockSize: 7, dockerWait: 0, ...over })

/** The line with which Claude Code ends a session that the API refused at the usage limit. */
const refused = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}}' })

// Harbor gives every job a folder of its own, also when a command runs again.
let jobs = 0

/**
 * A made-up Harbor. It notes when a command starts and ends, and writes one trial folder per task of
 * the command, as Harbor does. `fail` can make an attempt end with an error before any trial, and
 * `output` gives the agent's output of a trial.
 */
function madeUpHarbor(events, { fail = () => null, output = () => null } = {}) {
  return async (c) => {
    const setup = c.args.find((a) => a.startsWith('setup=')).slice('setup='.length)
    events.push(`start ${setup}`)
    await new Promise((resolve) => setImmediate(resolve))
    const failure = fail(setup, c)
    if (failure) {
      events.push(`failed ${setup}`)
      return { code: 1, output: failure }
    }
    const job = join(c.folder, `job-${++jobs}`)
    for (const task of c.tasks) {
      const trial = join(job, `${task.split('/').pop()}__${setup}`)
      mkdirSync(join(trial, 'agent'), { recursive: true })
      const text = output(setup, task)
      if (text) writeFileSync(join(trial, 'agent', 'claude-code.txt'), text)
      writeFileSync(join(trial, 'result.json'), JSON.stringify({
        task_name: task,
        trial_name: `${task.split('/').pop()}__${setup}`,
        config: { task: { source: 'set' }, agent: { kwargs: { setup } } },
        agent_result: { cost_usd: 0.5 },
        verifier_result: { rewards: { reward: text ? 0 : 1 } },
        exception_info: null,
      }))
    }
    events.push(`end ${setup}`)
    return { code: 0, output: `${c.tasks.length} trials\n` }
  }
}

const noWait = async () => {}

test('the setups of a block run in groups: one run number after another', () => {
  const s = fresh('groups')
  assert.deepEqual(groupsOf(s).map((g) => [g.rep, g.setups.map((x) => x.id)]), [[1, ['baseline', 'tool']], [2, ['baseline-2', 'tool-2']]])
  const turned = fresh('groups', { setups: [two[2], two[0], two[3], two[1]] })
  assert.deepEqual(groupsOf(turned).map((g) => g.rep), [1, 2], 'run 1 comes first, whatever the order in the stage file')
  const together = fresh('groups', { runNumbersTogether: true })
  assert.deepEqual(groupsOf(together).map((g) => [g.rep, g.setups.length]), [[null, 4]])
})

test('the setups of one run number run at the same time, and the run numbers one after another', async () => {
  const events = []
  const s = fresh('order')
  const end = await runStage(s, { run: madeUpHarbor(events), wait: noWait })
  assert.deepEqual(end, { blocks: 1, blocksDone: 1, stopped: null })
  const first = (text) => events.indexOf(text)
  const last = (text) => events.lastIndexOf(text)
  assert.ok(first('start tool') < first('end baseline'), 'the two setups of run 1 run at the same time')
  assert.ok(first('start baseline-2') > Math.max(last('end baseline'), last('end tool')), 'run 2 starts when every setup of run 1 has ended')
  assert.ok(first('start tool-2') < first('end baseline-2'), 'the two setups of run 2 run at the same time')
  const records = readRecords(s.out)
  assert.equal(records.length, 28, 'seven tasks in four setups')
  assert.deepEqual([...new Set(records.map((r) => `${r.arm} ${r.rep}`))].sort(), ['baseline 1', 'baseline 2', 'tool 1', 'tool 2'])
  assert.ok(existsSync(join(s.out, 'status-pilot.md')) && existsSync(join(s.out, 'ledger.json')))
})

test('with runNumbersTogether every setup of a block starts at once, as before', async () => {
  const events = []
  await runStage(fresh('at-once', { runNumbersTogether: true }), { run: madeUpHarbor(events), wait: noWait })
  assert.deepEqual(events.slice(0, 4), ['start baseline', 'start tool', 'start baseline-2', 'start tool-2'])
})

test('task sets that run together keep the order of the run numbers', async () => {
  const events = []
  const waits = []
  const s = fresh('sets-together', { taskSetsTogether: true, concurrency: 8 })
  await runStage(s, { run: madeUpHarbor(events), wait: async (ms) => waits.push(ms) })
  assert.deepEqual(events.slice(0, 4).sort(), ['start baseline', 'start baseline', 'start tool', 'start tool'], 'both task sets of both setups of run 1 start before any ends')
  assert.ok(events.indexOf('start baseline-2') > Math.max(events.lastIndexOf('end baseline'), events.lastIndexOf('end tool')))
  assert.ok(waits.includes(2500), 'the second task set of a setup starts 2.5 seconds after the first')
  assert.equal(readRecords(s.out).length, 28)
})

test('--plan prints the groups in the order they run', () => {
  const plan = planOf(fresh('plan'))
  assert.deepEqual(plan.filter((l) => !l.startsWith('    ')), ['block 1: 7 tasks', '  run 1, 2 setups at the same time:', '  then run 2, 2 setups at the same time:'])
  assert.deepEqual(plan.filter((l) => l.startsWith('    ')).map((l) => l.trim().split(':')[0]), ['baseline', 'baseline', 'tool', 'tool', 'baseline-2', 'baseline-2', 'tool-2', 'tool-2'])
  assert.match(plan[2], /^ {4}baseline: \d tasks of org\/set-[ab], 2 at a time$/)
  assert.equal(planOf(fresh('plan', { runNumbersTogether: true }))[1], '  all run numbers, 4 setups at the same time:')
  assert.equal(planOf(fresh('plan', { setups: [two[0]] }))[1], '  run 1, 1 setup:')
})

test('a trial that ended at the usage limit stops the stage after the block, with that reason', async () => {
  const events = []
  // Two blocks. In block 1 the account reaches its usage limit while "tool" runs.
  const s = fresh('usage-limit', { blockSize: 4 })
  const hit = blocksOf(s.tasks, s.blockSize, s.seed)[0][0].task
  const end = await runStage(s, { run: madeUpHarbor(events, { output: (setup, task) => (setup === 'tool' && task === hit ? `${refused}\n` : null) }), wait: noWait })
  assert.equal(end.blocksDone, 1)
  assert.equal(end.blocks, 2)
  assert.match(end.stopped, /^the model account reached its usage limit: 1 of 16 trials of the last block/)
  assert.ok(events.includes('end baseline-2') && events.includes('end tool-2'), 'the block is finished first, so that every setup has run it')
  const records = readRecords(s.out)
  assert.equal(records.length, 16, 'block 2 did not run')
  const limited = records.filter((r) => r.harnessError === 'UsageLimitReached')
  assert.deepEqual(limited.map((r) => [r.arm, r.task, r.error, r.closed]), [['tool', hit, 'UsageLimitReached', false]])
  assert.match(readFileSync(join(s.out, 'status-pilot.md'), 'utf8'), /Stopped: the model account reached its usage limit/)

  // Run again once the account works: only the trial that hit the limit runs again in block 1, and the
  // stage goes on with block 2.
  const again = []
  const next = await runStage(s, { run: madeUpHarbor(again), wait: noWait })
  assert.deepEqual(next, { blocks: 2, blocksDone: 2, stopped: null })
  assert.deepEqual(again.slice(0, 2), ['start tool', 'end tool'], 'block 1 runs the one trial that hit the limit and nothing else')
  assert.equal(readRecords(s.out).length, 28)
  assert.equal(readRecords(s.out).filter((r) => r.harnessError).length, 0)
})

test('the usage limit comes before the other stop rules', () => {
  const s = stageOf(base)
  const block = [record({ harnessError: 'UsageLimitReached', error: 'UsageLimitReached', cost: 95, closed: false }), record({ task: 'org/task-1', harnessError: 'EnvironmentStartError', cost: 0 }), record({ task: 'org/task-2' })]
  assert.match(stopRule(block, s, { blocksDone: 1, lastBlock: block }).why, /usage limit: 1 of 3 trials/)
  assert.match(stopRule(block, s, { blocksDone: 1 }).why, /the stage spent/, 'before a block, only the records of that block count for the usage limit')
})

test('the stage waits until Docker answers, and gives up with a clear error', async () => {
  let clock = 0
  const wait = async (ms) => (clock += ms)
  const calls = []
  const after = (tries) => async (program, args) => {
    calls.push([program, ...args].join(' '))
    return calls.length > tries ? { code: 0, output: 'Server Version: 29' } : { code: 1, output: 'Client:\nCannot connect to the Docker daemon at unix:///var/run/docker.sock.\n' }
  }
  await dockerReady({ run: after(2), wait, now: () => clock, seconds: 300, every: 5 })
  assert.deepEqual(calls, ['docker info', 'docker info', 'docker info'])
  assert.equal(clock, 10_000, 'two waits of five seconds')

  calls.length = 0
  clock = 0
  await assert.rejects(dockerReady({ run: after(Infinity), wait, now: () => clock, seconds: 20, every: 5 }), /Docker did not answer "docker info" within 20 seconds \(Cannot connect to the Docker daemon at unix:\/\/\/var\/run\/docker\.sock\.\)\. Start Docker/)
  assert.equal(calls.length, 5, 'tries at 0, 5, 10, 15 and 20 seconds')
  await assert.rejects(dockerReady({ run: after(Infinity), wait, now: () => clock, seconds: 0 }), DockerNotReady)

  // The stage itself: no Harbor command starts while Docker does not answer, and "dockerWait": 0 skips the check.
  const events = []
  calls.length = 0
  clock = 0
  await assert.rejects(runStage(fresh('no-docker', { dockerWait: 10 }), { run: madeUpHarbor(events), program: after(Infinity), wait, now: () => clock }), /within 10 seconds/)
  assert.deepEqual(events, [])
  calls.length = 0
  await runStage(fresh('docker-up', { dockerWait: 10 }), { run: madeUpHarbor(events), program: after(1), wait, now: () => clock })
  assert.equal(calls.length, 2)
  assert.ok(events.length > 0)
  assert.equal(stageOf(base).dockerWait, 300)
})

test('a Harbor command whose download of the tasks failed starts again, at most twice', async () => {
  const failed = 'harbor_client.errors.ApiConnectionError: Connection failed\n'
  const command = { program: '/x/harbor.sh', args: [], folder: '/x', tasks: ['org/task-0'] }
  const attempt = (results, made = () => 0) => {
    const waits = []
    let n = 0
    return { waits, run: () => runWithRetry(command, { run: async () => results[n++], trials: () => made(n), wait: async (ms) => waits.push(ms), retries: 2, pause: 30 }) }
  }
  const down = { code: 1, output: failed }
  const fine = { code: 0, output: 'done\n' }

  const third = attempt([down, down, fine])
  const r = await third.run()
  assert.equal(r.code, 0)
  assert.equal(r.attempts, 3)
  assert.deepEqual(third.waits, [30_000, 30_000])
  assert.match(r.output, /ApiConnectionError[\s\S]*attempt 1 of 3[\s\S]*attempt 2 of 3[\s\S]*done/, 'the log keeps every attempt')

  const never = await attempt([down, down, down, fine]).run()
  assert.deepEqual([never.code, never.attempts], [1, 3], 'two new starts, then the error stands')

  const other = await attempt([{ code: 1, output: 'Traceback: ValueError\n' }, fine]).run()
  assert.equal(other.attempts, 1, 'another error is not tried again')

  const ended = await attempt([{ code: 0, output: `1 trial ended on ApiConnectionError\n` }, fine]).run()
  assert.equal(ended.attempts, 1, 'a command that ended without an error is not started again')

  const spent = await attempt([down, fine], (n) => n).run()
  assert.equal(spent.attempts, 1, 'a command that made a trial is not started again, so that no session runs twice')
})

test('a failed download does not lose the block', async () => {
  const events = []
  const failedOnce = new Set()
  const s = fresh('download', { setups: [two[0]] })
  const fail = (setup, c) => {
    const key = c.args[c.args.indexOf('-d') + 1]
    if (failedOnce.has(key)) return null
    failedOnce.add(key)
    return 'ApiConnectionError: Connection failed\n'
  }
  const waits = []
  const end = await runStage(s, { run: madeUpHarbor(events, { fail }), wait: async (ms) => waits.push(ms) })
  assert.equal(end.stopped, null)
  assert.equal(readRecords(s.out).length, 7, 'every task of the block has its record')
  assert.deepEqual(events, ['start baseline', 'failed baseline', 'start baseline', 'end baseline', 'start baseline', 'failed baseline', 'start baseline', 'end baseline'])
  assert.deepEqual(waits, [30_000, 30_000])
  assert.match(readFileSync(join(s.jobs, 'pilot', 'baseline', 'block-1', 'harbor.log'), 'utf8'), /ApiConnectionError[\s\S]*The download of the tasks failed \(attempt 1 of 3\)[\s\S]*trials/)
  assert.equal(stageOf(base).downloadRetries, 2)
})

test('the disk cleanup is off unless the stage file turns it on, and its options are checked', () => {
  assert.equal(stageOf(base).diskCleanup, undefined)
  assert.deepEqual(stageOf({ ...base, diskCleanup: { above: 70 } }).diskCleanup, { path: '/', every: 120, above: 70 })
  assert.deepEqual(stageOf({ ...base, diskCleanup: { above: 80, path: '/var/lib/docker', every: 60 } }).diskCleanup, { path: '/var/lib/docker', every: 60, above: 80 })
  for (const bad of [true, 70, {}, { above: 0 }, { above: 100 }, { above: '70%' }, { above: 70, every: 0 }]) assert.throws(() => stageOf({ ...base, diskCleanup: bad }), /"diskCleanup" needs/, JSON.stringify(bad))
})

test('how full the disk is, counted as df counts it', () => {
  // 100 blocks, 30 free, of which a program may write 20: 70 in use of 90, rounded up.
  assert.equal(diskUsed('/x', () => ({ blocks: 100, bfree: 30, bavail: 20 })), 78)
  assert.equal(diskUsed('/x', () => ({ blocks: 100, bfree: 100, bavail: 95 })), 0)
  assert.equal(diskUsed('/x', () => ({ blocks: 0, bfree: 0, bavail: 0 })), 0)
  const real = diskUsed(dir)
  assert.ok(real >= 0 && real <= 100, 'the disk of this computer')
})

test('the disk cleanup removes the build cache and unused images, and never a network, a container or a volume', async () => {
  const s = stageOf({ ...base, diskCleanup: { above: 70, path: '/data' } })
  const calls = []
  const lines = []
  const docker = (code = 0, output = 'Total reclaimed space: 12GB\n') => async (program, args) => {
    calls.push([program, ...args].join(' '))
    return { code, output }
  }
  const disk = (...levels) => (path) => {
    assert.equal(path, '/data')
    return levels.length > 1 ? levels.shift() : levels[0]
  }

  assert.equal(await cleanDisk(s, { run: docker(), used: disk(70), log: (l) => lines.push(l) }), null, 'at the limit, not above it')
  assert.deepEqual(calls, [])
  assert.deepEqual(lines, [])

  assert.deepEqual(await cleanDisk(s, { run: docker(), used: disk(74, 26), log: (l) => lines.push(l) }), { before: 74, after: 26, errors: [] })
  assert.deepEqual(calls, ['docker builder prune -a -f', 'docker image prune -a -f'])
  assert.deepEqual(lines, ["disk 74%, above 70%: removing Docker's build cache and the images that no container uses", 'cleanup ended, disk 26%'])

  // What the commands may never be: a prune of everything removed networks that trials had just made.
  for (const [program, args] of DISK_CLEANUP) {
    assert.equal(program, 'docker')
    assert.ok(['builder', 'image'].includes(args[0]), args.join(' '))
    assert.equal(args[1], 'prune')
    for (const word of ['system', 'network', 'container', 'volume', '--volumes']) assert.ok(!args.includes(word), `${args.join(' ')} has no "${word}"`)
  }

  // A command that fails is named, with the last line of its output, and the other one still runs.
  calls.length = 0
  lines.length = 0
  const failed = await cleanDisk(s, { run: docker(1, 'Error response from daemon:\na prune operation is already running\n'), used: disk(90, 88), log: (l) => lines.push(l) })
  assert.equal(calls.length, 2)
  assert.deepEqual(failed.errors, ['docker builder prune -a -f ended with code 1: a prune operation is already running', 'docker image prune -a -f ended with code 1: a prune operation is already running'])
  assert.match(lines[1], /^cleanup ended, disk 88%\. docker builder prune -a -f ended with code 1/)
})

test('a stage with the disk cleanup looks at the disk at its start and on a timer, and stops the timer at its end', async () => {
  const s = fresh('disk', { setups: [two[0]], diskCleanup: { above: 70, every: 120 } })
  const calls = []
  const timers = []
  let level = 60
  let look = null
  const program = async (name, args) => {
    calls.push([name, ...args].join(' '))
    // A cleanup takes a while: a look that comes meanwhile must not start a second one.
    await new Promise((resolve) => setImmediate(resolve))
    level = 30
    return { code: 0, output: '' }
  }
  const timer = (fn, ms) => {
    look = fn
    timers.push(`start ${ms}`)
    return () => timers.push('stop')
  }
  // The disk fills while Harbor runs, and the timer fires twice at once.
  const events = []
  const harbor = madeUpHarbor(events)
  const run = async (c) => {
    level = 75
    await Promise.all([look(), look()])
    return harbor(c)
  }
  const end = await runStage(s, { run, program, timer, used: () => level, now: () => Date.UTC(2026, 10, 26, 3, 0, 0) })
  assert.equal(end.stopped, null)
  assert.deepEqual(timers, ['start 120000', 'stop'])
  // The block has two task sets, so Harbor starts twice: two cleanups, each one for two looks at once.
  assert.deepEqual(calls, ['docker builder prune -a -f', 'docker image prune -a -f', 'docker builder prune -a -f', 'docker image prune -a -f'])
  const log = readFileSync(join(s.out, 'disk-cleanup-pilot.log'), 'utf8').split('\n').filter(Boolean)
  assert.equal(log[0], "2026-11-26T03:00:00.000Z disk 75%, above 70%: removing Docker's build cache and the images that no container uses")
  assert.equal(log[1], '2026-11-26T03:00:00.000Z cleanup ended, disk 30%')
  assert.equal(readRecords(s.out).length, 7)

  // A cleanup that cannot start is written to the log, and the stage goes on. The timer stops also when the stage fails.
  const t = fresh('disk-fails', { setups: [two[0]], diskCleanup: { above: 70 } })
  timers.length = 0
  await runStage(t, { run: madeUpHarbor([]), program: async () => { throw new Error('spawn docker ENOENT') }, timer, used: () => 95 })
  assert.match(readFileSync(join(t.out, 'disk-cleanup-pilot.log'), 'utf8'), /the cleanup failed: spawn docker ENOENT/)
  assert.deepEqual(timers, ['start 120000', 'stop'])
  timers.length = 0
  await assert.rejects(runStage(fresh('disk-throws', { setups: [two[0]], diskCleanup: { above: 70 } }), { run: async () => { throw new Error('harbor broke') }, program, timer, used: () => 10 }), /harbor broke/)
  assert.deepEqual(timers, ['start 120000', 'stop'])

  // Without the option the stage starts no timer and no Docker command.
  calls.length = 0
  timers.length = 0
  await runStage(fresh('no-disk', { setups: [two[0]] }), { run: madeUpHarbor([]), program, timer, used: () => 99 })
  assert.deepEqual([calls, timers], [[], []])
})
