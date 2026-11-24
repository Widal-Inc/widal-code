// Tests for the spend by model, effort level and kind of work, for the proposals and changes on
// model and effort, and for the measures before and after a change, with small made-up session
// logs. Run: node --test
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-advice-test-'))
// Widal.Code also reads the config folders of Claude Code in the home folder, so the home folder is a
// made-up one too.
process.env.HOME = join(dir, 'person')
process.env.WIDAL_HOME = join(dir, 'home')
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
// Cowork's folder too: without this a test would read the real Cowork logs of whoever runs it.
process.env.WIDAL_COWORK_DIR = join(dir, 'cowork')
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
// Two made-up models with prices of the person's own, for the tests on which price decides what
// a strong model is. Claude Sonnet 5.5 costs $2 per million tokens of input and $10 of output.
// The first model costs more than that for input and less for output. The second is the other way round.
mkdirSync(process.env.WIDAL_HOME, { recursive: true })
writeFileSync(join(process.env.WIDAL_HOME, 'prices.json'), JSON.stringify({
  'made-up-dear-input': { in: 9, out: 6, read: 0.9 },
  'made-up-dear-output': { in: 1, out: 30, read: 0.05 },
}))

const { cost } = await import('../src/prices.mjs')
const { ClaudeParser } = await import('../src/parse-claude.mjs')
const { CodexParser } = await import('../src/parse-codex.mjs')
const { KIND_NAMES, effortOf, highEffort, kindOf, simpleOnStrong } = await import('../src/analyze.mjs')
const { count, day, money, table, when } = await import('../src/format.mjs')
const { models, modelsData, summary } = await import('../src/report.mjs')
const { load } = await import('../src/store.mjs')

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`)
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0)
const START = Date.parse('2026-11-12T10:00:00Z')
let made = 0

/**
 * One line of a Claude Code log: a model call that asked for the named tools. Each call is 10
 * seconds after the one before, unless `ts` gives its time. Each tool call has an input of its
 * own, unless `input` gives one. `web` is the number of web searches that the model made itself.
 */
function call({ tools = [], effort, model = 'claude-opus-5-5', out = 1000, cwd = '/work/repo', ts, input, web } = {}) {
  const n = made++
  return JSON.stringify({
    type: 'assistant', timestamp: new Date(ts ?? START + n * 10e3).toISOString(), cwd, effort,
    message: {
      id: `m${n}`, model, role: 'assistant',
      content: tools.map((name, i) => ({ type: 'tool_use', id: `t${n}-${i}`, name, input: input ?? { n, i } })),
      usage: {
        input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 50000, output_tokens: out,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, server_tool_use: web ? { web_search_requests: web } : undefined,
      },
    },
  })
}

/** The calls that Claude Code's parser reads from the lines of one log. */
function claude(lines, file = '/logs/s1.jsonl') {
  const p = new ClaudeParser(file)
  for (const l of lines) p.feed(l)
  return p.result().records
}

/**
 * The calls that Codex's parser reads from a made-up log. Each turn is: an effort level, the
 * tools, then the usage. A turn writes 500 tokens of output, unless `out` gives another number.
 * `ts` gives the time of a turn. Without it each turn is 10 seconds after the one before.
 */
function codex(turns, model = 'gpt-6-astra') {
  const p = new CodexParser('/codex/rollout-1.jsonl')
  const lines = [{ type: 'session_meta', payload: { session_id: 'c1', cwd: '/work/app' } }]
  turns.forEach(({ tools = [], effort, out = 500, ts }, i) => {
    lines.push({ type: 'turn_context', payload: { model, effort } })
    for (const [type, name] of tools) lines.push({ type: 'response_item', payload: { type, name, arguments: `{"i":${i}}`, call_id: `k${i}-${name}` } })
    lines.push({ type: 'token_usage_record', timestamp: new Date(ts ?? START + i * 10e3).toISOString(), payload: { response_id: `r${made++}`, usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: out, reasoning_output_tokens: 100 } } })
  })
  for (const l of lines) p.feed(JSON.stringify(l))
  return p.result().records
}

test('the kind of work of a call comes from the names of the tools it used, for each row of the table', () => {
  const rows = {
    'changing files': ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'],
    'running commands': ['Bash', 'BashOutput', 'KillShell', 'shell', 'exec_command', 'local_shell'],
    'handing work to a subagent': ['Agent', 'Task', 'Workflow', 'SendMessage', 'spawn_agent', 'send_message', 'followup_task'],
    'reading and searching': ['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'NotebookRead', 'read_file', 'list_dir', 'grep_files', 'view_image'],
    // A connector tool, a tool with no row, and Codex's "exec", whose name does not say what its script does.
    'other tools': ['mcp__linear__get_issue', 'TodoWrite', 'exec'],
  }
  for (const [kind, tools] of Object.entries(rows)) for (const tool of tools) assert.equal(kindOf({ tools: [[tool, 'sig']] }), kind, tool)
  assert.equal(kindOf({ tools: [] }), 'thinking and answering')
  assert.deepEqual(KIND_NAMES, [...Object.keys(rows), 'thinking and answering'])

  // The same through the parsers, from made-up logs of Claude Code and of Codex.
  const fromClaude = claude([call({ tools: ['Edit'] }), call({ tools: ['Bash'] }), call({ tools: ['Agent'] }), call({ tools: ['Grep'] }), call({ tools: ['mcp__linear__get_issue'] }), call()])
  assert.deepEqual(fromClaude.map(kindOf), KIND_NAMES)
  const fromCodex = codex([{ tools: [['custom_tool_call', 'apply_patch']] }, { tools: [['function_call', 'shell']] }, { tools: [['custom_tool_call', 'exec']] }, {}])
  assert.deepEqual(fromCodex.map(kindOf), ['changing files', 'running commands', 'other tools', 'thinking and answering'])
})

test('a call with two tools takes the kind that comes first in the table', () => {
  const kind = (...tools) => kindOf(claude([call({ tools })])[0])
  assert.equal(kind('Read', 'Edit'), 'changing files')
  assert.equal(kind('Edit', 'Read'), 'changing files') // The table's order decides, not the order of the tools.
  assert.equal(kind('Read', 'Bash'), 'running commands')
  assert.equal(kind('Agent', 'Bash'), 'running commands')
  assert.equal(kind('Read', 'Agent'), 'handing work to a subagent')
  assert.equal(kind('mcp__linear__get_issue', 'Grep'), 'reading and searching')
  assert.equal(kind('mcp__linear__get_issue', 'TodoWrite'), 'other tools')
})

test('calls are grouped by model and effort level, and a call without an effort is "(not logged)"', () => {
  const records = [
    ...claude([
      call({ effort: 'high', out: 4000 }), call({ effort: 'high', out: 4000 }), call({ effort: 'medium', out: 3000 }), call({ out: 2000 }),
      call({ model: 'claude-sonnet-5-5', effort: 'high', out: 1000 }),
    ]),
    ...codex([{ effort: 'xhigh' }, {}], 'some-new-model'),
  ]
  assert.deepEqual(records.map(effortOf), ['high', 'high', 'medium', '(not logged)', 'high', 'xhigh', '(not logged)'])
  const d = modelsData(records)
  assert.deepEqual(d.byModelEffort.map((x) => [x.model, x.effort, x.calls]), [
    ['claude-opus-5-5', 'high', 2],
    ['claude-opus-5-5', 'medium', 1],
    ['claude-opus-5-5', '(not logged)', 1],
    ['claude-sonnet-5-5', 'high', 1],
    ['some-new-model', 'xhigh', 1],
    ['some-new-model', '(not logged)', 1],
  ])
  near(d.byModelEffort[0].cost, sum(records.slice(0, 2), (r) => cost(r).total))
  near(d.byModelEffort[2].cost, cost(records[3]).total)
  // A model without a price has no cost. The report says so in its row.
  const text = models(records, { days: 30 })
  assert.match(text, /opus-5-5 {2,}\(not logged\) {2,}1 {2,}\$0\.\d\d {2,}\d+%/)
  assert.match(text, /some-new-model {2,}xhigh {2,}1 {2,}no price$/m)
  assert.match(text, /No price is known for some-new-model: 2 calls/)
})

test('simple work on a strong model at high effort: reading or commands, effort high or above, a model above Sonnet 5.5', () => {
  const counted = claude([
    call({ tools: ['Read'], effort: 'high' }),
    call({ tools: ['Bash'], effort: 'xhigh' }),
    call({ tools: ['Grep', 'Bash'], effort: 'max', model: 'claude-fable-5-2' }),
    call({ tools: ['WebSearch'], effort: 'high', model: 'claude-sonnet-4-6' }), // Its output costs $15, above Sonnet 5.5's $10.
  ])
  const notCounted = claude([
    call({ tools: ['Read'], effort: 'medium' }), // The effort is below high.
    call({ tools: ['Read'], effort: 'low' }),
    call({ tools: ['Read'] }), // The effort is not logged.
    call({ tools: ['Edit'], effort: 'high' }), // Changing files is not simple work.
    call({ tools: ['Read', 'Write'], effort: 'high' }),
    call({ tools: ['Agent'], effort: 'high' }),
    call({ tools: ['mcp__linear__get_issue'], effort: 'high' }),
    call({ effort: 'high' }), // No tool: thinking and answering.
    call({ tools: ['Read'], effort: 'high', model: 'claude-sonnet-5-5' }), // The model is not above Sonnet 5.5.
    call({ tools: ['Bash'], effort: 'xhigh', model: 'claude-haiku-4-5' }),
    call({ tools: ['Read'], effort: 'high', model: 'some-new-model' }), // No price is known.
  ])
  for (const r of counted) assert.equal(simpleOnStrong(r), true, `${r.m} ${r.ef} ${r.tools.map((t) => t[0])}`)
  for (const r of notCounted) assert.equal(simpleOnStrong(r), false, `${r.m} ${r.ef} ${r.tools.map((t) => t[0])}`)
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra', undefined].map((ef) => highEffort({ ef })), [false, false, true, true, true, true, false])

  const d = modelsData([...counted, ...notCounted])
  assert.equal(d.simple.calls, 4)
  near(d.simple.cost, sum(counted, (r) => cost(r).total))
  const text = models([...counted, ...notCounted], { days: 30 }).split('\n')
  assert.equal(text.at(-2), 'Simple work on a strong model at high effort')
  assert.match(text.at(-1), /^4 calls read, searched or ran commands at effort high or above, on a model whose output costs more than Claude Sonnet 5\.5's: they cost \$0\.\d\d, \d+% of all cost\.$/)
  // Nothing of that kind: the sentence still gives a cost and a share.
  assert.match(models(notCounted, { days: 30 }), /\n0 calls read, searched or ran commands .* they cost \$0\.00, 0% of all cost\.$/)
})

test('the total of the report is the sum of the calls, every table adds up to it, and the summary shows the same total', () => {
  const records = [
    ...claude([call({ tools: ['Read'], effort: 'high' }), call({ tools: ['Edit'], effort: 'medium' }), call({ tools: ['Agent'] }), call()]),
    ...claude([call({ tools: ['Grep'], effort: 'xhigh' }), call({ tools: ['Bash'], model: 'claude-sonnet-5-5' }), call({ model: 'claude-haiku-4-5' })], '/logs/s1/subagents/agent-1.jsonl'),
    ...codex([{ tools: [['function_call', 'shell']], effort: 'high' }, { effort: 'low' }]),
  ]
  const all = sum(records, (r) => cost(r).total)
  const d = modelsData(records)
  near(d.total, all)
  assert.equal(d.calls, records.length)
  near(sum(d.byModelEffort, (x) => x.cost), all)
  near(sum(d.byKind, (x) => x.cost), all)
  near(sum(d.byKind, (x) => x.main + x.sub), all)
  assert.equal(sum(d.byKind, (x) => x.calls), records.length)
  near(sum(d.bySubagent, (x) => x.cost), sum(records.filter((r) => r.agent), (r) => cost(r).total))
  near(sum(d.byKind, (x) => x.sub), sum(d.bySubagent, (x) => x.cost))

  // Both reports print the total in the same way.
  const total = (text) => text.split('\n').find((l) => l.startsWith('Total')).split(/\s+/).join(' ')
  assert.equal(total(models(records, { days: 30 })), total(summary(records, { days: 30 })))
  assert.match(total(models(records, { days: 30 })), /^Total \$\d+\.\d\d 9 model calls$/)
})

test('the kind of a subagent comes from the meta file next to its log, and the report shows spend by that kind', async () => {
  const project = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'work-repo')
  const sub = join(project, 's1', 'subagents')
  const workflow = join(sub, 'workflows', 'wf-1')
  mkdirSync(workflow, { recursive: true })
  const log = (file, lines) => writeFileSync(file, `${lines.join('\n')}\n`)
  log(join(project, 's1.jsonl'), [call({ tools: ['Agent'], effort: 'high' }), call({ effort: 'high' })])
  // Three calls of reading and one that changes a file. The meta file holds more keys: only the kind is read.
  log(join(sub, 'agent-a1.jsonl'), [call({ tools: ['Read'] }), call({ tools: ['Grep'] }), call({ tools: ['Glob'] }), call({ tools: ['Edit'] })])
  writeFileSync(join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'a made-up task' }))
  // A subagent that a workflow started, on two models.
  log(join(workflow, 'agent-a2.jsonl'), [call({ tools: ['Bash'] }), call({ tools: ['Bash'], model: 'claude-sonnet-5-5' })])
  writeFileSync(join(workflow, 'agent-a2.meta.json'), JSON.stringify({ agentType: 'general-purpose' }))
  // No meta file, and a meta file that names no kind.
  log(join(sub, 'agent-a3.jsonl'), [call({ tools: ['Read'] })])
  log(join(sub, 'agent-a4.jsonl'), [call()])
  writeFileSync(join(sub, 'agent-a4.meta.json'), JSON.stringify({ description: 'a made-up task' }))

  const { records } = await load({ since: 0 })
  assert.deepEqual(records.map((r) => [r.agent, r.at]), [
    [undefined, undefined], [undefined, undefined],
    ['agent-a1', 'Explore'], ['agent-a1', 'Explore'], ['agent-a1', 'Explore'], ['agent-a1', 'Explore'],
    ['agent-a2', 'general-purpose'], ['agent-a2', 'general-purpose'],
    ['agent-a3', undefined], ['agent-a4', undefined],
  ])

  const d = modelsData(records)
  // The kind with the largest cost comes first.
  assert.deepEqual(d.bySubagent.map((x) => [x.kind, x.calls, x.models]), [
    ['Explore', 4, ['claude-opus-5-5']],
    ['(kind not logged)', 2, ['claude-opus-5-5']],
    ['general-purpose', 2, ['claude-opus-5-5', 'claude-sonnet-5-5']],
  ])
  const explore = d.bySubagent[0]
  near(explore.reading, sum(records.slice(2, 5), (r) => cost(r).total))
  near(explore.reading / explore.cost, 0.75)
  assert.equal(d.bySubagent[2].reading, 0)

  const text = models(records, { days: 30 })
  assert.match(text, /^ {2}Explore {2,}4 {2,}\$0\.\d\d {2,}opus-5-5 {2,}75%$/m)
  assert.match(text, /^ {2}general-purpose {2,}2 {2,}\$0\.\d\d {2,}opus-5-5, sonnet-5-5 {2,}0%$/m)
  for (const title of ['By model and effort', 'By kind of work', 'By kind of subagent', 'Simple work on a strong model at high effort']) assert.ok(text.split('\n').includes(title), title)
  assert.doesNotMatch(text, /[\u2013\u2014]/) // No dashes in what a person reads.

  // The second read comes from the cache and gives the same calls, with the kind. The cache is JSON,
  // so a field without a value is not in it: both sides are compared as JSON.
  const asJson = (x) => JSON.parse(JSON.stringify(x))
  assert.deepEqual((await load({ since: 0 })).records, asJson(records))
  // A cache file that an older version of the parsers wrote has no kind: it is parsed again.
  const cache = join(process.env.WIDAL_HOME, 'cache')
  for (const f of readdirSync(cache)) {
    const entry = JSON.parse(readFileSync(join(cache, f), 'utf8'))
    writeFileSync(join(cache, f), JSON.stringify({ ...entry, v: 6, records: [] }))
  }
  assert.deepEqual(asJson((await load({ since: 0 })).records), asJson(records))
})

test('a period without subagent calls has no table of subagents, and one without calls says so', () => {
  const text = models(claude([call({ tools: ['Read'], effort: 'high' })]), { days: 30 })
  assert.doesNotMatch(text, /By kind of subagent/)
  assert.match(text, /^ {2}reading and searching {2,}\$0\.\d\d {2,}100% {2,}\$0\.\d\d {2,}100% {2,}\$0\.00 {2,}0%$/m)
  assert.equal(models([], { days: 30 }), 'No model calls in the last 30 days.')
})

/**
 * Runs the command with folders of its own below `name`, so that it sees no log and no setting of
 * another test. Returns the folders and a function that runs the command with the given arguments.
 */
function command(name) {
  const own = join(dir, name)
  const env = { ...process.env, WIDAL_HOME: join(own, 'home'), CLAUDE_CONFIG_DIR: join(own, 'claude'), CODEX_HOME: join(own, 'codex') }
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true })
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../cli/widal.mjs', import.meta.url)), ...args], { encoding: 'utf8', env })
  return { env, run }
}

/**
 * A made-up log with one call 10 days ago, one 29 days ago and one 31 days ago. The command takes
 * the time from the clock, so the calls are placed by the clock too. Each is a day or more away
 * from the limits of 14, 30 and 60 days, so the counts are the same whenever the test runs.
 */
function logOfThreeAges(env) {
  const project = join(env.CLAUDE_CONFIG_DIR, 'projects', 'work-repo')
  mkdirSync(project, { recursive: true })
  const now = Date.now()
  writeFileSync(join(project, 'ages.jsonl'), `${[31, 29, 10].map((days) => call({ ts: now - days * 86400e3 })).join('\n')}\n`)
}

test('the models command looks at 30 days unless --days says otherwise', () => {
  const { env, run } = command('models-command')
  // With no logs, the sentence names the days.
  assert.equal(run('models').stdout.trim(), 'No model calls in the last 30 days.')
  assert.equal(run('models', '--days', '14').stdout.trim(), 'No model calls in the last 14 days.')
  // With logs: the days in the first line, and the calls that were really loaded.
  logOfThreeAges(env)
  const seen = (...args) => {
    const text = run('models', ...args).stdout
    return [text.split('\n')[0], /^Total +\S+ +(\d+) model calls$/m.exec(text)?.[1]]
  }
  assert.deepEqual(seen(), ['Spend by model, effort level and kind of work, last 30 days. List prices, so an estimate.', '2'])
  assert.deepEqual(seen('--days', '14'), ['Spend by model, effort level and kind of work, last 14 days. List prices, so an estimate.', '1'])
  assert.deepEqual(seen('--days', '60'), ['Spend by model, effort level and kind of work, last 60 days. List prices, so an estimate.', '3'])
})

test('the advise command looks at 30 days unless --days says otherwise', () => {
  const { env, run } = command('advise-command')
  assert.equal(run('advise').stdout.trim(), 'No priced model calls in the last 30 days.')
  assert.equal(run('advise', '--days', '14').stdout.trim(), 'No priced model calls in the last 14 days.')
  logOfThreeAges(env)
  // The first line names the days and the calls that were really loaded.
  const seen = (...args) => /^Proposals from a replay of the last (\d+) days: \S+ at list prices, (\d+) model calls\.$/.exec(run('advise', ...args).stdout.split('\n')[0])?.slice(1)
  assert.deepEqual(seen(), ['30', '2'])
  assert.deepEqual(seen('--days', '14'), ['14', '1'])
  assert.deepEqual(seen('--days', '60'), ['60', '3'])
})

test('the list of commands names the models report with its 30 days', () => {
  const { run } = command('help-command')
  assert.match(run('help').stdout, /^ {2}widal models \[--days 30\] {2,}spend by model, effort level and kind of work$/m)
  assert.match(run('help').stdout, /^ {2}widal advise \[--days 30\] {2,}changes that would have saved money, from a replay of your logs$/m)
})

const { adviseReport, proposals } = await import('../src/advise.mjs')
const { actionsStatus, applied: appliedActions, apply: applyAction, undo: undoAction } = await import('../src/actions.mjs')

const many = (n, options) => Array.from({ length: n }, () => call(options))
const costOf = (records) => sum(records, (r) => cost(r).total)
const only = (p, id) => p.list.filter((x) => x.id === id)
let logs = 0

/** The calls of one made-up main session. */
const mainSession = (lines, name = `main-${logs++}`) => claude(lines, `/logs/${name}.jsonl`)

/** The calls of one made-up subagent. Its kind is in a meta file next to its log, as Claude Code writes it. */
function subagent(kind, lines, session = `main-${logs++}`) {
  const folder = join(dir, 'made-up', session, 'subagents')
  mkdirSync(folder, { recursive: true })
  const name = `agent-${logs++}`
  if (kind) writeFileSync(join(folder, `${name}.meta.json`), JSON.stringify({ agentType: kind }))
  return claude(lines, join(folder, `${name}.jsonl`))
}

// A lot of other spend, so that a small saving is under 1% of the total: 100 calls of about $1 each.
const largeSpend = () => mainSession(many(100, { tools: ['Edit'], out: 50000, cwd: '/work/large' }))

test('a kind of subagent whose cost is mostly reading and searching gets a proposal for a cheaper model', () => {
  // Three of five calls of the same cost read: 60%, which is enough.
  const researcher = subagent('researcher', [...many(3, { tools: ['Read'] }), ...many(2, { tools: ['Bash'] })])
  const builder = subagent('builder', [call({ tools: ['Read'] }), ...many(4, { tools: ['Edit'] })]) // 20% reading.
  const onSonnet = subagent('reader', many(5, { tools: ['Grep'], model: 'claude-sonnet-5-5' })) // Not above Sonnet 5.5.
  const noKind = subagent(undefined, many(5, { tools: ['Glob'] })) // No meta file, so no kind.
  const records = [...researcher, ...builder, ...onSonnet, ...noKind]
  const ownFile = (kind) => (kind === 'researcher' ? '/claude/agents/researcher.md' : undefined)

  const found = only(proposals(records, { ownFile }), 'subagent-model-by-kind')
  assert.deepEqual(found.map((x) => x.kind).sort(), ['researcher', undefined])
  // All five calls of the kind are priced again. Sonnet 5.5 costs half of Opus 5.5 for every kind of token.
  const one = found.find((x) => x.kind === 'researcher')
  near(one.saving, costOf(researcher) / 2)
  near(found.find((x) => x.kind === undefined).saving, costOf(noKind) / 2)

  const text = adviseReport(records, { days: 30, ownFile })
  assert.match(text, /^\d\. Run the "researcher" subagents on a cheaper model: \$0\.08 less, 14% of the total$/m)
  assert.match(text, /Why: {2}60% of what the "researcher" subagents cost is reading and searching: \$0\.09 of \$0\.15\. 5 of their calls ran on a model that costs more than Claude Sonnet 5\.5\. They cost \$0\.15\. The same tokens at Sonnet 5\.5 prices cost \$0\.08\.$/m)
  assert.match(text, /How: {2}One line in the file of that subagent \(\/claude\/agents\/researcher\.md\): "model: claude-sonnet-5-5"\./)
  assert.match(text, /^ {3}Apply: widal apply subagent-model --kind researcher$/m)
  // Subagents without a kind are one group. It can only be changed with the setting for all subagents.
  assert.match(text, /^\d\. Run the subagents whose kind is not logged on a cheaper model: \$0\.08 less, 14% of the total$/m)
  assert.match(text, /^ {3}Apply: widal apply subagent-model\. This changes all subagents\.$/m)
  // A kind without a file of its own cannot be changed alone, and the proposal says so.
  const builtIn = adviseReport(records, { days: 30, ownFile: () => undefined })
  assert.match(builtIn, /How: {2}"researcher" has no file of its own, so it cannot be changed alone\. The setting for all subagents does it: "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-5-5"/)
  assert.doesNotMatch(builtIn, /--kind/)
  // The proposal for all subagents can now be applied by this tool.
  assert.match(text, /^\d\. Run subagents on a cheaper model: .*\n.*\n.*\n.*\n {3}Apply: widal apply subagent-model$/m)
  assert.doesNotMatch(text, /[\u2013\u2014]/)

  // Under 1% of the total it is not shown.
  assert.deepEqual(only(proposals([...records, ...largeSpend()], { ownFile }), 'subagent-model-by-kind'), [])
})

test('simple work at high effort gets a proposal for a lower effort, with an amount from the calls at the next lower effort', () => {
  const lower = many(200, { tools: ['Read'], effort: 'medium', out: 300 })
  const high = many(50, { tools: ['Read'], effort: 'high', out: 1000 })
  const short = many(10, { tools: ['Read'], effort: 'high', out: 100 }) // They wrote less than the median at medium.
  // The next level below xhigh is high. It has 60 calls, so the one below it with 200 calls is taken: medium.
  const xhigh = many(20, { tools: ['Grep'], effort: 'xhigh', out: 2000 })
  const commands = many(30, { tools: ['Bash'], effort: 'max', out: 5000 }) // Another kind of work: no calls at a lower effort.
  const edits = many(40, { tools: ['Edit'], effort: 'high', out: 9000 }) // Changing files is not simple work.
  const records = mainSession([...lower, ...high, ...short, ...xhigh, ...commands, ...edits])

  const [found, ...more] = only(proposals(records), 'effort-lower')
  assert.equal(more.length, 0)
  // Output above 300 tokens at $20 per million: 50 calls with 700 tokens more, and 20 calls with 1,700 more.
  near(found.saving, (50 * 700 * 20 + 20 * 1700 * 20) / 1e6)
  assert.equal(found.args, '--level medium')
  const text = adviseReport(records, { days: 30 })
  assert.match(text, /^\d\. Start sessions at a lower effort: \$1\.38 less, 8% of the total$/m)
  assert.match(text, /Why: {2}110 calls read, searched or ran commands at effort high or above\. Their output, which includes thinking, cost \$4\.82\./)
  assert.match(text, /The largest part: opus-5-5, reading and searching, with a median of 1,000 output tokens per call at high and 300 at medium\. 30 of the calls have no lower effort with 200 calls of your own, so they are not in the amount\.$/m)
  assert.match(text, /How: {2}One setting in Claude Code: "effortLevel": "medium"\. New sessions then start at that effort\./)
  assert.match(text, /^ {3}Apply: widal apply effort-default --level medium$/m)
  // Calls at max that are compared with xhigh, and calls at high that are compared with medium: the level
  // to try is the lowest of the two, so that no call stays at a higher effort than before.
  const mixed = mainSession([
    ...many(200, { tools: ['Bash'], effort: 'xhigh', out: 300 }), ...many(100, { tools: ['Bash'], effort: 'max', out: 4000 }),
    ...many(200, { tools: ['Read'], effort: 'medium', out: 300 }), ...many(10, { tools: ['Read'], effort: 'high', out: 400 }),
  ])
  assert.equal(only(proposals(mixed), 'effort-lower')[0].args, '--level medium')

  // Under 1% of the total it is not shown.
  assert.deepEqual(only(proposals([...records, ...largeSpend(), ...largeSpend()]), 'effort-lower'), [])
  // Codex's calls are not counted: the change is a setting of Claude Code.
  assert.deepEqual(only(proposals(codex(Array.from({ length: 300 }, (_, i) => ({ tools: [['function_call', 'shell']], effort: i < 250 ? 'medium' : 'high' })))), 'effort-lower'), [])
})

test('without 200 calls of your own at a lower effort, the proposal for a lower effort has no amount', () => {
  const records = mainSession([...many(199, { tools: ['Read'], effort: 'medium', out: 300 }), ...many(50, { tools: ['Bash'], effort: 'xhigh', out: 1000 }), ...many(5, { tools: ['Read'], effort: 'high', out: 1000 })])
  const p = proposals(records)
  const [found] = only(p, 'effort-lower')
  assert.equal(found.saving, null)
  assert.equal(p.list.at(-1), found) // After the proposals with an amount.
  assert.equal(found.args, '--level high') // One level below xhigh, where most of that output was written.
  const text = adviseReport(records, { days: 30 })
  assert.match(text, /^\d\. Start sessions at a lower effort: no amount yet$/m)
  assert.match(text, /Why: {2}55 calls read, searched or ran commands at effort high or above\. Their output, which includes thinking, cost \$1\.10\. No data of your own at a lower effort yet\. Try it for a week, then run: widal measure effort-default$/m)
  assert.match(text, /^ {3}Apply: widal apply effort-default --level high$/m)
  // When that output is under 1% of the total, the proposal is not shown.
  assert.deepEqual(only(proposals([...records, ...largeSpend(), ...largeSpend()]), 'effort-lower'), [])
  // No call at high effort that read or ran commands: no proposal.
  assert.deepEqual(only(proposals(mainSession([...many(30, { tools: ['Read'], effort: 'medium' }), ...many(30, { tools: ['Edit'], effort: 'high' }), ...many(30, { tools: ['Read'] })])), 'effort-lower'), [])
})

test('a folder whose main sessions are short and mostly read, search and think gets a proposal for a cheaper model in new sessions', () => {
  const at = (cwd) => ({ cwd })
  // Four of five sessions are short: 80%, which is enough. A session of 20 calls is short, one of 21 is not.
  const short = [
    mainSession([call({ tools: ['Read'], ...at('/work/notes') }), call(at('/work/notes'))], 'notes-1'),
    mainSession([call({ tools: ['Grep'], ...at('/work/notes') }), call(at('/work/notes'))]),
    mainSession([call(at('/work/notes')), call({ tools: ['Edit'], ...at('/work/notes') }), call(at('/work/notes'))]), // Two of three calls think.
    mainSession([...many(19, { tools: ['Read'], ...at('/work/notes') }), call(at('/work/notes'))]),
  ].flat()
  const long = mainSession(many(21, { tools: ['Read'], ...at('/work/notes') }))
  // The calls of a subagent are not calls of the main session: the first session stays short.
  const helper = subagent('researcher', many(30, { tools: ['Edit'], ...at('/work/notes') }), 'notes-1')
  // Folders that do not count: half of the sessions are long, the short sessions mostly change files, the model is not above Sonnet 5.5.
  const half = [...mainSession([call({ tools: ['Read'], ...at('/work/app') })]), ...mainSession(many(21, { tools: ['Read'], ...at('/work/app') }))]
  const fixes = mainSession([call({ tools: ['Read'], ...at('/work/fixes') }), ...many(3, { tools: ['Edit'], ...at('/work/fixes') })])
  const cheap = mainSession([call({ tools: ['Read'], model: 'claude-sonnet-5-5', ...at('/work/cheap') })])
  const records = [...short, ...long, ...helper, ...half, ...fixes, ...cheap]

  const found = only(proposals(records), 'project-model')
  assert.deepEqual(found.map((x) => x.folder), ['/work/notes'])
  // Only the short sessions are priced again, at half the price.
  near(found[0].saving, costOf(short) / 2)
  const text = adviseReport(records, { days: 30 })
  assert.match(text, /^\d\. Start new sessions in work\/notes on a cheaper model: \$0\.41 less, 1\d% of the total$/m)
  assert.match(text, /Why: {2}In \/work\/notes, 4 of 5 main sessions had 20 calls or fewer\. 96% of what those short sessions cost is reading, searching and thinking\./)
  assert.match(text, /How: {2}Start new sessions in that folder on Claude Sonnet 5\.5: .* This applies to new sessions only\. A switch in a running session sends its whole context to the new model again\.$/m)
  assert.match(text, /How: {2}Start new sessions in that folder.*\n.*\n {3}Apply: by hand\. This tool does not change it\.$/m)

  // Under 1% of the total it is not shown.
  assert.deepEqual(only(proposals([...records, ...largeSpend()]), 'project-model'), [])
})

const settingsFile = join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
const settingsText = () => JSON.stringify(JSON.parse(readFileSync(settingsFile, 'utf8')))
const useSettings = (settings) => {
  writeFileSync(settingsFile, JSON.stringify(settings))
  return JSON.stringify(settings)
}
const backups = () => readdirSync(join(process.env.WIDAL_HOME, 'backup'))
const BIN = join(process.env.HOME, '.widal', 'bin', 'widal')
const KEY = 'CLAUDE_CODE_SUBAGENT_MODEL'
const APPLIED_AT = Date.parse('2026-11-12T12:00:00Z')

test('apply subagent-model sets the model of all subagents inside "env", and undo puts back exactly what was there', () => {
  const other = { theme: 'dark', hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/x/auto-allow.sh' }] }] } }
  // Other settings and other keys of "env" stay.
  let before = useSettings({ env: { OTHER_TOOL: 'on' }, ...other })
  const said = applyAction('subagent-model', BIN, APPLIED_AT)
  assert.match(said[0], /^Set "CLAUDE_CODE_SUBAGENT_MODEL" to claude-sonnet-5-5 in the "env" of Claude Code's settings\./)
  assert.match(said.join('\n'), /widal measure subagent-model\nTake it back with: widal undo subagent-model$/)
  assert.equal(settingsText(), JSON.stringify({ env: { OTHER_TOOL: 'on', [KEY]: 'claude-sonnet-5-5' }, ...other }))
  assert.ok(backups().some((f) => /^settings\..*\.json$/.test(f))) // A copy of the settings was saved first.
  assert.deepEqual(applyAction('subagent-model', BIN), ['subagent-model is already applied.'])
  assert.deepEqual(actionsStatus().find(([id]) => id === 'subagent-model'), ['subagent-model', `applied on ${day(APPLIED_AT)}`])
  // Another model: the value changes, and undo still goes back to what was there at first.
  applyAction('subagent-model', BIN, APPLIED_AT + 86400e3, ['--model', 'claude-haiku-5-5'])
  assert.equal(JSON.parse(settingsText()).env[KEY], 'claude-haiku-5-5')
  assert.equal(appliedActions()['subagent-model'].at, APPLIED_AT)
  assert.match(undoAction('subagent-model', BIN)[0], /^subagent-model is taken back\./)
  assert.equal(settingsText(), before)
  assert.deepEqual(appliedActions(), {})

  // A value that was there comes back.
  before = useSettings({ env: { [KEY]: 'opus' } })
  applyAction('subagent-model', BIN)
  assert.equal(JSON.parse(settingsText()).env[KEY], 'claude-sonnet-5-5')
  undoAction('subagent-model', BIN)
  assert.equal(settingsText(), before)
  // No "env" before: none after. An empty "env" before: an empty one after.
  for (const settings of [{ theme: 'dark' }, { theme: 'dark', env: {} }]) {
    before = useSettings(settings)
    applyAction('subagent-model', BIN)
    assert.deepEqual(JSON.parse(settingsText()).env, { [KEY]: 'claude-sonnet-5-5' })
    undoAction('subagent-model', BIN)
    assert.equal(settingsText(), before)
  }
  // Changed by hand after the apply: the status says so.
  applyAction('subagent-model', BIN, APPLIED_AT)
  useSettings({ theme: 'dark' })
  assert.deepEqual(actionsStatus().find(([id]) => id === 'subagent-model'), ['subagent-model', `applied on ${day(APPLIED_AT)}, but no longer in the settings`])
  undoAction('subagent-model', BIN)

  assert.throws(() => applyAction('subagent-model', BIN, APPLIED_AT, ['--model', 'two words']), /is not the name of a model/)
  assert.throws(() => applyAction('subagent-model', BIN, APPLIED_AT, ['--modle', 'x']), /subagent-model does not take "--modle"\. It takes: --kind <value>, --model <value>/)
  assert.equal(settingsText(), JSON.stringify({ theme: 'dark' }))
})

test('apply subagent-model --kind sets "model:" in the file of that subagent, keeps the rest of the file, and undo puts the line back', () => {
  const agents = join(process.env.CLAUDE_CONFIG_DIR, 'agents')
  mkdirSync(agents, { recursive: true })
  const file = (name) => join(agents, `${name}.md`)
  const text = (name) => readFileSync(file(name), 'utf8')
  // A file with a model, and text below the front matter that looks like front matter.
  const reviewer = '---\nname: reviewer\ndescription: Reads a change and says what is wrong.\nmodel:  opus\ntools: Read, Grep\n---\n\nYou review code.\n\n---\nmodel: this line is text\n'
  // A file without a model, with Windows line ends.
  const reader = '---\r\nname: reader\r\ndescription: Reads files.\r\n---\r\nYou read files.\r\n'
  writeFileSync(file('reviewer'), reviewer)
  writeFileSync(file('reader'), reader)
  writeFileSync(file('plain'), 'A file without front matter.\n')
  const before = useSettings({ theme: 'dark', env: { OTHER_TOOL: 'on' } })

  const said = applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'reviewer'])
  assert.equal(said[0], `Set "model: claude-sonnet-5-5" in ${file('reviewer')}. The subagent "reviewer" runs on that model.`)
  assert.equal(text('reviewer'), reviewer.replace('model:  opus', 'model: claude-sonnet-5-5'))
  // The file was copied to the backup folder first.
  const copy = backups().find((f) => /^agent-reviewer\..*\.md$/.test(f))
  assert.equal(readFileSync(join(process.env.WIDAL_HOME, 'backup', copy), 'utf8'), reviewer)
  assert.deepEqual(applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'reviewer']), ['subagent-model is already applied.'])
  // A second kind, with a model of its own. The new line goes to the end of the front matter.
  applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'reader', '--model', 'claude-haiku-5-5'])
  assert.equal(text('reader'), '---\r\nname: reader\r\ndescription: Reads files.\r\nmodel: claude-haiku-5-5\r\n---\r\nYou read files.\r\n')
  assert.equal(settingsText(), before) // The settings were not touched.

  // A kind without a file of its own fails with one sentence, and changes nothing.
  assert.throws(() => applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'Explore']), (e) => {
    assert.equal(e.message, `"Explore" has no file of its own in ${agents}, and a built-in kind cannot be changed on its own: use the default for all subagents (widal apply subagent-model).`)
    return true
  })
  assert.throws(() => applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', '../settings']), /a built-in kind cannot be changed on its own/)
  assert.throws(() => applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'plain']), /has no front matter/)
  assert.equal(text('plain'), 'A file without front matter.\n')
  assert.deepEqual(appliedActions()['subagent-model'].before.changes.map((c) => c.kind), ['reviewer', 'reader'])

  // The default for all subagents on top. One undo takes all three back.
  applyAction('subagent-model', BIN, APPLIED_AT)
  assert.equal(JSON.parse(settingsText()).env[KEY], 'claude-sonnet-5-5')
  assert.deepEqual(actionsStatus().find(([id]) => id === 'subagent-model'), ['subagent-model', `applied on ${day(APPLIED_AT)}`])
  assert.deepEqual(undoAction('subagent-model', BIN), ['subagent-model is taken back. The model of your subagents is set as it was before it.'])
  assert.equal(text('reviewer'), reviewer)
  assert.equal(text('reader'), reader)
  assert.equal(settingsText(), before)
  assert.deepEqual(appliedActions(), {})
})

test('the advise report shows a proposal as applied only when its own change was applied', () => {
  const agents = join(process.env.CLAUDE_CONFIG_DIR, 'agents')
  mkdirSync(agents, { recursive: true })
  writeFileSync(join(agents, 'researcher.md'), '---\nname: researcher\ndescription: Looks things up.\n---\nYou look things up.\n')
  useSettings({ theme: 'dark' })
  const records = [...subagent('researcher', many(5, { tools: ['Read'] })), ...subagent('scout', many(5, { tools: ['Grep'] }))]
  const report = () => adviseReport(records, { days: 30, applied: appliedActions() })
  const lineAfter = (title) => new RegExp(`^\\d\\. ${title}: .*\\n.*\\n.*\\n.*\\n {3}(.*)$`, 'm')
  const state = (title) => lineAfter(title).exec(report())[1]

  // The file of the person's own subagent is found in Claude Code's folder.
  assert.equal(state('Run the "researcher" subagents on a cheaper model'), 'Apply: widal apply subagent-model --kind researcher')
  assert.equal(state('Run the "scout" subagents on a cheaper model'), 'Apply: widal apply subagent-model. This changes all subagents.')
  // One kind applied: only that kind's proposal is applied.
  applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'researcher'])
  const done = `Applied on ${day(APPLIED_AT)}. See: widal measure subagent-model. Take it back: widal undo subagent-model`
  assert.equal(state('Run the "researcher" subagents on a cheaper model'), done)
  assert.equal(state('Run the "scout" subagents on a cheaper model'), 'Apply: widal apply subagent-model. This changes all subagents.')
  assert.equal(state('Run subagents on a cheaper model'), 'Apply: widal apply subagent-model')
  // The default for all subagents covers every kind.
  applyAction('subagent-model', BIN, APPLIED_AT)
  for (const title of ['Run the "researcher" subagents on a cheaper model', 'Run the "scout" subagents on a cheaper model', 'Run subagents on a cheaper model']) assert.equal(state(title), done)
  undoAction('subagent-model', BIN)

  // A proposal for a lower effort is applied when the default effort was set by this tool.
  const effort = mainSession([...many(200, { tools: ['Read'], effort: 'medium', out: 300 }), ...many(50, { tools: ['Read'], effort: 'high', out: 1000 })])
  const effortState = () => lineAfter('Start sessions at a lower effort').exec(adviseReport(effort, { days: 30, applied: appliedActions() }))[1]
  assert.equal(effortState(), 'Apply: widal apply effort-default --level medium')
  applyAction('effort-default', BIN, APPLIED_AT, ['--level', 'medium'])
  assert.equal(effortState(), `Applied on ${day(APPLIED_AT)}. See: widal measure effort-default. Take it back: widal undo effort-default`)
  undoAction('effort-default', BIN)
  assert.equal(settingsText(), JSON.stringify({ theme: 'dark' }))
})

test('apply effort-default sets "effortLevel" to the level asked for, and undo puts back what was there', () => {
  let before = useSettings({ effortLevel: 'high', theme: 'dark', env: { OTHER_TOOL: 'on' } })
  const said = applyAction('effort-default', BIN, APPLIED_AT)
  assert.deepEqual(said, ['Set "effortLevel" to medium in Claude Code\'s settings.', 'New sessions use it. Check the effect with: widal measure effort-default', 'Take it back with: widal undo effort-default'])
  assert.equal(settingsText(), JSON.stringify({ effortLevel: 'medium', theme: 'dark', env: { OTHER_TOOL: 'on' } }))
  assert.deepEqual(applyAction('effort-default', BIN), ['effort-default is already applied.'])
  // Another level: the value changes, and undo still goes back to what was there at first.
  applyAction('effort-default', BIN, APPLIED_AT, ['--level', 'low'])
  assert.equal(JSON.parse(settingsText()).effortLevel, 'low')
  assert.deepEqual(applyAction('effort-default', BIN, APPLIED_AT, ['--level', 'low']), ['effort-default is already applied.'])
  assert.deepEqual(actionsStatus().find(([id]) => id === 'effort-default'), ['effort-default', `applied on ${day(APPLIED_AT)}`])
  assert.throws(() => applyAction('effort-default', BIN, APPLIED_AT, ['--level', 'max']), /--level is one of low, medium, high, xhigh/)
  assert.throws(() => applyAction('effort-default', BIN, APPLIED_AT, ['--level']), /--level needs a value after it/)
  assert.throws(() => applyAction('effort-default', BIN, APPLIED_AT, ['--kind', 'reviewer']), /effort-default does not take "--kind"\. It takes: --level <value>/)
  assert.equal(JSON.parse(settingsText()).effortLevel, 'low')
  undoAction('effort-default', BIN)
  assert.equal(settingsText(), before)

  // No level before: none after.
  before = useSettings({ theme: 'dark' })
  applyAction('effort-default', BIN, APPLIED_AT, ['--level', 'xhigh'])
  assert.equal(JSON.parse(settingsText()).effortLevel, 'xhigh')
  undoAction('effort-default', BIN)
  assert.equal(settingsText(), before)
  assert.deepEqual(appliedActions(), {})
})

test('undo puts a setting back only while it still holds what the change set: a value that was changed by hand since then stays, and undo says so', () => {
  const left = (what, now, old) => `${what} was not put back, because it was changed after this tool set it: it is ${now} now, and it was ${old} before the change.`
  // The level was low. The change set medium, and the person then set xhigh by hand.
  useSettings({ effortLevel: 'low', theme: 'dark' })
  applyAction('effort-default', BIN, APPLIED_AT)
  let byHand = useSettings({ effortLevel: 'xhigh', theme: 'dark' })
  assert.deepEqual(undoAction('effort-default', BIN), [
    'effort-default is taken back, except for one setting.',
    left('"effortLevel" in Claude Code\'s settings', '"xhigh"', '"low"'),
  ])
  assert.equal(settingsText(), byHand)
  // The change itself no longer counts as applied.
  assert.deepEqual(appliedActions(), {})
  // Taken out by hand: it stays out.
  useSettings({ effortLevel: 'low', theme: 'dark' })
  applyAction('effort-default', BIN, APPLIED_AT)
  byHand = useSettings({ theme: 'dark' })
  assert.deepEqual(undoAction('effort-default', BIN), ['effort-default is taken back, except for one setting.', left('"effortLevel" in Claude Code\'s settings', 'not set', '"low"')])
  assert.equal(settingsText(), byHand)
  // Set by hand to what it was before: there is nothing to put back, and nothing to say.
  useSettings({ effortLevel: 'low', theme: 'dark' })
  applyAction('effort-default', BIN, APPLIED_AT)
  byHand = useSettings({ effortLevel: 'low', theme: 'dark' })
  assert.deepEqual(undoAction('effort-default', BIN), ['effort-default is taken back. Claude Code\'s settings are as they were before it.'])
  assert.equal(settingsText(), byHand)
  // Applied twice: the value to compare with is the level of the last apply.
  let before = useSettings({ effortLevel: 'high' })
  applyAction('effort-default', BIN, APPLIED_AT)
  applyAction('effort-default', BIN, APPLIED_AT, ['--level', 'low'])
  byHand = useSettings({ effortLevel: 'medium' })
  assert.deepEqual(undoAction('effort-default', BIN)[1], left('"effortLevel" in Claude Code\'s settings', '"medium"', '"high"'))
  assert.equal(settingsText(), byHand)

  // The cache of subagents, which was not set before the change.
  useSettings({ theme: 'dark' })
  applyAction('subagent-cache-1h', BIN, APPLIED_AT)
  byHand = useSettings({ theme: 'dark', subagentPromptCacheTtl: '5m' })
  assert.deepEqual(undoAction('subagent-cache-1h', BIN), [
    'subagent-cache-1h is taken back, except for one setting.',
    left('"subagentPromptCacheTtl" in Claude Code\'s settings', '"5m"', 'not set'),
  ])
  assert.equal(settingsText(), byHand)
  // Not touched since the change: it goes back as before.
  before = useSettings({ theme: 'dark' })
  applyAction('subagent-cache-1h', BIN, APPLIED_AT)
  assert.deepEqual(undoAction('subagent-cache-1h', BIN), ['subagent-cache-1h is taken back. Claude Code\'s settings are as they were before it.'])
  assert.equal(settingsText(), before)

  // The model of subagents: the setting for all of them, and the line in the file of one kind.
  const agents = join(process.env.CLAUDE_CONFIG_DIR, 'agents')
  mkdirSync(agents, { recursive: true })
  const file = join(agents, 'checker.md')
  const checker = (line) => `---\nname: checker\n${line}---\nYou check.\n`
  const applyBoth = () => {
    writeFileSync(file, checker('model: opus\n'))
    useSettings({ env: { OTHER_TOOL: 'on' } })
    applyAction('subagent-model', BIN, APPLIED_AT)
    applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', 'checker'])
    assert.equal(readFileSync(file, 'utf8'), checker('model: claude-sonnet-5-5\n'))
  }
  applyBoth()
  byHand = useSettings({ env: { OTHER_TOOL: 'on', [KEY]: 'claude-haiku-5-5' } })
  writeFileSync(file, checker('model: haiku\n'))
  assert.deepEqual(undoAction('subagent-model', BIN), [
    'subagent-model is taken back, except for one file and one setting.',
    `${file} was not put back, because its "model:" line was changed after this tool set it: it is "model: haiku" now (its line before the change: "model: opus").`,
    left('"CLAUDE_CODE_SUBAGENT_MODEL" in the "env" of Claude Code\'s settings', '"claude-haiku-5-5"', 'not set'),
  ])
  assert.equal(readFileSync(file, 'utf8'), checker('model: haiku\n'))
  assert.equal(settingsText(), byHand)
  assert.deepEqual(appliedActions(), {})
  // The line was taken out of the file by hand: it stays out. The setting was not touched: it goes back.
  applyBoth()
  writeFileSync(file, checker(''))
  assert.deepEqual(undoAction('subagent-model', BIN), [
    'subagent-model is taken back, except for one file.',
    `${file} was not put back, because its "model:" line was changed after this tool set it: it has none now (its line before the change: "model: opus").`,
  ])
  assert.equal(readFileSync(file, 'utf8'), checker(''))
  assert.equal(settingsText(), JSON.stringify({ env: { OTHER_TOOL: 'on' } }))
  // The line was set by hand to what it was before: nothing to put back, and nothing to say.
  applyBoth()
  writeFileSync(file, checker('model: opus\n'))
  assert.deepEqual(undoAction('subagent-model', BIN), ['subagent-model is taken back. The model of your subagents is set as it was before it.'])
  assert.equal(readFileSync(file, 'utf8'), checker('model: opus\n'))
  rmSync(file)
})

test('the apply command passes its arguments on to the change', () => {
  // Folders of its own, so that the command does not see what the other tests applied. A home
  // folder of its own too: "apply" looks there for the link of the command.
  const own = join(dir, 'command')
  const env = { ...process.env, HOME: own, USERPROFILE: own, WIDAL_HOME: join(own, 'home'), CLAUDE_CONFIG_DIR: join(own, 'claude'), CODEX_HOME: join(own, 'codex') }
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true })
  const file = join(env.CLAUDE_CONFIG_DIR, 'settings.json')
  writeFileSync(file, JSON.stringify({ theme: 'dark', effortLevel: 'high' }))
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../cli/widal.mjs', import.meta.url)), ...args], { encoding: 'utf8', env })
  const settings = () => JSON.parse(readFileSync(file, 'utf8'))

  assert.match(run('apply', 'effort-default', '--level', 'low').stdout, /^Set "effortLevel" to low in Claude Code's settings\.\n/)
  assert.deepEqual(settings(), { theme: 'dark', effortLevel: 'low' })
  assert.match(run('apply', 'subagent-model', '--model', 'claude-haiku-5-5').stdout, /^Set "CLAUDE_CODE_SUBAGENT_MODEL" to claude-haiku-5-5 /)
  assert.deepEqual(settings().env, { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-5-5' })
  const failed = run('apply', 'subagent-model', '--kind', 'Explore')
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /^widal: "Explore" has no file of its own in .*, and a built-in kind cannot be changed on its own: use the default for all subagents \(widal apply subagent-model\)\.\n$/)
  // The list of changes names the two new ones with their arguments.
  assert.match(run('apply').stdout, / {2}subagent-model\n {4}Sets the model that subagents run on: .*--kind <name>.*\n\n {2}effort-default\n {4}Sets "effortLevel" .*--level/)
  run('undo', 'effort-default')
  run('undo', 'subagent-model')
  assert.deepEqual(settings(), { theme: 'dark', effortLevel: 'high' })
})

const { analyze, measures, repeatedToolCalls } = await import('../src/analyze.mjs')
const { measureCache, measureReport, verdict } = await import('../src/advise.mjs')
const { branch, branches, callLine, callsReport, findings, session: sessionReport } = await import('../src/report.mjs')

/** The line that Claude Code writes after a call, with the results of its tools. With `error`, the tools failed. */
function results(callLine, error = false) {
  const uses = JSON.parse(callLine).message.content
  return JSON.stringify({ type: 'user', message: { role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'made-up output', is_error: error })) } })
}
/** A call and, after it, the results of its tools as failed. */
const failing = (options) => {
  const line = call(options)
  return [line, results(line, true)]
}
/** The line that Claude Code writes when the person interrupts the agent. */
const interrupt = (text = '[Request interrupted by user]') => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
const typed = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const measured = (records) => measures(analyze(records).calls)

test('the parsers keep how many tool results failed before a call and whether the person interrupted, as numbers only', () => {
  const two = call({ tools: ['Bash', 'Read'] })
  const read = call({ tools: ['Read'] })
  const records = claude([
    two, results(two, true), // Both results failed.
    ...failing({ tools: ['Bash'] }), // Two failed results came before this call. Its own result fails too.
    read, results(read), // One failed result came before this call. Its own result is fine.
    interrupt(),
    call(),
    interrupt('[Request interrupted by user for tool use]'),
    call(),
    typed('a made-up message that names the [Request interrupted by user] line'), // Not the marker itself.
    call(),
  ])
  assert.deepEqual(records.map((r) => [r.err, r.intr]), [[undefined, undefined], [2, undefined], [1, undefined], [undefined, 1], [undefined, 1], [undefined, undefined]])
  // A tool call whose result failed is marked with a 1 after its name and signature.
  assert.deepEqual(records.map((r) => r.tools.map((t) => t[2])), [[1, 1], [1], [undefined], [], [], []])
  // Only numbers are kept: no text of a result, of a message or of the marker.
  assert.doesNotMatch(JSON.stringify(records), /made-up|interrupted/)

  // Codex: an item that failed, and a turn that the person stopped.
  const p = new CodexParser('/codex/rollout-2.jsonl')
  const usage = (i) => ({ type: 'token_usage_record', timestamp: new Date(START + i * 10e3).toISOString(), payload: { response_id: `x${i}`, usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 500 } } })
  const item = (type, status) => ({ type: 'event_msg', payload: { type: 'item_completed', item: { type, status } } })
  for (const l of [
    { type: 'session_meta', payload: { session_id: 'c2', cwd: '/work/app' } },
    { type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'high' } },
    usage(0),
    item('CommandExecution', 'failed'), item('CommandExecution', 'completed'), item('McpToolCall', 'failed'), item('Reasoning'),
    usage(1),
    { type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } },
    { type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'high' } },
    usage(2),
    { type: 'event_msg', payload: { type: 'turn_aborted', reason: 'replaced' } }, // Not stopped by the person.
    usage(3),
  ]) p.feed(JSON.stringify(l))
  assert.deepEqual(p.result().records.map((r) => [r.err, r.intr]), [[undefined, undefined], [2, undefined], [undefined, 1], [undefined, undefined]])
})

test('the cache of parsed logs keeps the new numbers, and a cache from before them is read again', async () => {
  const project = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'measure-repo')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'e1.jsonl'), `${[...failing({ tools: ['Bash'] }), interrupt(), call()].join('\n')}\n`)
  const mine = async () => (await load({ since: 0 })).records.filter((r) => r.ses === 'e1').map((r) => [r.err, r.intr, r.tools.map((t) => t[2])])
  const expected = [[undefined, undefined, [1]], [1, 1, []]]
  assert.deepEqual(await mine(), expected)
  assert.deepEqual(await mine(), expected) // From the cache.
  const cache = join(process.env.WIDAL_HOME, 'cache')
  for (const f of readdirSync(cache)) {
    const entry = JSON.parse(readFileSync(join(cache, f), 'utf8'))
    assert.equal(entry.v, 15)
    writeFileSync(join(cache, f), JSON.stringify({ ...entry, v: 8, records: [] }))
  }
  assert.deepEqual(await mine(), expected)
})

test('the measures of a group of calls: cost, tool errors, rounds of fixing, interrupts and repeated tool calls, as rates', () => {
  const command = { command: 'a made-up test run' }
  // A session of 4 calls: a command fails, a file is changed, the same command runs again.
  const fix = mainSession([...failing({ tools: ['Bash'], input: command }), call({ tools: ['Edit'] }), call({ tools: ['Bash'], input: command }), call({ tools: ['Read'] })])
  // A session of 6 calls: a read fails, the person interrupts, the same search runs 4 times.
  const loop = mainSession([...failing({ tools: ['Read'] }), interrupt(), ...many(4, { tools: ['Grep'], input: { pattern: 'made-up' } }), call()])
  const records = [...fix, ...loop]
  const m = measured(records)
  assert.equal(m.calls, 10)
  assert.equal(m.sessions, 2)
  near(m.cost, (1000 * costOf(records)) / 10)
  near(m.costPerSession, costOf(records) / 2)
  assert.equal(m.callsPerSession, 5)
  assert.equal(m.errors, 200) // Two failed results in 10 calls.
  assert.equal(m.fixRounds, 100) // One round. The failed read is not a command.
  assert.equal(m.interrupts, 100)
  assert.equal(m.repeats, 400) // The four searches. Three times the same would not count.
  // A group without calls has no rates.
  assert.deepEqual(measured([]), { calls: 0, sessions: 0, cost: 0, costPerSession: 0, callsPerSession: 0, errors: 0, fixRounds: 0, interrupts: 0, repeats: 0 })

  // The rule for repeated tool calls is the one of the findings: 4 times or more in one session.
  const repeats = mainSession([...many(4, { tools: ['Grep'], input: { pattern: 'made-up' } }), ...many(3, { tools: ['Read'], input: { file: 'made-up' } })], 'loop-1')
  assert.deepEqual(repeatedToolCalls(analyze(repeats).calls), [{ ses: 'loop-1', tool: 'Grep', n: 4, cwd: '/work/repo' }])
  const text = findings(repeats, { days: 7 })
  assert.match(text, /^ {3}Grep ran 4 times with a repeated input \(1 input, each 4 times or more\) in work\/repo, about \$0\.00\. Likely cause: a loop, or a check that is repeated on purpose\.$/m)
  assert.doesNotMatch(text, /Read ran/)
})

test('a round of fixing is a failed command, later a change of files, later the same command again', () => {
  const x = { command: 'a made-up test run' }
  const fails = (tools = ['Bash'], input = x) => failing({ tools, input })
  const runs = (tools = ['Bash'], input = x) => {
    const line = call({ tools, input })
    return [line, results(line)]
  }
  const edit = () => runs(['Edit'], undefined)
  const rounds = (...steps) => {
    const records = mainSession(steps.flat())
    return Math.round((measured(records).fixRounds * records.length) / 1000)
  }
  assert.equal(rounds(fails(), edit(), runs()), 1)
  assert.equal(rounds(fails(), edit(), edit(), runs(['Read'], undefined), runs()), 1) // Later, not only right after.
  assert.equal(rounds(fails(), edit(), fails(), runs(['Write'], undefined), runs()), 2) // It failed again, and was fixed again.
  assert.equal(rounds(fails(), runs()), 0) // No file was changed between.
  assert.equal(rounds(fails(), edit(), runs(['Bash'], { command: 'another made-up command' })), 0)
  assert.equal(rounds(runs(), edit(), runs()), 0) // The command did not fail.
  assert.equal(rounds(fails(['Read']), edit(), runs(['Read'])), 0) // A failed read is not a failed command.
  assert.equal(rounds(fails(['Bash', 'Edit']), runs()), 0) // The change of files came with the failed command, not after it.
  assert.equal(rounds(fails(), edit(), runs(), runs()), 1) // One round, not one for every later run.
  // A session and its subagent each work on their own: the subagent's change does not fix the session's command.
  const main = mainSession(fails(), 'fix-1')
  const sub = subagent('builder', [...edit(), ...runs()], 'fix-1')
  assert.equal(measured([...main, ...sub]).fixRounds, 0)
})

const AT = Date.parse('2026-11-12T12:00:00Z')

/**
 * Made-up logs for one side of a change: sessions of `each` calls, one call a minute from the
 * time `from`. Every call runs a command. The first `errors` commands of each session fail.
 */
function sessionsFrom(from, { sessions = 25, each = 24, errors = 0, ...options } = {}) {
  const name = `side-${logs++}`
  const records = []
  for (let s = 0; s < sessions; s++) {
    const lines = []
    for (let i = 0; i < each; i++) {
      const line = call({ tools: ['Bash'], ...options, ts: from + (s * each + i) * 60e3 })
      lines.push(line, results(line, i < errors))
    }
    records.push(...claude(lines, `/logs/${name}-${s}.jsonl`))
  }
  return records
}
const before = (options) => sessionsFrom(AT - 2 * 86400e3, options)
const after = (options) => sessionsFrom(AT + 3600e3, options)
const SIGNS = 'These are signs, not proof. The work before and after is not the same work, and no measure shows for sure that a change was right.'
/** The last two lines of the report for a change that is measured on all calls. */
const closing = (records) => measureReport(records, { id: 'model-switch-cost', at: AT }).split('\n').slice(-2)

test('the measure report ends with one sentence on cost and work, then says that these are signs', () => {
  const opus = { model: 'claude-opus-5-5' }
  const sonnet = { model: 'claude-sonnet-5-5' } // Half the price of Opus 5.5.
  // 600 calls in 25 sessions on each side. Half the cost, the same tool errors.
  assert.deepEqual(closing([...before({ ...opus, errors: 2 }), ...after({ ...sonnet, errors: 2 })]), ['Cheaper, and the work looks the same.', SIGNS])
  // Half the cost, and tool errors up by half.
  assert.deepEqual(closing([...before({ ...opus, errors: 2 }), ...after({ ...sonnet, errors: 3 })]), ['Cheaper, but the work looks worse.', SIGNS])
  // The same cost. And: half the cost, but tool errors up by 15%, which is between the two limits.
  assert.deepEqual(closing([...before({ ...opus, errors: 2 }), ...after({ ...opus, errors: 2 })]), ['No clear difference.', SIGNS])
  assert.deepEqual(closing([...before({ ...opus, errors: 20 }), ...after({ ...sonnet, errors: 23 })]), ['No clear difference.', SIGNS])
  // Under 500 calls after the change (475), or under 20 sessions (19).
  assert.deepEqual(closing([...before(opus), ...after({ ...sonnet, each: 19 })]), ['Too early to judge.', SIGNS])
  assert.deepEqual(closing([...before(opus), ...after({ ...sonnet, sessions: 19, each: 30 })]), ['Too early to judge.', SIGNS])
  // No calls before the change.
  assert.deepEqual(closing(after(sonnet)), ['Nothing to compare with: there are no such calls in the 14 days before the change.', SIGNS])

  // The limits of the sentences, from the measures of the two sides.
  const m = (cost, errors = 10, fixRounds = 1, calls = 500, sessions = 20) => ({ calls, sessions, cost, errors, fixRounds })
  assert.equal(verdict(m(100), m(95, 11, 1.1)), 'Cheaper, and the work looks the same.') // Down by 5%, and both signs up by 10%.
  assert.equal(verdict(m(100), m(96)), 'No clear difference.') // Down by 4%.
  assert.equal(verdict(m(100), m(110, 20, 2)), 'No clear difference.') // Not cheaper.
  assert.equal(verdict(m(100), m(50, 12.5)), 'No clear difference.') // Up by 25%: not more than 25%.
  assert.equal(verdict(m(100), m(99, 12.6)), 'Cheaper, but the work looks worse.')
  assert.equal(verdict(m(100), m(50, 10, 1.3)), 'Cheaper, but the work looks worse.') // Rounds of fixing up by 30%.
  assert.equal(verdict(m(100, 0, 0), m(90, 0, 0)), 'Cheaper, and the work looks the same.')
  assert.equal(verdict(m(100, 0, 0), m(90, 1, 0)), 'Cheaper, but the work looks worse.') // From no tool errors to some.
  assert.equal(verdict(m(100), m(50, 10, 1, 499)), 'Too early to judge.')
  assert.equal(verdict(m(100), m(50, 10, 1, 500, 19)), 'Too early to judge.')
})

test('each change is measured on the calls it acts on, from 14 days before it', () => {
  const at = (ts) => ({ tools: ['Read'], ts })
  const day = 86400e3
  const records = [
    ...mainSession([...many(5, at(AT - 15 * day)), ...many(3, at(AT - day)), ...many(4, at(AT + day))], 'acts-1'), // The first five are too old.
    ...subagent('researcher', [...many(2, at(AT - day)), call(at(AT + day))], 'acts-1'),
  ]
  const report = (id) => measureReport(records, { id, at: AT })
  const calls = (text) => /^Calls {2,}(\d+) {2,}(\d+)$/m.exec(text).slice(1).map(Number)
  assert.equal(report('subagent-model').split('\n')[0], `subagent-model, applied on ${when(AT)}. Subagent calls before and after.`)
  assert.deepEqual(calls(report('subagent-model')), [2, 1])
  assert.equal(report('effort-default').split('\n')[0], `effort-default, applied on ${when(AT)}. Main session calls before and after.`)
  assert.deepEqual(calls(report('effort-default')), [3, 4])
  assert.equal(report('model-switch-cost').split('\n')[0], `model-switch-cost, applied on ${when(AT)}. All calls before and after.`)
  assert.deepEqual(calls(report('model-switch-cost')), [5, 5])

  // Every measure has a line, and the two that need a word of their own are explained.
  const text = report('effort-default')
  for (const line of ['Sessions', 'Cost, per 1,000 calls', 'Cost, per session', 'Calls, per session', 'Tool errors, per 1,000 calls', 'Rounds of fixing, per 1,000 calls', 'Interrupts by you, per 1,000 calls', 'Repeated tool calls, per 1,000 calls']) {
    assert.match(text, new RegExp(`^${line} {2,}\\S+ {2,}\\S+$`, 'm'), line)
  }
  assert.match(text, /^Cost, per 1,000 calls {2,}\$30\.40 {2,}\$30\.40$/m) // A made-up call of this kind costs $0.0304.
  assert.match(text, /^Cost, per session {2,}\$0\.09 {2,}\$0\.12$/m)
  assert.match(text, /^Calls, per session {2,}3\.0 {2,}4\.0$/m)
  assert.match(text, /^A round of fixing: a command failed, then files were changed, then the same command ran again\. A repeated tool call: the same tool with the same input, 4 times or more in one session\.$/m)
  assert.deepEqual(text.split('\n').slice(-2), ['Too early to judge.', SIGNS])
  assert.doesNotMatch(text, /[^\x00-\x7F]/) // Plain characters only, so no dashes.

  // Codex's log does not say which command failed. With only Codex calls the line is left out, and
  // the last line names what is missing.
  const codexCalls = codex([{ tools: [['function_call', 'shell']] }, {}])
  const onlyCodex = measureReport(codexCalls, { id: 'model-switch-cost', at: START + 5e3 })
  assert.equal(onlyCodex.split('\n').at(-1), `${SIGNS} Missing: rounds of fixing for Codex, because its log does not say which command failed.`)
  assert.doesNotMatch(onlyCodex, /[Rr]ound of fixing|Rounds of fixing,/)
  assert.match(onlyCodex, /^Tool errors, per 1,000 calls {2,}0\.0 {2,}0\.0$/m)
  // With calls of both agents the line is there, for Claude Code's calls, and the last line still says it.
  const both = measureReport([...codexCalls, ...mainSession([call({ ts: START })])], { id: 'model-switch-cost', at: START + 5e3 })
  assert.match(both, /^Rounds of fixing, per 1,000 calls {2,}0\.0 {2,}0\.0$/m)
  assert.match(both.split('\n').at(-1), / Missing: rounds of fixing for Codex, /)
})

test('measure subagent-cache-1h still prints its old lines, then the new measures', () => {
  // A subagent that waits 10 minutes between two calls. Before the change it wrote a 5 minute cache
  // and lost it. After the change it wrote a 1 hour cache and read it.
  const line = (id, ts, usage) => JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), cwd: '/work/repo', message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [], usage } })
  const wrote = (w5, w1, read) => ({ input_tokens: 10, cache_creation_input_tokens: w5 + w1, cache_read_input_tokens: read, output_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 } })
  const records = [
    ...claude([line('w1', AT - 86400e3, wrote(100000, 0, 0)), line('w2', AT - 86400e3 + 600e3, wrote(100400, 0, 0))], '/logs/wait/subagents/agent-1.jsonl'),
    ...claude([line('w3', AT + 3600e3, wrote(0, 100000, 0)), line('w4', AT + 3600e3 + 600e3, wrote(0, 400, 100010))], '/logs/wait/subagents/agent-2.jsonl'),
    ...mainSession(many(3, { ts: AT + 3600e3 }), 'wait'), // The calls of the main session are not counted.
  ]
  const text = measureReport(records, { id: 'subagent-cache-1h', at: AT })

  // What the report printed before the new measures, built here the way it was built then.
  const m = measureCache(records, AT)
  const row = (label, f) => [label, f(m.before), f(m.after)]
  const old = [
    `subagent-cache-1h, applied on ${when(AT)}. Subagent calls before and after.`,
    '',
    table([
      ['', 'before', 'after'],
      row('Subagent calls', (x) => count(x.calls)),
      row('Share of cache writes with the 1 hour cache', (x) => `${Math.round(100 * x.hour)}%`),
      row('Lost caches after a wait of 5 to 60 minutes, per 1,000 calls', (x) => x.lost.toFixed(1)),
      row('Cost of those lost caches, per 1,000 calls', (x) => money(x.lostCost)),
      row('All cost, per 1,000 calls', (x) => money(x.cost)),
    ], [1, 2]),
    '',
    'Too early to judge: only 2 subagent calls since the change. Look again after a few days of normal work.',
  ]
  assert.deepEqual(text.split('\n').slice(0, old.join('\n').split('\n').length), old.join('\n').split('\n'))
  assert.match(text, /^Subagent calls {2,}2 {2,}2$/m)
  assert.match(text, /^Share of cache writes with the 1 hour cache {2,}0% {2,}100%$/m)
  assert.match(text, /^Lost caches after a wait of 5 to 60 minutes, per 1,000 calls {2,}500\.0 {2,}0\.0$/m)
  assert.match(text, /^Cost of those lost caches, per 1,000 calls {2,}\$240 {2,}\$0\.00$/m)

  // Then the new measures for the same subagent calls, and the closing lines.
  const rest = text.split('\n').slice(old.join('\n').split('\n').length)
  assert.deepEqual(rest.slice(0, 3), ['', 'The same calls: what they cost, and signs of how the work went.', ''])
  assert.match(rest.join('\n'), /^Calls {2,}2 {2,}2$/m)
  assert.match(rest.join('\n'), /^Sessions {2,}1 {2,}1$/m)
  assert.match(rest.join('\n'), /^Tool errors, per 1,000 calls {2,}0\.0 {2,}0\.0$/m)
  assert.deepEqual(rest.slice(-2), ['Too early to judge.', SIGNS])
})

test('the measure command works for every applied change', () => {
  // Folders of its own, with made-up logs and a made-up list of applied changes.
  const own = join(dir, 'measure-command')
  const env = { ...process.env, WIDAL_HOME: join(own, 'home'), CLAUDE_CONFIG_DIR: join(own, 'claude'), CODEX_HOME: join(own, 'codex') }
  const project = join(env.CLAUDE_CONFIG_DIR, 'projects', 'work-repo')
  mkdirSync(join(project, 's1', 'subagents'), { recursive: true })
  mkdirSync(env.WIDAL_HOME, { recursive: true })
  const at = (ts) => ({ tools: ['Read'], ts })
  writeFileSync(join(project, 's1.jsonl'), `${[...many(2, at(AT - 86400e3)), call(at(AT + 86400e3))].join('\n')}\n`)
  writeFileSync(join(project, 's1', 'subagents', 'agent-1.jsonl'), `${[call(at(AT - 86400e3)), ...many(3, at(AT + 86400e3))].join('\n')}\n`)
  const state = { at: AT, before: {} }
  writeFileSync(join(env.WIDAL_HOME, 'actions.json'), JSON.stringify({ 'subagent-cache-1h': state, 'subagent-model': state, 'effort-default': state, 'model-switch-cost': state }))
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../cli/widal.mjs', import.meta.url)), 'measure', ...args], { encoding: 'utf8', env })
  const ending = `\nToo early to judge.\n${SIGNS}\n`

  // Without a name: the 1 hour cache for subagents, with its old lines first.
  const cache = run().stdout
  assert.equal(cache.split('\n')[0], `subagent-cache-1h, applied on ${when(AT)}. Subagent calls before and after.`)
  assert.match(cache, /^Subagent calls {2,}1 {2,}3$/m)
  assert.match(cache, /^Share of cache writes with the 1 hour cache {2,}0% {2,}0%$/m)
  assert.match(cache, /^Too early to judge: only 3 subagent calls since the change\. Look again after a few days of normal work\.$/m)
  assert.match(cache, /^Calls {2,}1 {2,}3$/m)
  assert.ok(cache.endsWith(ending))
  for (const [id, label, calls] of [['subagent-model', 'Subagent calls', /^Calls {2,}1 {2,}3$/m], ['effort-default', 'Main session calls', /^Calls {2,}2 {2,}1$/m], ['model-switch-cost', 'All calls', /^Calls {2,}3 {2,}4$/m]]) {
    const text = run(id).stdout
    assert.equal(text.split('\n')[0], `${id}, applied on ${when(AT)}. ${label} before and after.`)
    assert.match(text, calls)
    assert.ok(text.endsWith(ending), id)
  }
  const unknown = run('no-such-change')
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /^widal: There is no change "no-such-change"\. The changes are: subagent-cache-1h, model-switch-cost, cold-start-warn, subagent-model, effort-default, keep-warm, compact-keep, autocompact-window, bash-output-cap, no-bypass, deny-secret-files, tools-unused, transcript-days\n$/)
  // A change that was not applied.
  writeFileSync(join(env.WIDAL_HOME, 'actions.json'), JSON.stringify({ 'subagent-model': state }))
  assert.equal(run('effort-default').stdout, 'effort-default is not applied. Apply it with: widal apply effort-default\n')
})

test('the shares by model and effort, by kind of work and in the closing sentence are each cost as a part of all cost', () => {
  // A made-up call on Claude Opus 5.5 costs $0.0104 plus $0.00002 per token of output: $0.06, $0.03 and $0.02.
  const records = claude([call({ tools: ['Read'], effort: 'high', out: 2480 }), call({ tools: ['Edit'], effort: 'medium', out: 980 }), call({ out: 480 })])
  near(costOf(records), 0.11)
  const text = models(records, { days: 30 })
  assert.match(text, /^ {2}opus-5-5 {2,}high {2,}1 {2,}\$0\.06 {2,}55%$/m)
  assert.match(text, /^ {2}opus-5-5 {2,}medium {2,}1 {2,}\$0\.03 {2,}27%$/m)
  assert.match(text, /^ {2}opus-5-5 {2,}\(not logged\) {2,}1 {2,}\$0\.02 {2,}18%$/m)
  assert.match(text, /^ {2}reading and searching {2,}\$0\.06 {2,}55% {2,}\$0\.06 {2,}55% {2,}\$0\.00 {2,}0%$/m)
  assert.match(text, /^ {2}changing files {2,}\$0\.03 {2,}27% {2,}\$0\.03 {2,}27% {2,}\$0\.00 {2,}0%$/m)
  assert.equal(text.split('\n').at(-1), "1 calls read, searched or ran commands at effort high or above, on a model whose output costs more than Claude Sonnet 5.5's: they cost $0.06, 55% of all cost.")
})

test('a strong model is one whose output price is above Sonnet 5.5\'s, whatever its input price is', () => {
  // The two made-up models: one costs more than Sonnet 5.5 for input only, the other for output only.
  const dearInput = claude([call({ tools: ['Read'], effort: 'high', model: 'made-up-dear-input' })])
  const dearOutput = claude([call({ tools: ['Read'], effort: 'high', model: 'made-up-dear-output' })])
  near(costOf(dearInput), 0.0519)
  near(costOf(dearOutput), 0.0326)
  assert.equal(simpleOnStrong(dearInput[0]), false)
  assert.equal(simpleOnStrong(dearOutput[0]), true)
  // The closing section of the report counts only the call on the model with the dear output.
  const d = modelsData([...dearInput, ...dearOutput])
  assert.equal(d.simple.calls, 1)
  near(d.simple.cost, 0.0326)
  assert.equal(models([...dearInput, ...dearOutput], { days: 30 }).split('\n').at(-1), "1 calls read, searched or ran commands at effort high or above, on a model whose output costs more than Claude Sonnet 5.5's: they cost $0.03, 39% of all cost.")
})

test('the proposals for a cheaper model count only calls on a model whose output costs more than Sonnet 5.5\'s', () => {
  const ownFile = () => undefined
  // A kind of subagent that reads, on the model whose input is dear and whose output is not. At
  // Sonnet 5.5 prices its tokens would cost far less, but its model is not a strong one: no proposal.
  const inputOnly = subagent('input-reader', many(5, { tools: ['Read'], model: 'made-up-dear-input' }))
  assert.ok(costOf(inputOnly) > 3 * 5 * 0.0152) // More than three times the same tokens at Sonnet 5.5 prices.
  assert.deepEqual(proposals(inputOnly, { ownFile }).list.filter((x) => x.id.startsWith('subagent-model')), [])
  // The same on the model whose output is dear: both proposals, with the tokens priced again.
  const outputOnly = subagent('output-reader', many(5, { tools: ['Read'], model: 'made-up-dear-output' }))
  const found = proposals(outputOnly, { ownFile })
  near(only(found, 'subagent-model')[0].saving, 5 * (0.0326 - 0.0152))
  near(only(found, 'subagent-model-by-kind')[0].saving, 5 * (0.0326 - 0.0152))
  // A kind on two models: only the calls on the strong one are counted and priced again.
  const mixed = subagent('mixed-reader', [...many(3, { tools: ['Read'] }), ...many(2, { tools: ['Read'], model: 'made-up-dear-input' })])
  const [byKind] = only(proposals(mixed, { ownFile }), 'subagent-model-by-kind')
  near(byKind.saving, costOf(mixed.slice(0, 3)) / 2)
  assert.match(byKind.evidence, / 3 of their calls ran on a model that costs more than Claude Sonnet 5\.5\. They cost \$0\.09\. The same tokens at Sonnet 5\.5 prices cost \$0\.05\.$/)
  const [all] = only(proposals(mixed, { ownFile }), 'subagent-model')
  near(all.saving, costOf(mixed.slice(0, 3)) / 2)
  assert.match(all.evidence, /^3 subagent calls ran on a model that costs more than Claude Sonnet 5\.5\./)

  // A folder of short sessions that read: the same rule.
  const session = (model, cwd) => mainSession([call({ tools: ['Read'], model, cwd }), call({ model, cwd })])
  assert.deepEqual(only(proposals(session('made-up-dear-input', '/work/input')), 'project-model'), [])
  const [folder] = only(proposals(session('made-up-dear-output', '/work/output')), 'project-model')
  assert.equal(folder.folder, '/work/output')
  near(folder.saving, 2 * (0.0326 - 0.0152))
  // Two sessions in one folder, one on each model: only the one on the strong model is priced again.
  const both = [...session('made-up-dear-input', '/work/both'), ...session('claude-opus-5-5', '/work/both')]
  near(only(proposals(both), 'project-model')[0].saving, 2 * 0.0152)
})

test('a lower effort is compared with the median of the calls at the nearest lower effort that has 200 calls, on the same model', () => {
  const reads = (effort, out, n, model) => many(n, { tools: ['Read'], effort, out, model })
  const records = mainSession([
    // 200 calls at medium. In order of size the two in the middle wrote 100 and 300 tokens: the
    // median is 200. The mean is 540, the smallest 100 and the largest 2,000.
    ...reads('medium', 100, 100), ...reads('medium', 300, 60), ...reads('medium', 2000, 40),
    // 200 calls at high, with a median of 1,000 (between 800 and 1,200), and a mean of 1,760.
    ...reads('high', 800, 100), ...reads('high', 1200, 60), ...reads('high', 5000, 40),
    // 20 calls at xhigh. Both high and medium have 200 calls. The nearest lower one is high.
    ...reads('xhigh', 3000, 20),
    // Another model wrote very little at medium. Its calls are not what Opus 5.5 is compared with.
    ...reads('medium', 10, 200, 'claude-sonnet-5-5'),
  ])
  const [found] = only(proposals(records), 'effort-lower')
  // At high: what each call wrote above 200. At xhigh: what each call wrote above 1,000. At $20 per million.
  const aboveMedium = 100 * (800 - 200) + 60 * (1200 - 200) + 40 * (5000 - 200)
  const aboveHigh = 20 * (3000 - 1000)
  near(found.saving, ((aboveMedium + aboveHigh) * 20) / 1e6)
  assert.equal(found.args, '--level medium')
  assert.match(found.evidence, /^220 calls read, searched or ran commands at effort high or above\. Their output, which includes thinking, cost \$8\.24\./)
  assert.match(found.evidence, /The largest part: opus-5-5, reading and searching, with a median of 1,000 output tokens per call at high and 200 at medium\.$/)

  // With an odd number of calls the median is the one in the middle: 300 here, the 101st of 201.
  const odd = mainSession([...reads('medium', 100, 100), ...reads('medium', 300, 61), ...reads('medium', 2000, 40), ...reads('high', 1000, 10)])
  const [oddFound] = only(proposals(odd), 'effort-lower')
  near(oddFound.saving, (10 * (1000 - 300) * 20) / 1e6)
  assert.match(oddFound.evidence, /with a median of 1,000 output tokens per call at high and 300 at medium\./)
})

test('the calls of Codex are left out of the proposal for a lower effort, also when they wrote more at high effort', () => {
  // 250 commands at medium that wrote 100 tokens each, and 50 at high that wrote 5,000 each.
  const turns = Array.from({ length: 300 }, (_, i) => ({ tools: [['function_call', 'shell']], effort: i < 250 ? 'medium' : 'high', out: i < 250 ? 100 : 5000 }))
  const fromCodex = codex(turns)
  assert.deepEqual(fromCodex.slice(-1).map((r) => [r.s, r.ef, r.out, kindOf(r)]), [['codex', 'high', 5000, 'running commands']])
  assert.deepEqual(only(proposals(fromCodex), 'effort-lower'), [])
  // The same calls as calls of Claude Code get the proposal, with an amount.
  const asClaude = fromCodex.map((r) => ({ ...r, s: 'claude' }))
  const [found] = only(proposals(asClaude), 'effort-lower')
  near(found.saving, (50 * 4900 * 50) / 1e6) // The output of that model costs $50 per million.
})

test('a folder gets the proposal for a cheaper model only when 80% of its main sessions are short', () => {
  const short = (cwd) => mainSession([call({ tools: ['Read'], cwd }), call({ cwd })])
  const long = (cwd) => mainSession(many(21, { tools: ['Read'], cwd }))
  const folders = (records) => only(proposals(records), 'project-model').map((x) => x.folder)
  // Each folder alone, so that its short sessions are well above 1% of the total.
  // Half of the sessions are short, and 3 of 4: not enough.
  assert.deepEqual(folders([...short('/work/half'), ...long('/work/half')]), [])
  assert.deepEqual(folders([...short('/work/most'), ...short('/work/most'), ...short('/work/most'), ...long('/work/most')]), [])
  // 4 of 5 are short: enough. Only the short sessions are priced again.
  const enough = [...short('/work/enough'), ...short('/work/enough'), ...short('/work/enough'), ...short('/work/enough'), ...long('/work/enough')]
  const [found] = only(proposals(enough), 'project-model')
  assert.equal(found.folder, '/work/enough')
  near(found.saving, costOf(enough.slice(0, 8)) / 2)
  assert.match(found.evidence, /^In \/work\/enough, 4 of 5 main sessions had 20 calls or fewer\./)
})

test('apply subagent-model --kind takes only a name, not a path to a file outside the folder of the subagents', () => {
  const agents = join(process.env.CLAUDE_CONFIG_DIR, 'agents')
  mkdirSync(join(agents, 'deep'), { recursive: true })
  // Files with front matter where a path in the name would point: one folder up, and one folder down.
  const outside = '---\nname: settings\nmodel: opus\n---\nA file that is not a subagent.\n'
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.md'), outside)
  writeFileSync(join(agents, 'deep', 'inner.md'), outside)
  const before = useSettings({ theme: 'dark' })
  for (const kind of ['../settings', 'deep/inner', './deep/inner']) {
    assert.throws(() => applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', kind]), /has no file of its own in .*, and a built-in kind cannot be changed on its own/, kind)
  }
  assert.equal(readFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.md'), 'utf8'), outside)
  assert.equal(readFileSync(join(agents, 'deep', 'inner.md'), 'utf8'), outside)
  assert.equal(settingsText(), before)
  assert.equal(appliedActions()['subagent-model'], undefined)
})

test('the marker of an interrupt counts when it is the whole text of a message, as plain text or as a text block', () => {
  const records = claude([
    call(),
    typed('[Request interrupted by user]'), call(),
    typed('[Request interrupted by user for tool use]'), call(),
    interrupt(), call(),
    // The marker inside a longer message is not an interrupt.
    typed('see [Request interrupted by user]'), call(),
    typed('[Request interrupted by user] and more'), call(),
  ])
  assert.deepEqual(records.map((r) => r.intr), [undefined, 1, 1, 1, undefined, undefined])
  assert.equal(measured(records).interrupts, 500) // 3 interrupts in 6 calls.
})

test('the measures count every failed tool result, also several before one call', () => {
  const two = call({ tools: ['Bash', 'Read'] })
  const three = call({ tools: ['Bash', 'Grep', 'Read'] })
  // Two results fail before the second call, three before the third, none before the fourth.
  const records = mainSession([two, results(two, true), three, results(three, true), call(), call()])
  assert.deepEqual(records.map((r) => r.err), [undefined, 2, 3, undefined])
  assert.equal(measured(records).errors, 1250) // 5 failed results in 4 calls, not 2 calls with a failure.
})

test('the measure report leaves out calls without a price, and a call at the very time of the change counts as after', () => {
  const calls = (text) => /^Calls {2,}(\d+) {2,}(\d+)$/m.exec(text).slice(1).map(Number)
  const day = 86400e3
  // 3 priced calls and 2 without a price before the change, 4 and 5 after it.
  const priced = (ts) => ({ tools: ['Read'], ts })
  const unpriced = (ts) => ({ tools: ['Read'], ts, model: 'some-new-model' })
  const records = mainSession([...many(3, priced(AT - day)), ...many(2, unpriced(AT - day)), ...many(4, priced(AT + day)), ...many(5, unpriced(AT + day))])
  const text = measureReport(records, { id: 'model-switch-cost', at: AT })
  assert.deepEqual(calls(text), [3, 4])
  // The cost per 1,000 calls is that of the priced calls alone: a made-up call of this kind costs $0.0304.
  assert.match(text, /^Cost, per 1,000 calls {2,}\$30\.40 {2,}\$30\.40$/m)
  assert.match(text, /^Cost, per session {2,}\$0\.09 {2,}\$0\.12$/m)

  // One millisecond before the change is before. The time of the change itself, and after it, is after.
  const edge = mainSession([call(priced(AT - 1)), call(priced(AT)), call(priced(AT + 1))])
  assert.deepEqual(calls(measureReport(edge, { id: 'model-switch-cost', at: AT })), [1, 2])
  const sub = subagent('researcher', [call(priced(AT - 1)), call(priced(AT)), call(priced(AT + 1))])
  assert.deepEqual(calls(measureReport(sub, { id: 'subagent-model', at: AT })), [1, 2])
  const m = measureCache(sub, AT)
  assert.deepEqual([m.before.calls, m.after.calls], [1, 2])
})

test('a subagent log is parsed again when the meta file next to it appears or changes, and only then', async () => {
  const sub = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'meta-repo', 'k1', 'subagents')
  mkdirSync(sub, { recursive: true })
  const log = join(sub, 'agent-kind.jsonl')
  const meta = join(sub, 'agent-kind.meta.json')
  writeFileSync(log, `${call({ tools: ['Read'] })}\n`)
  const kinds = async () => (await load({ since: 0 })).records.filter((r) => r.agent === 'agent-kind').map((r) => r.at)
  const fixed = new Date(START)
  // No meta file when the log is parsed first: no kind.
  assert.deepEqual(await kinds(), [undefined])
  // The meta file appears later. The log itself stays as it is.
  writeFileSync(meta, JSON.stringify({ agentType: 'alpha' }))
  utimesSync(meta, fixed, fixed)
  assert.deepEqual(await kinds(), ['alpha'])
  // Another kind in a file of another size, with the same time.
  writeFileSync(meta, JSON.stringify({ agentType: 'omega-2' }))
  utimesSync(meta, fixed, fixed)
  assert.deepEqual(await kinds(), ['omega-2'])
  // Another kind in a file of the same size, with another time.
  writeFileSync(meta, JSON.stringify({ agentType: 'gamma-3' }))
  utimesSync(meta, new Date(START + 1000), new Date(START + 1000))
  assert.deepEqual(await kinds(), ['gamma-3'])

  // Nothing changed: the calls come from the cache. To see that, the kind is changed in the cache file.
  const cacheFile = join(process.env.WIDAL_HOME, 'cache', `${createHash('sha1').update(log).digest('hex')}.json`)
  const entry = JSON.parse(readFileSync(cacheFile, 'utf8'))
  assert.deepEqual([entry.metaSize, entry.metaMtimeMs], [JSON.stringify({ agentType: 'gamma-3' }).length, START + 1000])
  writeFileSync(cacheFile, JSON.stringify({ ...entry, records: entry.records.map((r) => ({ ...r, at: 'from the cache' })) }))
  assert.deepEqual(await kinds(), ['from the cache'])
  // The meta file is taken away: the log is parsed again, and has no kind.
  rmSync(meta)
  assert.deepEqual(await kinds(), [undefined])
  // A main session's log has no meta file. One that lies next to it changes nothing.
  const main = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'meta-repo', 'k1.jsonl')
  writeFileSync(main, `${call()}\n`)
  await load({ since: 0 })
  const mainCache = join(process.env.WIDAL_HOME, 'cache', `${createHash('sha1').update(main).digest('hex')}.json`)
  const mainEntry = JSON.parse(readFileSync(mainCache, 'utf8'))
  writeFileSync(mainCache, JSON.stringify({ ...mainEntry, records: mainEntry.records.map((r) => ({ ...r, cwd: '/from/the/cache' })) }))
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'meta-repo', 'k1.meta.json'), JSON.stringify({ agentType: 'alpha' }))
  assert.deepEqual((await load({ since: 0 })).records.filter((r) => r.ses === 'k1' && !r.agent).map((r) => r.cwd), ['/from/the/cache'])
})

test('a table prints no control characters, so a name from a log or a meta file cannot break it', () => {
  // A line break, a colour code, a tab, the delete character, and a cell of control characters only.
  const text = table([['name', 'cost'], ['a\nb', '$1.00'], ['\x1b[31mred\x1b[0m', '$22.00'], ['tab\there\x7f', '$3.00'], ['\x00\x1f\r', 5]], [1])
  assert.deepEqual(text.split('\n'), [
    'name          cost',
    'ab           $1.00',
    '[31mred[0m  $22.00',
    'tabhere      $3.00',
    '                 5',
  ])
  // The same through a report: the kind of a subagent comes from a meta file.
  const records = subagent('Ex\nplore\x1b[2J\x07', many(2, { tools: ['Read'] }))
  assert.equal(records[0].at, 'Ex\nplore\x1b[2J\x07')
  const report = models(records, { days: 30 })
  assert.match(report, /^ {2}Explore\[2J {2,}2 {2,}\$0\.06 {2,}opus-5-5 {2,}100%$/m)
  assert.doesNotMatch(report, /[\x00-\x09\x0b-\x1f\x7f]/) // No control character but the line breaks of the report itself.
  assert.equal(report.split('\n').filter((l) => l.includes('plore')).length, 1)
})

test('a line outside a table prints no control characters either: the kind of a subagent in a proposal, and the model in the note about a missing price', () => {
  // A line break, two escape codes, and the 8 bit code that some terminals read as the start of one.
  const kind = 'evil\x1b[31mRED\nNEWLINE;$(id)'
  const strange = 'weird\x1b[41mmodel\nline2\x9b0m'
  const records = [
    // Four of five calls of the same cost read, on a strong model: the kind gets a proposal.
    ...subagent(kind, [...many(4, { tools: ['Read'] }), call({ tools: ['Bash'] })]),
    // One call on a model that has no price.
    ...mainSession([call({ tools: ['Edit'] }), call({ model: strange })]),
  ]
  assert.equal(records[0].at, kind)
  assert.equal(records.at(-1).m, strange)
  // No control character but the line breaks of the report itself.
  const control = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/
  const shown = '"evil\\[31mREDNEWLINE;\\$\\(id\\)"'

  const advice = adviseReport(records, { days: 30, ownFile: () => undefined })
  assert.match(advice, new RegExp(`^\\d\\. Run the ${shown} subagents on a cheaper model: \\$0\\.08 less, \\d+% of the total$`, 'm'))
  assert.match(advice, new RegExp(`^ {3}Why: {2}80% of what the ${shown} subagents cost is reading and searching: `, 'm'))
  assert.match(advice, new RegExp(`^ {3}How: {2}${shown} has no file of its own, so it cannot be changed alone\\. `, 'm'))
  assert.doesNotMatch(advice, control)
  // The name adds no line: it stands in the title, the Why line and the How line of its proposal.
  assert.equal(advice.split('\n').filter((l) => l.includes('NEWLINE')).length, 3)
  // The same when the kind has a file of its own, whose path holds the name.
  const withFile = adviseReport(records, { days: 30, ownFile: (k) => `/claude/agents/${k}.md` })
  assert.match(withFile, /^ {3}How: {2}One line in the file of that subagent \(\/claude\/agents\/evil\[31mREDNEWLINE;\$\(id\)\.md\): "model: claude-sonnet-5-5"\./m)
  assert.match(withFile, /^ {3}Apply: by hand\. The name of this kind has other characters than letters, digits, "\.", "_" and "-", so no command is printed for it\.$/m)
  assert.doesNotMatch(withFile, control)

  // The note about a model without a price is a plain line of three reports.
  for (const report of [summary(records, { days: 30 }), models(records, { days: 30 }), sessionReport(records, {})]) {
    assert.match(report, /^No price is known for weird\[41mmodelline20m: 1 calls, 51k tokens, not in the dollar figures\.$/m)
    assert.doesNotMatch(report, control)
    assert.equal(report.split('\n').some((l) => l.startsWith('line2')), false)
  }
})

test('the plain lines of the findings, the session, the branch and the live report print no control characters: a folder, a tool, a session and a model from a log', () => {
  // An escape code that sets the title of the terminal, colour codes, a line break, and the 8 bit start of an escape code.
  const folder = '/a/\x1b[31mRED\x1b]0;PWN\x07/proj'
  const tool = 'Fetch\x1b[31mRED\nnext'
  const ses = 'ab\x1b[5mcd'
  const strange = 'odd\x9b31mmodel'
  /** A line of a log with other values: `change` gets the line as an object. */
  const edit = (line, change) => {
    const d = JSON.parse(line)
    change(d)
    return JSON.stringify(d)
  }
  // The same tool call four times, each with a result that enters the context, which grows by 3,000 tokens per call.
  const lines = []
  for (let i = 0; i < 4; i++) {
    const asked = edit(call({ tools: [tool], input: { same: 'input' }, cwd: folder }), (d) => {
      d.gitBranch = 'main'
      d.message.usage.cache_read_input_tokens = 50000 + 3000 * i
    })
    lines.push(asked, results(asked))
  }
  // Then a call that reads nothing from the cache and writes the whole context again: a lost cache.
  lines.push(edit(call({ cwd: folder }), (d) => {
    d.gitBranch = 'main'
    d.message.usage = { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 70000, output_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 70000, ephemeral_1h_input_tokens: 0 } }
  }))
  lines.push(edit(call({ cwd: folder, model: strange }), (d) => (d.gitBranch = 'main')))
  const records = [
    ...claude(lines, `/logs/${ses}.jsonl`),
    // The same branch in a second folder, for the line of the branch report that names the folders.
    ...mainSession([edit(call({ cwd: '/b/\x1b[1mother' }), (d) => (d.gitBranch = 'main'))]),
  ]
  assert.deepEqual([records[0].cwd, records[0].tools[0][0], records[0].ses, records[5].m], [folder, tool, ses, strange])
  // No control character but the line breaks of the report itself.
  const control = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/

  const found = findings(records, { days: 7 })
  assert.match(found, /^ {3}Largest:\n {5}\d{4}-\d\d-\d\d \d\d:\d\d \[31mRED\]0;PWN\/proj \$0\.\d\d \(70k tokens\)$/m)
  assert.match(found, /^ {3}Fetch\[31mREDnext: 4 results, 16k tokens, \$0\.08 with carrying\. Largest single result 10k tokens\.$/m)
  assert.match(found, /^ {3}Fetch\[31mREDnext ran 4 times with a repeated input \(1 input, each 4 times or more\) in \[31mRED\]0;PWN\/proj, about \$0\.\d\d\. Likely cause: a loop, or a check that is repeated on purpose\.$/m)
  assert.doesNotMatch(found, control)
  // The name of the tool adds no line.
  assert.equal(found.split('\n').some((l) => l.startsWith('next')), false)

  const one = sessionReport(records, { id: ses })
  assert.equal(one.split('\n')[0], 'Session ab[5mcd  [31mRED]0;PWN/proj  (Claude Code)')
  assert.match(one, /^No price is known for odd31mmodel: 1 calls, /m)
  assert.doesNotMatch(one, control)

  const onBranch = branch(records, { days: 7, name: 'main' })
  assert.match(onBranch, /^Folders {2}\[31mRED\]0;PWN\/proj \$0\.\d\d, b\/\[1mother \$0\.\d\d\. A branch with the same name in another repository is counted together with this one\.$/m)
  assert.doesNotMatch(onBranch, control)
  // The name of a branch is printed as it was typed, without them too.
  assert.equal(branch(records, { days: 7, name: 'gone\x1b[2J\n' }), 'No model calls on the branch "gone[2J" in the last 7 days. See: widal branches')

  // "widal live" prints the cells of a call without a table.
  const cells = analyze(records).calls.map(callLine)
  assert.deepEqual(cells[1].slice(1), ['opus-5-5', '53k', '+3.0k', '100%', '1.0k', '$0.03', 'Fetch[31mREDnext'])
  assert.equal(cells.at(-2)[1], 'odd31mmodel')
  for (const row of cells) assert.doesNotMatch(row.join('  '), control)
})

test('a log line with a value of the wrong type does not break a report: the line is skipped, the name is left out, or the count is 0', () => {
  /** A line of Claude Code's log with other values: `change` gets the line as an object. */
  const odd = (change, options) => {
    const d = JSON.parse(call(options))
    change(d)
    return JSON.stringify(d)
  }
  const fine = { input_tokens: 100, cache_read_input_tokens: 50000, output_tokens: 1000 }
  const records = claude([
    // A folder and a branch that are not text: the call is kept, without them.
    odd((d) => Object.assign(d, { cwd: { not: 'text' }, gitBranch: ['main'] })),
    // A model or an id that is not text, and a usage that is not an object: no model call in the shape that is known.
    odd((d) => (d.message.model = 5)),
    odd((d) => (d.message.id = { not: 'text' })),
    odd((d) => (d.message.usage = 'a lot')),
    // A tool whose name is not text is no tool call. The tool next to it stays, and so does the call.
    odd((d) => (d.message.content[0].name = { not: 'text' }), { tools: ['Bash', 'Read'] }),
    // The result of that tool counts as the result of an unknown tool, and text that is not text as nothing.
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown', content: 'made-up output' }, { type: 'text', text: 12345 }] } }),
    // Counts that are text, nothing or a list are 0.
    odd((d) => (d.message.usage = { input_tokens: 'abc', cache_read_input_tokens: null, output_tokens: '7', cache_creation_input_tokens: [5], server_tool_use: { web_search_requests: 'two' }, output_tokens_details: { thinking_tokens: {} }, speed: 5 })),
    odd((d) => (d.message.usage = { ...fine, cache_creation: 'none', cache_creation_input_tokens: 400 })),
    // Lines that are not JSON, or JSON that is not an object.
    '"type":"assistant"', '[{"type":"assistant"}]', 'null "type":"user"',
    call({ cwd: '/work/later' }),
  ], '/logs/odd.jsonl')
  assert.deepEqual(records.map((r) => [r.cwd, r.br, r.m, r.tools.map((t) => t[0]), r.in, r.cr, r.w5, r.w1, r.out, r.th, r.web, r.sp, r.add]), [
    [undefined, undefined, 'claude-opus-5-5', [], 100, 50000, 0, 0, 1000, 0, 0, undefined, []],
    ['/work/repo', undefined, 'claude-opus-5-5', ['Read'], 100, 50000, 0, 0, 1000, 0, 0, undefined, []],
    ['/work/repo', undefined, 'claude-opus-5-5', [], 0, 0, 0, 0, 0, 0, 0, undefined, [['(unknown tool)', 14]]],
    ['/work/repo', undefined, 'claude-opus-5-5', [], 100, 50000, 400, 0, 1000, 0, 0, undefined, []],
    ['/work/later', undefined, 'claude-opus-5-5', [], 100, 50000, 0, 0, 1000, 0, 0, undefined, []],
  ])

  // Codex: a model, a folder, a session, a branch and a tool that are not text, and counts that are not numbers.
  const p = new CodexParser('/codex/rollout-odd.jsonl')
  for (const l of [
    { type: 'session_meta', payload: { session_id: { not: 'text' }, cwd: ['/work/app'], git: { branch: 7 } } },
    { type: 'turn_context', payload: { model: 5, cwd: 6 } },
    { type: 'response_item', payload: { type: 'function_call', name: { not: 'text' }, arguments: '{}', call_id: 'k1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'k1', output: 'made-up output' } },
    { type: 'token_usage_record', timestamp: new Date(START).toISOString(), payload: { response_id: 9, usage: { input_tokens: 'abc', cached_input_tokens: null, output_tokens: [500], reasoning_output_tokens: '100' } } },
    { type: 'token_usage_record', timestamp: new Date(START).toISOString(), payload: { response_id: 'r-odd', usage: 'a lot' } },
    { type: 'turn_context', payload: { model: 'gpt-6-astra', cwd: '/work/app' } },
    { type: 'token_usage_record', timestamp: new Date(START + 10e3).toISOString(), payload: { response_id: 'r-fine', usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 500 } } },
    'not an object', null,
  ]) p.feed(JSON.stringify(l))
  const fromCodex = p.result().records
  assert.deepEqual(fromCodex.map((r) => [r.ses, r.cwd, r.br, r.m, r.id, r.tools, r.in, r.cr, r.out, r.th, r.add]), [
    ['rollout-odd', undefined, undefined, undefined, 'rollout-odd:0', [], 0, 0, 0, 0, [['(unknown tool)', 14]]],
    ['rollout-odd', '/work/app', undefined, 'gpt-6-astra', 'r-fine', [], 600, 400, 500, 0, []],
  ])

  // Every report runs on these calls, and none prints a value that is not a number or not text.
  const all = [...records, ...fromCodex]
  const reports = [
    summary(all, { days: 30 }), models(all, { days: 30 }), findings(all, { days: 7 }), sessionReport(all, { id: 'odd' }), sessionReport(all, { id: 'rollout-odd' }),
    branches(all, { days: 7 }), callsReport(all, { id: 'odd', n: 30 }), callsReport(all, { id: 'rollout-odd', n: 30 }), adviseReport(all, { days: 30, ownFile: () => undefined }),
    measureReport(all, { id: 'effort-default', at: START }),
  ]
  for (const report of reports) assert.doesNotMatch(report, /NaN|\[object Object\]|undefined/)
  assert.match(reports[0], /^ {2}\(unknown folder\) {2,}\$0\.\d\d {2,}\d+% {2,}2 calls$/m)
})

test('a change to Claude Code is proposed and measured from the calls of Claude Code only, not of Codex or Cowork', () => {
  // The calls of a made-up log as if Cowork had made them. Cowork's log names no kind of subagent.
  const asCowork = (records) => records.map((r) => ({ ...r, s: 'cowork', id: `cowork-${r.id}`, at: undefined }))
  const ownFile = () => undefined
  const ids = (records) => proposals(records, { ownFile }).list.map((x) => x.id)

  // Subagents that read on Claude Opus 5.5: Claude Code's get the two proposals for a cheaper model.
  const readers = subagent(undefined, many(5, { tools: ['Read'] }))
  assert.deepEqual(ids(readers).filter((id) => id.startsWith('subagent-model')), ['subagent-model', 'subagent-model-by-kind'])
  assert.deepEqual(ids(asCowork(readers)).filter((id) => id.startsWith('subagent-model')), [])
  // A subagent that waits 10 minutes and loses its 5 minute cache: the proposal for a 1 hour cache.
  const line = (id, ts, w5) => JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), cwd: '/work/repo', message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [], usage: { input_tokens: 10, cache_creation_input_tokens: w5, cache_read_input_tokens: 0, output_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: 0 } } } })
  const waiting = claude([line('only-1', AT, 100000), line('only-2', AT + 600e3, 100400)], '/logs/only/subagents/agent-1.jsonl')
  assert.ok(ids(waiting).includes('subagent-cache-1h'))
  assert.equal(ids(asCowork(waiting)).includes('subagent-cache-1h'), false)
  assert.deepEqual([measureCache(waiting, AT).after.calls, measureCache(asCowork(waiting), AT).after.calls], [2, 0])
  // Reading at high effort, with 200 calls at medium to compare with: the proposal for a lower effort.
  const effort = mainSession([...many(200, { tools: ['Read'], effort: 'medium', out: 300 }), ...many(50, { tools: ['Read'], effort: 'high', out: 1000 })])
  assert.ok(ids(effort).includes('effort-lower'))
  assert.equal(ids(asCowork(effort)).includes('effort-lower'), false)
  // A short session that reads: the proposal for a cheaper model in new sessions of its folder.
  const short = mainSession([call({ tools: ['Read'], cwd: '/work/only' }), call({ cwd: '/work/only' })])
  assert.ok(ids(short).includes('project-model'))
  assert.equal(ids(asCowork(short)).includes('project-model'), false)

  // The measures. Claude Code: 3 main session calls and 2 subagent calls before the change, 4 and 1 after it.
  const day = 86400e3
  const at = (ts) => ({ tools: ['Read'], ts })
  const mine = [
    ...mainSession([...many(3, at(AT - day)), ...many(4, at(AT + day))], 'only-main'),
    ...subagent('researcher', [...many(2, at(AT - day)), call(at(AT + day))], 'only-main'),
  ]
  // Cowork made as many calls again, and Codex 2 before and 1 after.
  const others = [...asCowork(mine), ...codex([{ ts: AT - day }, { ts: AT - day + 1e3 }, { ts: AT + day }])]
  const calls = (text) => /^Calls {2,}(\d+) {2,}(\d+)$/m.exec(text).slice(1).map(Number)
  const report = (id, records) => measureReport(records, { id, at: AT })
  for (const [id, counted] of [['effort-default', [3, 4]], ['subagent-model', [2, 1]], ['subagent-cache-1h', [2, 1]]]) {
    assert.deepEqual(calls(report(id, [...mine, ...others])), counted, id)
    assert.equal(report(id, [...mine, ...others]), report(id, mine), id)
    // With no calls of Claude Code there is nothing to measure, and Codex is not named as missing.
    assert.deepEqual(calls(report(id, others)), [0, 0], id)
    assert.doesNotMatch(report(id, others), /Codex/, id)
  }
  assert.match(report('subagent-cache-1h', [...mine, ...others]), /^Subagent calls {2,}2 {2,}1$/m)
  // A change that is measured on all calls still counts all of them.
  assert.deepEqual(calls(report('model-switch-cost', [...mine, ...others])), [12, 11])
})

test('undo of subagent-model goes on when one subagent file has lost its front matter, and names the file it did not put back', () => {
  const agents = join(process.env.CLAUDE_CONFIG_DIR, 'agents')
  mkdirSync(agents, { recursive: true })
  const file = (name) => join(agents, `${name}.md`)
  const text = (name) => readFileSync(file(name), 'utf8')
  const first = '---\nname: first\nmodel: opus\n---\nYou go first.\n'
  const second = '---\nname: second\n---\nYou go second.\n'
  const third = '---\nname: third\nmodel: haiku\n---\nYou go third.\n'
  const write = () => {
    writeFileSync(file('first'), first)
    writeFileSync(file('second'), second)
    writeFileSync(file('third'), third)
  }
  write()
  const before = useSettings({ theme: 'dark' })
  const applyAll = () => {
    applyAction('subagent-model', BIN, APPLIED_AT)
    for (const kind of ['first', 'second', 'third']) applyAction('subagent-model', BIN, APPLIED_AT, ['--kind', kind])
  }
  applyAll()
  assert.equal(text('second'), '---\nname: second\nmodel: claude-sonnet-5-5\n---\nYou go second.\n')
  // The person takes the front matter out of the second file. Undo puts the changes back in
  // reverse order, so this file comes after the third and before the first and the settings.
  const byHand = 'You go second, without front matter.\n'
  writeFileSync(file('second'), byHand)
  assert.deepEqual(undoAction('subagent-model', BIN), [
    'subagent-model is taken back, except for one file.',
    `${file('second')} was not put back, because it has no front matter any more (it had no "model:" line before the change).`,
  ])
  assert.equal(text('first'), first)
  assert.equal(text('third'), third)
  assert.equal(text('second'), byHand)
  assert.equal(settingsText(), before)
  assert.deepEqual(appliedActions(), {})

  // Two files without front matter: each gets its sentence, with the line it had before.
  write()
  applyAll()
  writeFileSync(file('first'), 'No front matter.\n')
  writeFileSync(file('third'), 'No front matter either.\n')
  assert.deepEqual(undoAction('subagent-model', BIN), [
    'subagent-model is taken back, except for 2 files.',
    `${file('third')} was not put back, because it has no front matter any more (its line before the change: "model: haiku").`,
    `${file('first')} was not put back, because it has no front matter any more (its line before the change: "model: opus").`,
  ])
  assert.equal(text('second'), second)
  assert.equal(settingsText(), before)
  assert.deepEqual(appliedActions(), {})
})

test('a replay on a cheaper model leaves the fee for web searches as it is', () => {
  // Each call made 3 web searches itself: $0.03 of fees on top of $0.0304 for its tokens.
  const researcher = subagent('researcher', many(5, { tools: ['WebSearch'], web: 3 }))
  near(costOf(researcher), 5 * (0.0304 + 0.03))
  const p = proposals(researcher, { ownFile: () => undefined })
  // Only the tokens cost half at Sonnet 5.5 prices. The fees are the same on every model.
  near(only(p, 'subagent-model')[0].saving, 5 * 0.0152)
  near(only(p, 'subagent-model-by-kind')[0].saving, 5 * 0.0152)
  assert.match(only(p, 'subagent-model')[0].evidence, /They cost \$0\.30\. The same tokens at Sonnet 5\.5 prices cost \$0\.23\.$/)
  assert.match(only(p, 'subagent-model-by-kind')[0].evidence, /They cost \$0\.30\. The same tokens at Sonnet 5\.5 prices cost \$0\.23\.$/)
  // The same for a folder of short sessions.
  const session = mainSession([call({ tools: ['WebSearch'], web: 2, cwd: '/work/web' })])
  near(costOf(session), 0.0304 + 0.02)
  const [folder] = only(proposals(session), 'project-model')
  near(folder.saving, 0.0152)
  assert.match(folder.evidence, /cost \$0\.05\. The same tokens at Sonnet 5\.5 prices cost \$0\.04\.$/)
})

test('a kind of subagent gets a command to apply only when its name is letters, digits, ".", "_" and "-"', () => {
  const ownFile = (kind) => `/claude/agents/${kind}.md`
  const report = (kind) => adviseReport(subagent(kind, many(5, { tools: ['Read'] })), { days: 30, ownFile })
  const applyLine = (text, title) => new RegExp(`^\\d\\. ${title}: .*\\n.*\\n.*\\n.*\\n {3}(.*)$`, 'm').exec(text)[1]
  for (const kind of ['researcher', 'code.review_2-B', '-x', '9']) {
    assert.equal(applyLine(report(kind), `Run the "${kind}" subagents on a cheaper model`), `Apply: widal apply subagent-model --kind ${kind}`, kind)
  }
  for (const kind of ['my agent', 'a;b', '$(id)', '`id`', 'a"b', "it's", 'a|b', 'a&b', 'a>b', 'café', 'a\\b', '~x', 'a*']) {
    const text = report(kind)
    const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.equal(applyLine(text, `Run the "${escaped}" subagents on a cheaper model`), 'Apply: by hand. The name of this kind has other characters than letters, digits, ".", "_" and "-", so no command is printed for it.', kind)
    // No command in the report holds the name. The file to change by hand is still named.
    assert.doesNotMatch(text, /--kind/, kind)
    assert.ok(text.includes(`How:  One line in the file of that subagent (/claude/agents/${kind}.md): "model: claude-sonnet-5-5".`), kind)
  }
  // The proposal itself says the same: no arguments for a command.
  const [odd] = only(proposals(subagent('my agent', many(5, { tools: ['Read'] })), { ownFile }), 'subagent-model-by-kind')
  assert.deepEqual([odd.apply, odd.args], [false, undefined])
  const [plain] = only(proposals(subagent('researcher', many(5, { tools: ['Read'] })), { ownFile }), 'subagent-model-by-kind')
  assert.deepEqual([plain.apply, plain.args, plain.byHand], [true, '--kind researcher', undefined])
})

test('measure subagent-model counts the calls of the kinds that were changed, and all subagent calls when all were changed', () => {
  const day = 86400e3
  const at = (ts) => ({ tools: ['Read'], ts })
  const records = [
    ...subagent('researcher', [...many(2, at(AT - day)), call(at(AT + day))], 'kinds-1'),
    ...subagent('builder', [...many(4, at(AT - day)), ...many(3, at(AT + day))], 'kinds-1'),
    ...subagent(undefined, [call(at(AT - day)), call(at(AT + day))], 'kinds-1'),
    ...mainSession([...many(5, at(AT - day)), ...many(5, at(AT + day))], 'kinds-1'),
  ]
  const report = (changes) => measureReport(records, { id: 'subagent-model', at: AT, before: changes && { changes } })
  const seen = (changes) => {
    const text = report(changes)
    return [text.split('\n')[0], ...(/^Calls {2,}(\d+) {2,}(\d+)$/m.exec(text).slice(1).map(Number))]
  }
  const head = (label) => `subagent-model, applied on ${when(AT)}. ${label} before and after.`
  const one = { kind: 'researcher', old: undefined, model: 'claude-sonnet-5-5' }
  const two = { kind: 'builder', old: 'model: opus', model: 'claude-sonnet-5-5' }
  const all = { kind: undefined, old: undefined, model: 'claude-sonnet-5-5' }
  assert.deepEqual(seen([one]), [head('Calls of the "researcher" subagents'), 2, 1])
  assert.deepEqual(seen([two]), [head('Calls of the "builder" subagents'), 4, 3])
  assert.deepEqual(seen([one, two]), [head('Calls of the "researcher" and "builder" subagents'), 6, 4])
  assert.deepEqual(seen([one, two, { ...one, kind: 'none-yet' }]), [head('Calls of the "researcher", "builder" and "none-yet" subagents'), 6, 4])
  // A change for all subagents, alone or next to single kinds: all subagent calls.
  assert.deepEqual(seen([all]), [head('Subagent calls'), 7, 5])
  assert.deepEqual(seen([one, all]), [head('Subagent calls'), 7, 5])
  // Nothing is kept about what was changed: all subagent calls, as before.
  assert.deepEqual(seen(undefined), [head('Subagent calls'), 7, 5])
  assert.deepEqual(seen([]), [head('Subagent calls'), 7, 5])
  // The kinds only count for this change: another one is measured as before.
  assert.deepEqual(/^Calls {2,}(\d+) {2,}(\d+)$/m.exec(measureReport(records, { id: 'effort-default', at: AT, before: { changes: [one] } })).slice(1), ['5', '5'])
})

test('the measure command gives the report what the change found before, so that it knows the changed kinds', () => {
  const { env, run } = command('measure-kinds')
  const sub = join(env.CLAUDE_CONFIG_DIR, 'projects', 'work-repo', 's1', 'subagents')
  mkdirSync(sub, { recursive: true })
  mkdirSync(env.WIDAL_HOME, { recursive: true })
  const at = (ts) => ({ tools: ['Read'], ts })
  const log = (name, kind, lines) => {
    writeFileSync(join(sub, `${name}.jsonl`), `${lines.join('\n')}\n`)
    writeFileSync(join(sub, `${name}.meta.json`), JSON.stringify({ agentType: kind }))
  }
  log('agent-1', 'researcher', [...many(2, at(AT - 86400e3)), call(at(AT + 3600e3))])
  log('agent-2', 'builder', [...many(4, at(AT - 86400e3)), ...many(3, at(AT + 3600e3))])
  const state = (changes) => writeFileSync(join(env.WIDAL_HOME, 'actions.json'), JSON.stringify({ 'subagent-model': { at: AT, before: { changes } } }))
  state([{ kind: 'researcher', model: 'claude-sonnet-5-5' }])
  const one = run('measure', 'subagent-model').stdout
  assert.equal(one.split('\n')[0], `subagent-model, applied on ${when(AT)}. Calls of the "researcher" subagents before and after.`)
  assert.match(one, /^Calls {2,}2 {2,}1$/m)
  state([{ model: 'claude-sonnet-5-5' }])
  const all = run('measure', 'subagent-model').stdout
  assert.equal(all.split('\n')[0], `subagent-model, applied on ${when(AT)}. Subagent calls before and after.`)
  assert.match(all, /^Calls {2,}6 {2,}4$/m)
})
