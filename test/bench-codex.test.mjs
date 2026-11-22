// Tests for the arms that run Codex in place of Claude Code (bench/codex.mjs). They use folders of
// their own only: no test reads or changes the person's Codex folder.
import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// prices.mjs reads a file of the person's own prices from Widal.Code's home: the tests get an empty one.
process.env.WIDAL_HOME = realpathSync(mkdtempSync(join(tmpdir(), 'widal-bench-codex-home-')))

const { addArms, settingsOf } = await import('../bench/arms.mjs')
const { RULES, codexHome, configOf, costOfLog, linkIntact, logOf, numbersOf, readEvents, renewedSignIn, tokensAgree } = await import('../bench/codex.mjs')
const { agentOf } = await import('../bench/lib.mjs')

const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), `widal-bench-codex-${name}-`)))
const arm = { id: 'codex-test', number: 77, name: 'Codex test', agent: 'codex', settings: { model: 'gpt-5.6-sol', effortLevel: 'high' } }

/** A folder that stands for the person's Codex folder, with a sign-in file. */
function personFolder() {
  const dir = temp('person')
  writeFileSync(join(dir, 'auth.json'), '{"stands for":"a sign-in"}\n')
  return dir
}

test('an arms file can name an arm that runs Codex, and only with what Codex can take', () => {
  const dir = temp('arms')
  const write = (list) => {
    const file = join(dir, `arms-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(file, JSON.stringify(list))
    return file
  }
  const [added] = addArms(write([arm]), dir)
  assert.equal(added.agent, 'codex')
  // Codex gets its settings as they are: none of Claude Code's own are added.
  assert.deepEqual(settingsOf(added), { model: 'gpt-5.6-sol', effortLevel: 'high' })
  assert.throws(() => addArms(write([{ ...arm, id: 'codex-b', number: 78, agent: 'gemini' }]), dir), /neither "claude" nor "codex"/)
  assert.throws(() => addArms(write([{ ...arm, id: 'codex-c', number: 79, tools: ['Bash(ls:*)'] }]), dir), /runs Codex, which cannot take "tools"/)
  assert.throws(() => addArms(write([{ ...arm, id: 'codex-d', number: 80, systemPrompt: 'x' }]), dir), /cannot take "systemPrompt"/)
})

test("the arm's Codex folder has its settings and rules, and links the person's sign-in without copying it", () => {
  const out = temp('out')
  const person = personFolder()
  const home = codexHome(out, arm, person)
  assert.equal(home, join(out, 'codex', 'codex-test'))
  const config = readFileSync(join(home, 'config.toml'), 'utf8')
  assert.match(config, /^model = "gpt-5\.6-sol"$/m)
  assert.match(config, /^model_reasoning_effort = "high"$/m)
  assert.match(config, /^approval_policy = "never"$/m)
  assert.match(config, /^sandbox_mode = "workspace-write"$/m)
  assert.match(config, /^web_search = "disabled"$/m)
  assert.match(config, /^network_access = false$/m)
  assert.equal(readFileSync(join(home, 'rules', 'bench.rules'), 'utf8'), RULES)
  assert.ok(lstatSync(join(home, 'auth.json')).isSymbolicLink())
  assert.equal(linkIntact(home, person), true)
  // A second session finds the link in place and keeps it.
  assert.equal(codexHome(out, arm, person), home)
  assert.equal(linkIntact(home, person), true)
})

test('a settings value with a quote cannot break out of its line in config.toml', () => {
  const config = configOf({ ...arm, settings: { model: 'a"\nsandbox_mode = "danger-full-access' } })
  assert.equal(config.match(/^sandbox_mode = /gm).length, 1)
  assert.match(config, /^sandbox_mode = "workspace-write"$/m)
})

test('without a sign-in file Codex cannot run, and the message says why', () => {
  assert.throws(() => codexHome(temp('out'), arm, temp('empty')), /needs its sign-in in .*auth\.json.*codex login/)
})

test('a renewed sign-in in the benchmark folder is found, and the message names both files', () => {
  const out = temp('out')
  const person = personFolder()
  const home = codexHome(out, arm, person)
  // Codex saves a renewed sign-in as a new file in place of the old one.
  const fresh = join(home, 'auth.json.new')
  writeFileSync(fresh, '{"stands for":"a renewed sign-in"}\n')
  renameSync(fresh, join(home, 'auth.json'))
  assert.equal(linkIntact(home, person), false)
  const text = renewedSignIn(home, person)
  assert.ok(text.includes(join(home, 'auth.json')) && text.includes(join(person, 'auth.json')) && text.includes('codex login'))
  // The person's own file was not touched.
  assert.equal(readFileSync(join(person, 'auth.json'), 'utf8'), '{"stands for":"a sign-in"}\n')
})

const EVENTS = [
  { type: 'thread.started', thread_id: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Looking at the code.' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "zsh -lc 'npm test'", aggregated_output: 'ok', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: "zsh -lc 'tsc'", aggregated_output: 'forbidden', exit_code: 1, status: 'failed' } },
  { type: 'item.completed', item: { id: 'item_3', type: 'file_change', status: 'completed' } },
  { type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 800, cache_write_input_tokens: 100, output_tokens: 300, reasoning_output_tokens: 120 } },
]
  .map((e) => JSON.stringify(e))
  .join('\n')

test('the events of "codex exec --json" give the numbers and nothing of the text', () => {
  const e = readEvents(`${EVENTS}\nnot json\n`)
  assert.deepEqual(e, {
    thread: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001',
    usage: { input: 1200, cached: 800, written: 100, output: 300, reasoning: 120 },
    turns: 1,
    commands: 2,
    failedCommands: 1,
    fileChanges: 1,
    errors: 0,
    ended: true,
  })
  assert.equal(JSON.stringify(e).includes('npm test'), false)
  // A session that was stopped before its end has no turn.completed.
  assert.equal(readEvents(EVENTS.split('\n').slice(0, 4).join('\n')).ended, false)
})

/** A session log in the arm's Codex folder, as Codex writes it: two model calls. */
function sessionLog(home, thread) {
  const dir = join(home, 'sessions', '2026', '11', '22')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `rollout-2026-11-22T00-15-00-${thread}.jsonl`)
  const lines = [
    { timestamp: '2026-11-22T08:15:00.000Z', type: 'session_meta', payload: { id: thread, cwd: '/work' } },
    { timestamp: '2026-11-22T08:15:00.100Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'high', cwd: '/work' } },
    { timestamp: '2026-11-22T08:15:01.000Z', type: 'token_usage_record', payload: { response_id: 'r1', usage: { input_tokens: 500, cached_input_tokens: 300, cache_write_input_tokens: 100, output_tokens: 100, reasoning_output_tokens: 40 } } },
    { timestamp: '2026-11-22T08:15:02.000Z', type: 'token_usage_record', payload: { response_id: 'r2', usage: { input_tokens: 700, cached_input_tokens: 500, cache_write_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 80 } } },
  ]
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  return file
}

test("a session's cost is Widal.Code's, call by call, and its token count is checked against Codex's own", () => {
  const home = temp('codex-home')
  const thread = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001'
  const file = sessionLog(home, thread)
  assert.equal(logOf(home, thread), file)
  assert.equal(logOf(home, 'another-thread'), undefined)
  const c = costOfLog(file)
  // gpt-5.6-sol: $4 input, $0.40 cached input, $5 written input (1.25 times), $20 output, per million tokens.
  const expected = ((100 + 200) * 4 + (300 + 500) * 0.4 + 100 * 5 + (100 + 200) * 20) / 1e6
  assert.ok(Math.abs(c.cost - expected) < 1e-12, `${c.cost} against ${expected}`)
  assert.equal(c.calls, 2)
  assert.equal(c.input, 1200)
  assert.equal(c.output, 300)

  const n = numbersOf(readEvents(EVENTS), file, 61_000, false)
  assert.equal(n.agent, 'codex')
  assert.ok(Math.abs(n.cost - expected) < 1e-12)
  assert.equal(n.turns, 2)
  assert.equal(n.durationMs, 61_000)
  assert.equal(n.isError, false)
  assert.equal(n.subtype, 'success')
  assert.equal(n.failedCommands, 1)
  assert.deepEqual(Object.keys(n.modelUsage), ['gpt-5.6-sol'])
  assert.equal(tokensAgree(n), true)
  // The report reads it where it reads Claude Code's result.
  assert.equal(agentOf({ codex: n }).cost, n.cost)

  // A count that differs is found.
  const other = numbersOf(readEvents(EVENTS.replace('"output_tokens":300', '"output_tokens":301')), file, 61_000, false)
  assert.equal(tokensAgree(other), false)
})

test('a session that hit the time limit or never wrote a log is an error, with no cost', () => {
  const n = numbersOf(readEvents(EVENTS.split('\n').slice(0, 4).join('\n')), undefined, 1_800_000, true)
  assert.equal(n.isError, true)
  assert.equal(n.subtype, 'time limit')
  assert.equal(n.cost, undefined)
  assert.equal(tokensAgree(n), false)
})
