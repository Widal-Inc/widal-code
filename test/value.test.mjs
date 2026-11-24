// Tests for what the dollars of the reports are (spend by the token, API value on a subscription),
// the block of plans, the share of a weekly limit, and the findings: the programs of shell
// commands, repeated tool calls grouped per session and tool, and the command that fixes each
// finding with the replay's saving. With small made-up session logs. Run: node --test
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-value-test-'))
// Every folder the tool reads or writes is a made-up one, before any module of the tool is loaded.
process.env.HOME = join(dir, 'person')
// The link that Claude Code's settings call, in the tool's folder in the made-up home folder.
const OWN = join(process.env.HOME, '.widal', 'bin', 'widal')
process.env.WIDAL_HOME = join(dir, 'home')
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
process.env.WIDAL_COWORK_DIR = join(dir, 'cowork')
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
mkdirSync(process.env.WIDAL_HOME, { recursive: true })
// A variable of the person who runs the tests would change what "apply bash-output-cap" says.
delete process.env.BASH_MAX_OUTPUT_LENGTH

const { ClaudeParser } = await import('../src/parse-claude.mjs')
const { analyze, repeatedByTool } = await import('../src/analyze.mjs')
const { proposals } = await import('../src/advise.mjs')
const { apply, undo, applied } = await import('../src/actions.mjs')
const { money } = await import('../src/format.mjs')
const { findings, session, summary } = await import('../src/report.mjs')
const { programOf } = await import('../src/program.mjs')

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`)
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0)
const START = Date.parse('2026-11-12T10:00:00Z')
const DAY = 86400e3
const ACCOUNT = 'aaaaaaaa-1111-4111-8111-111111111111'
let made = 0
let logs = 0

/**
 * The lines of one made-up Claude Code log. Each step is a model call that asks for `tools`, a list
 * of [name, input, size of the result]. The results come after the call. The context grows by
 * 3,000 tokens per call, so that what entered has a size. `gap` puts the call that many
 * milliseconds after the one before (10 seconds without it). `lost` makes the call read nothing
 * from the cache: a lost cache. `compact` puts a compaction before the call.
 */
function logLines(steps, { owner = true, cwd = '/work/shop-web', model = 'claude-opus-5-5', from = START, sub = false } = {}) {
  const lines = owner ? [JSON.stringify({ type: 'session-owner', accountUuid: ACCOUNT, organizationUuid: 'oaoaoaoa-1111-4111-8111-111111111111' })] : []
  let ts = from
  let ctx = 50000
  for (const { tools = [], gap = 10e3, lost = false, compact = false, carried, failed = false } of steps) {
    ts += gap
    if (compact) {
      lines.push(JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(ts - 1000).toISOString(), cwd, compactMetadata: { trigger: 'auto', preTokens: ctx, postTokens: 20000, durationMs: 1000 } }))
      ctx = 20000
    }
    if (carried) ctx = carried
    const id = `v${made++}`
    const write = lost ? ctx : 3000
    const usage = { input_tokens: 10, cache_creation_input_tokens: write, cache_read_input_tokens: lost ? 0 : ctx, output_tokens: 100, cache_creation: sub ? { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 } : { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write } }
    const content = tools.map(([name, input], i) => ({ type: 'tool_use', id: `${id}-${i}`, name, input }))
    lines.push(JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), cwd, message: { id, model, role: 'assistant', content, usage } }))
    if (tools.length) lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: tools.map(([, , size = 4000], i) => ({ type: 'tool_result', tool_use_id: `${id}-${i}`, content: 'x'.repeat(size), ...(failed && { is_error: true }) })) } }))
    ctx += lost ? 0 : 3000
  }
  return lines
}

/** The calls that Claude Code's parser reads from the lines of one log. */
function parse(lines, file = `/logs/value-${logs++}.jsonl`) {
  const p = new ClaudeParser(file)
  for (const l of lines) p.feed(l)
  return p.result().records
}

/** The calls of a made-up log, as `logLines` makes it. */
const records = (steps, options) => parse(logLines(steps, options), options?.file)

/** Writes accounts.json and limits.json of the tool, or takes them away with undefined. */
function files({ accounts, limits } = {}) {
  for (const [name, value] of [['accounts.json', accounts], ['limits.json', limits]]) {
    const file = join(process.env.WIDAL_HOME, name)
    if (value === undefined) rmSync(file, { force: true })
    else writeFileSync(file, JSON.stringify(value))
  }
}

/** The lines of one numbered finding of "widal findings", by the start of its title. */
function finding(text, title) {
  const blocks = text.split('\n\n')
  const block = blocks.find((b) => new RegExp(`^\\d+\\. ${title}`).test(b))
  assert.ok(block, `no finding "${title}" in:\n${text}`)
  return block.split('\n')
}

test('the program of a shell command is the base name of its first word, and nothing else of the command is kept', () => {
  assert.equal(programOf('npm test -- --grep login'), 'npm')
  assert.equal(programOf('/usr/local/bin/git log --oneline'), 'git')
  assert.equal(programOf('   pytest -k login'), 'pytest')
  assert.equal(programOf('"./build.sh" --fast'), 'build.sh')
  assert.equal(programOf('docker-compose up'), 'docker-compose')
  // A change of folder in front of the command is skipped: the program is the next command's first word.
  assert.equal(programOf('cd /work/shop-web && npm test'), 'npm')
  assert.equal(programOf('cd /work/shop-web; pytest -k login'), 'pytest')
  assert.equal(programOf('cd "/work/my shop" && cd src && git status'), 'git')
  assert.equal(programOf('cd /work/shop-web || exit 1'), 'cd')
  assert.equal(programOf('cd /work/shop-web && PGPASSWORD=\'a b\' psql'), '(other)')
  assert.equal(programOf('cd /work/shop-web && AKIAIOSFODNN7EXAMPLE'), '(other)')
  // Words that set a variable come first and are never kept: their value can be a secret.
  assert.equal(programOf('NODE_ENV=test API_TOKEN=abc123 npm run build'), 'npm')
  assert.equal(programOf('API_TOKEN=abc123'), '(other)')
  // A value in quotes can hold spaces, so the word after a space can be a part of it, not the
  // program: such a command gives no name, and no word of the value is kept.
  assert.equal(programOf("PGPASSWORD='correct horse battery' psql -h db"), '(other)')
  assert.equal(programOf('API_KEY="alpha bravo charlie" npm run deploy'), '(other)')
  assert.equal(programOf("GIT_AUTHOR_NAME='Jane Q Doe' git commit"), '(other)')
  assert.equal(programOf('TOKEN="abc" npm test'), '(other)')
  assert.equal(programOf('NAME=Jane\\ Doe git commit'), '(other)')
  assert.equal(programOf('STAMP=$(date +%s) make release'), '(other)')
  assert.equal(programOf('STAMP=`date +%s` make release'), '(other)')
  assert.equal(programOf('"./my script.sh" --fast'), '(other)')
  // A word that looks like a key or a token is not kept.
  for (const secret of ['AKIAIOSFODNN7EXAMPLE', 'ghp_abcdefghij0123456789', 'sk-abc123', 'xoxb-1234-5678', 'deadbeef00112233', 'ABCDEFGH12345678', 'aB3dE5fG7hI9jK1lM3']) assert.equal(programOf(`${secret} --help`), '(other)', secret)
  for (const name of ['x86_64-linux-gnu-gcc', 'google-chrome-stable', 'python3.12', 'terraform', 'kubectl']) assert.equal(programOf(`${name} --version`), name, name)
  // A home folder names a person: its last part is not kept. A program below it is.
  assert.equal(programOf('/Users/someone'), '(other)')
  assert.equal(programOf('/home/someone/ --flag'), '(other)')
  assert.equal(programOf('/Users/someone/bin/deploy.sh now'), 'deploy.sh')
  // A first word with other characters, or longer than 24, gives no name.
  assert.equal(programOf('$(cat token.txt) --flag'), '(other)')
  assert.equal(programOf('a'.repeat(24)), 'a'.repeat(24))
  assert.equal(programOf('a'.repeat(25)), '(other)')
  assert.equal(programOf('..'), '(other)')
  assert.equal(programOf('naïve-tool run'), '(other)')
  for (const none of ['', '   ', undefined, 5, { command: 'x' }]) assert.equal(programOf(none), undefined)
})

test('the results of shell commands are split by program, the most tokens first, and only the program is kept', () => {
  const bash = (command) => ({ tools: [['Bash', { command }, 6000]] })
  const calls = records([
    bash('npm test --grep case-1'), bash('npm test --grep case-2'), bash('npm run lint'),
    bash('git status'), bash('git diff src/app.ts'),
    bash('SECRET_TOKEN=abc123 pytest -k login'),
    {},
  ])
  const added = calls.flatMap((r) => r.add).filter((a) => a[0] === 'Bash')
  assert.deepEqual(added.map((a) => a[3]), ['npm', 'npm', 'npm', 'git', 'git', 'pytest'])
  // Nothing else of a command is in what the parser keeps.
  for (const word of ['abc123', 'SECRET_TOKEN', '--grep', 'case-1', 'lint', 'status', 'src/app.ts', 'login']) assert.ok(!JSON.stringify(calls).includes(word), word)
  const text = findings(calls, { days: 7 })
  assert.match(text, /^ {3}Bash: 6 results, [\d.]+k tokens, \$\d+\.\d\d with carrying\. Largest single result [\d.]+k tokens\.\n {5}By program, the most tokens first:\n {7}npm: 3 results, 8\.7k tokens, \$\d\.\d\d\n {7}git: 2 results, 5\.8k tokens, \$\d\.\d\d\n {7}pytest: 1 result, 2\.9k tokens, \$\d\.\d\d$/m)
})

test('a cap on the output of shell commands: the replay keeps the preview\'s share of each long result of Claude Code, and findings names the change', () => {
  const long = { tools: [['Bash', { command: 'npm test' }, 20000]] }
  const short = { tools: [['Bash', { command: 'git status' }, 5000]] }
  const calls = records([long, short, long, short, {}, {}, {}])
  const p = proposals(calls, { ownFile: () => undefined })
  const cap = p.all.find((x) => x.id === 'bash-output-cap')
  // The replay by hand: of each result over 10,000 characters, only 2,200 of its characters stay.
  const { blocks } = analyze(calls)
  const longOnes = blocks.filter((b) => b.label === 'Bash' && b.chars > 10000)
  assert.equal(longOnes.length, 2)
  near(cap.saving, sum(longOnes, (b) => (b.entry + b.carry) * (1 - 2200 / 20000)))
  assert.ok(cap.saving > 0)
  assert.equal(cap.args, '--chars 10000')
  assert.match(cap.how, /"bashOutputMaxChars": 10000/)
  assert.match(cap.evidence, /^2 results of shell commands that worked were longer than 10,000 characters\. Entering and carried on the later calls, they cost /)
  const text = findings(calls, { days: 7 })
  const lines = finding(text, 'Tool results in the context')
  assert.equal(lines.at(-1), `   Fix: widal apply bash-output-cap (the replay of these 7 days: ${money(cap.saving)} less). Claude then gets at most 10,000 characters of a command's output inline, and a preview and a file for longer output.`)
  // The same calls as if Cowork had made them: a setting of Claude Code does not reach them.
  const asCowork = calls.map((r) => ({ ...r, s: 'cowork', id: `cw-${r.id}` }))
  assert.equal(proposals(asCowork, { ownFile: () => undefined }).all.find((x) => x.id === 'bash-output-cap').saving, 0)
  assert.doesNotMatch(findings(asCowork, { days: 7 }), /bash-output-cap/)
})

