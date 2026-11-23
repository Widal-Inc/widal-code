// A stage of the benchmark on public task sets (bench/harbor-stage.mjs): blocks, the ledger, the stop
// rules, the status file and the Harbor commands. Nothing here starts Harbor.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { blocksOf, commandsOf, ledgerOf, perSet, shuffled, stageOf, statusOf, stopRule, togetherOf } from '../bench/harbor-stage.mjs'

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
  assert.equal(one.args[i + 1], '2', 'the setup of an agent gets twice Harbor\'s time by default')
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