test('the replay of the cap leaves out failed commands, and its risk says that the cap also sets what a failed command shows', () => {
  const long = { tools: [['Bash', { command: 'npm test' }, 20000]] }
  const failing = { tools: [['Bash', { command: 'npm test -- --ci' }, 30000]], failed: true }
  const calls = records([long, failing, failing, {}, {}])
  // The parser keeps the flag of a failed result, and nothing of its text.
  const entries = calls.flatMap((r) => r.add).filter((a) => a[0] === 'Bash')
  assert.deepEqual(entries.map((a) => [a[1], a[3], a[4]]), [[20000, 'npm', undefined], [30000, 'npm', 1], [30000, 'npm', 1]])
  const { blocks } = analyze(calls)
  assert.deepEqual(blocks.filter((b) => b.label === 'Bash').map((b) => b.failed === true), [false, true, true])
  const cap = proposals(calls, { ownFile: () => undefined }).all.find((x) => x.id === 'bash-output-cap')
  const worked = blocks.filter((b) => b.label === 'Bash' && !b.failed)
  near(cap.saving, sum(worked, (b) => (b.entry + b.carry) * (1 - 2200 / 20000)))
  assert.match(cap.evidence, /^1 result of a shell command that worked was longer than 10,000 characters\. Entering and carried on the later calls, it cost /)
  assert.match(cap.risk, /The setting also sets the window of output that Claude Code reads back, and the excerpt of a failed command is cut from that window: with a smaller cap, a long error can show less of its output\.$/)
  assert.doesNotMatch(cap.risk, /keeps its excerpt/)
  // For one day, the fix says "this day".
  assert.match(findings(calls, { days: 1, now: START + 3600e3 }), /Fix: widal apply bash-output-cap \(the replay of this day: \$\d+\.\d\d less\)/)
})

test('"apply bash-output-cap" says what value it replaced, and that Claude Code ignores BASH_MAX_OUTPUT_LENGTH while the setting is on', () => {
  const settings = join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
  const first = (said) => said[0].split('\n')
  writeFileSync(settings, JSON.stringify({ bashOutputMaxChars: 50000, env: { BASH_MAX_OUTPUT_LENGTH: '100000' } }))
  assert.deepEqual(first(apply('bash-output-cap', OWN, START)), [
    'Set "bashOutputMaxChars" to 10000 in Claude Code\'s settings. Claude gets at most that many characters of a successful command\'s output inline.',
    'It was 50000 before. widal undo bash-output-cap puts that back.',
    'BASH_MAX_OUTPUT_LENGTH is set to 100000 in the "env" of Claude Code\'s settings. Claude Code ignores it while "bashOutputMaxChars" is set.',
  ])
  // Applied again with another size: the value from before is still the one that undo puts back.
  assert.equal(first(apply('bash-output-cap', OWN, START, ['--chars', '20000']))[1], 'It was 50000 before. widal undo bash-output-cap puts that back.')
  undo('bash-output-cap', OWN)
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), { bashOutputMaxChars: 50000, env: { BASH_MAX_OUTPUT_LENGTH: '100000' } })
  // Set in the environment of this program: said too. A value that is not a number is not printed.
  writeFileSync(settings, JSON.stringify({}))
  const before = process.env.BASH_MAX_OUTPUT_LENGTH
  process.env.BASH_MAX_OUTPUT_LENGTH = 'not a number'
  try {
    assert.deepEqual(first(apply('bash-output-cap', OWN, START)).slice(1), ['BASH_MAX_OUTPUT_LENGTH is set in your environment. Claude Code ignores it while "bashOutputMaxChars" is set.'])
  } finally {
    if (before === undefined) delete process.env.BASH_MAX_OUTPUT_LENGTH
    else process.env.BASH_MAX_OUTPUT_LENGTH = before
  }
  undo('bash-output-cap', OWN)
  // Nothing set before and no variable: one sentence only.
  assert.equal(first(apply('bash-output-cap', OWN, START)).length, 1)
  undo('bash-output-cap', OWN)
})

test('"apply bash-output-cap" sets bashOutputMaxChars, takes --chars from 4000 to 128000, and undo puts back what was there', () => {
  const settings = join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
  const read = () => JSON.parse(readFileSync(settings, 'utf8'))
  writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
  const said = apply('bash-output-cap', OWN, START)
  assert.equal(said[0], 'Set "bashOutputMaxChars" to 10000 in Claude Code\'s settings. Claude gets at most that many characters of a successful command\'s output inline.')
  assert.match(said[1], /^It needs Claude Code 2\.1\.261 or later/)
  assert.equal(said.at(-1), 'Take it back with: widal undo bash-output-cap')
  assert.deepEqual(read(), { theme: 'dark', bashOutputMaxChars: 10000 })
  assert.deepEqual(apply('bash-output-cap', OWN), ['bash-output-cap is already applied.'])
  // Another size: undo still goes back to what was there first.
  apply('bash-output-cap', OWN, START, ['--chars', '20000'])
  assert.equal(read().bashOutputMaxChars, 20000)
  for (const bad of ['3999', '128001', 'abc', '1e4']) assert.throws(() => apply('bash-output-cap', OWN, START, ['--chars', bad]), /--chars is a whole number from 4000 to 128000\./, bad)
  assert.match(undo('bash-output-cap', OWN)[0], /^bash-output-cap is taken back\./)
  assert.deepEqual(read(), { theme: 'dark' })
  assert.equal(applied()['bash-output-cap'], undefined)
  // A value that was there comes back, and one that the person changed after the apply stays.
  writeFileSync(settings, JSON.stringify({ bashOutputMaxChars: 50000 }))
  apply('bash-output-cap', OWN, START)
  undo('bash-output-cap', OWN)
  assert.deepEqual(read(), { bashOutputMaxChars: 50000 })
  apply('bash-output-cap', OWN, START)
  writeFileSync(settings, JSON.stringify({ bashOutputMaxChars: 7000 }))
  assert.deepEqual(undo('bash-output-cap', OWN), [
    'bash-output-cap is taken back, except for one setting.',
    '"bashOutputMaxChars" in Claude Code\'s settings was not put back, because it was changed after this tool set it: it is 7000 now, and it was 50000 before the change.',
  ])
})

test('repeated tool calls are one line per session and tool, with the cost of the repeats, the folder, and the likely cause', () => {
  const read = { tools: [['Read', { file_path: '/work/shop-web/src/app.ts' }, 8000]] }
  const load = { tools: [['ToolSearch', { query: 'select:WebFetch' }, 2000]] }
  const grep = { tools: [['Grep', { pattern: 'login' }, 3000]] }
  // A file read twice and the same deferred tool loaded twice, then a compaction, then both again.
  // And a search that runs four times with no compaction between.
  const calls = records([read, load, read, load, { compact: true }, read, load, read, load, grep, grep, grep, grep, {}], { file: '/logs/repeats-1.jsonl' })
  const groups = repeatedByTool(analyze(calls).calls, analyze(calls).blocks)
  const byTool = Object.fromEntries(groups.map((g) => [g.tool, g]))
  assert.deepEqual(Object.keys(byTool).sort(), ['Grep', 'Read', 'ToolSearch'])
  assert.deepEqual([byTool.Read.n, byTool.Read.inputs, byTool.Read.afterCompaction, byTool.Read.ses, byTool.Read.cwd], [4, 1, true, 'repeats-1', '/work/shop-web'])
  assert.equal(byTool.ToolSearch.afterCompaction, true)
  assert.equal(byTool.Grep.afterCompaction, false)
  // The cost is that of the repeated results: the first result of each input is not counted.
  const { blocks } = analyze(calls)
  const grepResults = blocks.filter((b) => b.label === 'Grep')
  const first = Math.min(...grepResults.map((b) => b.ts))
  near(byTool.Grep.cost, sum(grepResults.filter((b) => b.ts > first), (b) => b.entry + b.carry))
  assert.ok(byTool.Grep.cost > 0)

  const lines = finding(findings(calls, { days: 7 }), 'The same tool call, with the same input, many times')
  assert.match(lines[0], /^\d\. The same tool call, with the same input, many times: \$\d+\.\d\d, \d+% of the total$/)
  assert.ok(lines.includes(`   Read ran 4 times with a repeated input (1 input, each 4 times or more) in work/shop-web, about ${money(byTool.Read.cost)}. Likely cause: files read again after a compaction.`), lines.join('\n'))
  assert.ok(lines.includes(`   ToolSearch ran 4 times with a repeated input (1 input, each 4 times or more) in work/shop-web, about ${money(byTool.ToolSearch.cost)}. Likely cause: deferred tools loaded again after a compaction.`), lines.join('\n'))
  assert.ok(lines.includes(`   Grep ran 4 times with a repeated input (1 input, each 4 times or more) in work/shop-web, about ${money(byTool.Grep.cost)}. Likely cause: a loop, or a check that is repeated on purpose.`), lines.join('\n'))
  // No session id: the folder stands for it.
  assert.ok(!lines.join('\n').includes('repeats-1'))
  assert.match(lines.at(-1), /^ {3}Fix: widal apply compact-keep\./)
})

test('each finding ends with the command that fixes it, with the saving of advise\'s replay of the same calls', () => {
  // The main session carries more than 200k tokens. A subagent on Claude Opus 5.5 waits 10 minutes and loses its cache.
  const main = records([{ carried: 250000 }, {}, {}, { gap: 30 * 60e3, lost: true }, {}], { file: '/logs/fixes-1.jsonl' })
  const sub = records([{ tools: [['Read', { f: 1 }, 2000]] }, { gap: 10 * 60e3, lost: true }, {}], { file: '/logs/fixes-1/subagents/agent-1.jsonl', owner: false, sub: true })
  const calls = [...main, ...sub]
  const p = proposals(calls, { ownFile: () => undefined })
  const saving = (id) => p.all.find((x) => x.id === id).saving
  const text = findings(calls, { days: 7 })

  const lost = finding(text, 'The cache was lost')
  assert.ok(saving('subagent-cache-1h') > 0)
  assert.deepEqual(lost.slice(-2), [
    `   Fix for the subagents: widal apply subagent-cache-1h (the replay of these 7 days: ${money(saving('subagent-cache-1h'))} less). It gives subagents a 1 hour cache.`,
    '   Fix for the main sessions: widal apply keep-warm, an experiment. It wakes an idle session with one short turn shortly before its cache ends, for up to 3 hours without you.',
  ])
  // Each item of the lists is a line of its own.
  const causes = lost.indexOf('   Causes:')
  assert.match(lost[causes + 1], /^ {5}idle for over (5 minutes|1 hour): 1 time, \$\d+\.\d\d$/)
  const largest = lost.indexOf('   Largest:')
  assert.match(lost[largest + 1], /^ {5}\d{4}-\d\d-\d\d \d\d:\d\d work\/shop-web \$\d+\.\d\d \(\d+k tokens\)$/)
  assert.match(lost[largest + 2], /^ {5}\d{4}-\d\d-\d\d \d\d:\d\d work\/shop-web \$\d+\.\d\d \(\d+k tokens\)$/)

  const above = finding(text, 'Carrying context above 200k tokens')
  const atCap = p.all.find((x) => x.id === 'autocompact-window').points.find((x) => x.tokens === 200000).saving
  assert.ok(atCap > 0)
  assert.equal(above.at(-1), `   Fix: widal apply autocompact-window --tokens 200000 (the replay of these 7 days: ${money(atCap)} less). Claude Code then compacts a context on its own at 200k tokens.`)

  const subagents = finding(text, 'Subagents')
  assert.ok(saving('subagent-model') > 0)
  assert.equal(subagents.at(-1), `   Fix: widal apply subagent-model (the replay of these 7 days: ${money(saving('subagent-model'))} less). Subagents then run on Claude Sonnet 5.5. Compare the work before and after with: widal measure subagent-model`)
})

test('on a subscription the dollars are API value, by the token they are spend, and a period that mixes them shows them apart', () => {
  // The Claude account is on Claude Max. Another session ran with an API key.
  files({ accounts: { accounts: { [`claude:${ACCOUNT}`]: { org: 'Acme', organizationType: 'claude_max', maxTier: '5x' } }, signedIn: {} } })
  try {
    const onPlan = records([{}, {}, {}], { file: '/logs/plan-1.jsonl' })
    const byToken = records([{}, {}], { file: '/logs/token-1.jsonl', owner: false }).map((r) => ({ ...r, acct: 'api' }))
    const all = [...onPlan, ...byToken]
    const value = sum(analyze(onPlan).calls, (e) => e.c.total)
    const spend = sum(analyze(byToken).calls, (e) => e.c.total)
    const now = START + DAY
    const text = summary(all, { days: 7, now })
    assert.match(text, /^What the agents used, last 7 days, in dollars at list prices, so an estimate\.\n/)
    assert.ok(text.includes(`\nPaid by the token: ${money(spend)} (spend, at list prices)\nOn subscriptions: ${money(value)} of API value (what the same use would cost by the token)\n`), text)
    // The plans block: the account, its plan and price, then the API value next to the price for the same days.
    const forDays = (100 * 7) / 30
    assert.ok(text.includes(`\nPlans\n  Acme (claude:aaaaaaaa): Claude Max, $100 a month (the plan's public price)\n    API value in 7 days: ${money(value)}. The plan's price for 7 days: ${money(forDays)}. That is less than 0.1 times the plan's price.\n`), text)
    assert.ok(value / forDays < 0.05) // A small share is not printed as 0.0 times.
    assert.doesNotMatch(text, /Agent spend/)
    // Only on a subscription: no "spend" at all.
    const planOnly = summary(onPlan, { days: 7, now })
    assert.ok(planOnly.includes(`\nOn subscriptions: ${money(value)} of API value. That is what the same use would cost by the token. You pay your plan's price, not this.\n`))
    assert.doesNotMatch(planOnly, /[Ss]pend:|Paid by the token/)
    // Only by the token: spend, and no block of plans.
    const tokenOnly = summary(byToken, { days: 7, now })
    assert.ok(tokenOnly.includes(`\nSpend: ${money(spend)}, paid by the token, at list prices.\n`))
    assert.doesNotMatch(tokenOnly, /API value|\nPlans\n/)
    // One session: its dollars by how its account pays.
    assert.match(session(onPlan, {}).split('\n')[2], /^API value {2}\$\d+\.\d\d, what the same use would cost by the token\. You pay your plan's price\.$/)
    assert.match(session(byToken, {}).split('\n')[2], /^Spend {4}\$\d+\.\d\d, paid by the token, at list prices$/)
    // The findings say the same at their top.
    assert.ok(findings(all, { days: 7, now }).split('\n').slice(1, 3).join('\n') === `Paid by the token: ${money(spend)} (spend, at list prices)\nOn subscriptions: ${money(value)} of API value (what the same use would cost by the token)`)
  } finally {
    files()
  }
})

test('the Max type is priced by its tier: 5x is Claude Max at $100, 20x is Claude Ultra at $200, and no tier gets no price', async () => {
  const { maxTierOf } = await import('../src/accounts.mjs')
  const { planName, planPrice } = await import('../src/plans.mjs')
  // The tier comes from the person's rate limit tier first, then the organisation's.
  assert.equal(maxTierOf('default_claude_max_5x', undefined), '5x')
  assert.equal(maxTierOf(undefined, 'default_claude_max_20x'), '20x')
  assert.equal(maxTierOf('default_claude_max_20x', 'default_claude_max_5x'), '20x')
  for (const none of [undefined, 'default_raven', 'default_claude_pro', 'max_10x', 5]) assert.equal(maxTierOf(none, undefined), undefined, String(none))
  const state = (fields) => ({ accounts: new Map([[`claude:${ACCOUNT}`, fields]]), signedIn: new Map() })
  const key = `claude:${ACCOUNT}`
  assert.deepEqual([planName(key, state({ organizationType: 'claude_max', maxTier: '5x' })), planPrice(key, state({ organizationType: 'claude_max', maxTier: '5x' }))], ['Claude Max', { monthly: 100, source: 'table' }])
  assert.deepEqual([planName(key, state({ organizationType: 'claude_max', maxTier: '20x' })), planPrice(key, state({ organizationType: 'claude_max', maxTier: '20x' }))], ['Claude Ultra', { monthly: 200, source: 'table' }])
  assert.deepEqual([planName(key, state({ organizationType: 'claude_max' })), planPrice(key, state({ organizationType: 'claude_max' }))], ['Claude Max or Ultra', null])
  assert.deepEqual([planName(key, state({ organizationType: 'claude_pro' })), planPrice(key, state({ organizationType: 'claude_pro' }))], ['Claude Pro', { monthly: 20, source: 'table' }])
  // A guess from before, "claude_ultra", has no price: Claude Code names Ultra "claude_max" with the tier 20x.
  assert.equal(planPrice(key, state({ organizationType: 'claude_ultra' })), null)
  // A Team seat with a Max tier is not priced as Max.
  assert.equal(planPrice(key, state({ organizationType: 'claude_team', seatTier: 'team_tier_1', maxTier: '5x' })), null)

  // In the block of plans, for one day: the words are singular.
  files({ accounts: { accounts: { [key]: { org: 'Acme', organizationType: 'claude_max' } }, signedIn: {} } })
  try {
    const text = summary(records([{}, {}]), { days: 1, now: START + DAY })
    assert.match(text, /\n {2}Acme \(claude:aaaaaaaa\): Claude Max or Ultra\n {4}API value in 1 day: \$\d+\.\d\d\. Price not set: widal accounts price claude:aaaaaaaa <dollars>\n/)
    files({ accounts: { accounts: { [key]: { org: 'Acme', organizationType: 'claude_max', maxTier: '20x' } }, signedIn: {} } })
    assert.match(summary(records([{}, {}]), { days: 1, now: START + DAY }), /\n {4}API value in 1 day: \$\d+\.\d\d\. The plan's price for 1 day: \$6\.67\. That is less than 0\.1 times the plan's price\.\n/)
  } finally {
    files()
  }
})

test('a price that is not known asks for one, a free plan is not compared, and a Cowork account shares the plan of its Claude account', () => {
  files({ accounts: { accounts: { [`claude:${ACCOUNT}`]: { organizationType: 'claude_team', seatTier: 'team_tier_1' } }, signedIn: {} } })
  try {
    const team = records([{}, {}])
    const cowork = records([{}], { owner: false }).map((r) => ({ ...r, s: 'cowork', id: `cw-${r.id}`, acct: `cowork:${ACCOUNT}` }))
    const text = summary([...team, ...cowork], { days: 7, now: START + DAY })
    // One plan for both, with the dollars of both.
    const value = sum(analyze([...team, ...cowork]).calls, (e) => e.c.total)
    assert.ok(text.includes(`\nPlans\n  claude:aaaaaaaa: team_tier_1\n    API value in 7 days: ${money(value)}. Price not set: widal accounts price claude:aaaaaaaa <dollars>\n`), text)
    const free = records([{}]).map((r) => ({ ...r, s: 'codex', id: `cx-${r.id}`, acct: 'codex:free' }))
    assert.match(summary(free, { days: 7, now: START + DAY }), /\n {2}codex:free: ChatGPT Free, \$0 a month \(the plan's public price\)\n {4}API value in 7 days: \$\d+\.\d\d\. A free plan, so there is no price to compare with\.\n/)
  } finally {
    files()
  }
})

test('findings give a share of the weekly limit for cache losses, context and tool results, as an estimate from this week\'s use', () => {
  const now = START + DAY
  const week = (pct) => ({ [`claude:${ACCOUNT}`]: { week: { pct, resetsAt: now + 3 * DAY, at: now - 60e3 } } })
  const calls = records([{ carried: 250000, tools: [['Read', { f: 1 }, 9000]] }, {}, { gap: 2 * 3600e3, lost: true }, {}])
  const { calls: analyzed } = analyze(calls)
  const value = sum(analyzed, (e) => e.c.total)
  const waste = sum(analyzed, (e) => e.waste ?? 0)
  files({ limits: week(20) })
  try {
    const text = findings(calls, { days: 7, now })
    // Dollars per 1% of the week: this week's API value of the account divided by the percent used.
    const perPct = value / 20
    const share = (dollars) => {
      const s = dollars / perPct
      return s >= 10 ? Math.round(s).toLocaleString('en-US') : s.toFixed(1).replace(/\.0$/, '')
    }
    assert.ok(finding(text, 'The cache was lost').includes(`   That is about ${share(waste)}% of your weekly limit (estimate from this week's use).`), text)
    assert.ok(finding(text, 'Carrying context above').some((l) => /^ {3}That is about [\d.]+% of your weekly limit \(estimate from this week's use\)\.$/.test(l)))
    assert.ok(finding(text, 'Tool results in the context').some((l) => /^ {3}That is about [\d.]+% of your weekly limit \(estimate from this week's use\)\.$/.test(l)))
    assert.ok(text.endsWith(`The share of a weekly limit is an estimate. Anthropic does not publish how the limit counts tokens. Widal.Code divides the API value of the account's calls from the start of the week to the time of the reading by the percent that the reading gives: ${money(perPct)} of API value per 1% for claude:aaaaaaaa. The percent also counts chat, the phone and other computers, so the share is too high when the plan was used there too.`))
    // Under 5% used, a few calls would change the estimate by a lot: no share.
    files({ limits: week(4) })
    assert.doesNotMatch(findings(calls, { days: 7, now }), /weekly limit/)
    // A week that began before the calls that were read: its dollars are not all there.
    files({ limits: week(20) })
    assert.doesNotMatch(findings(calls, { days: 1, now }), /weekly limit/)
  } finally {
    files()
  }
})

test('tools that no session called: the replay keeps their share of each main session start, and names the tools to deny', async () => {
  const { START_TOOLS } = await import('../src/actions.mjs')
  // 20 main sessions that call Bash, Read and the subagent tool (logged as "Agent"), and web search once.
  const one = (i) => records([{ tools: [['Bash', { command: 'npm test' }]] }, { tools: [['Read', { file_path: '/work/a.js' }]] }, { tools: [[i === 0 ? 'WebSearch' : 'Agent', {}]] }, {}], { file: `/logs/tools-${i}.jsonl` })
  const calls = Array.from({ length: 20 }, (_, i) => one(i)).flat()
  const p = proposals(calls, { ownFile: () => undefined })
  const tools = p.all.find((x) => x.id === 'tools-unused')
  assert.ok(tools, 'the proposal is there')
  assert.deepEqual(tools.tools, ['Workflow', 'ScheduleWakeup', 'ReportFindings', 'ListAgents', 'WebFetch', 'SendMessage'])
  assert.equal(tools.args, '--tools Workflow,ScheduleWakeup,ReportFindings,ListAgents,WebFetch,SendMessage')
  const cut = sum(tools.tools, (t) => START_TOOLS[t].tokens)
  const starts = analyze(calls).blocks.filter((b) => b.label.startsWith('(system prompt') && b.tokens > 0)
  assert.equal(starts.length, 20)
  near(tools.saving, sum(starts, (b) => (b.entry + b.carry) * Math.min(1, cut / b.tokens)))
  assert.ok(tools.saving > 0)
  assert.match(tools.evidence, /^In 20 main sessions of Claude Code, no call used Workflow, ScheduleWakeup, ReportFindings, ListAgents, WebFetch, SendMessage\./)
  assert.doesNotMatch(tools.risk, /subagents/, 'the subagent tool was called, so it is not denied')
  // With fewer than 20 sessions, a tool that was not called may just not have been needed yet.
  assert.equal(proposals(calls.filter((r) => r.f !== '/logs/tools-19.jsonl'), { ownFile: () => undefined }).all.find((x) => x.id === 'tools-unused'), undefined)
  // Cowork's sessions are not Claude Code's: its settings do not reach them.
  const asCowork = calls.map((r) => ({ ...r, s: 'cowork', id: `cw-${r.id}` }))
  assert.equal(proposals(asCowork, { ownFile: () => undefined }).all.find((x) => x.id === 'tools-unused'), undefined)
  // Without the subagent tool in any call, it is proposed too, and the risk says what it takes away.
  const noAgent = Array.from({ length: 20 }, (_, i) => records([{ tools: [['Bash', { command: 'ls' }]] }, {}], { file: `/logs/tools-b-${i}.jsonl` })).flat()
  const all = proposals(noAgent, { ownFile: () => undefined }).all.find((x) => x.id === 'tools-unused')
  assert.deepEqual(all.tools, Object.keys(START_TOOLS))
  assert.match(all.risk, /without "Task" there are no subagents/)
})
