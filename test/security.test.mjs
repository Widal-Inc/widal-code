// Tests for the security checks: the catalog of controls, the rules of the settings, the actions,
// the code and the data, the scanners (with stand-ins), the hooks and the gate, the part of the
// status line, "widal check" and the fixes. With made-up settings, logs and git repositories in
// temp folders. Run: node --test
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'widal-code-security-test-')))
process.env.HOME = join(dir, 'person')
// The link that Claude Code's settings call, in the tool's folder in the made-up home folder.
const OWN = join(process.env.HOME, '.widal', 'bin', 'widal')
process.env.WIDAL_HOME = join(dir, 'home')
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
process.env.WIDAL_COWORK_DIR = join(dir, 'cowork')
// The managed settings of the organization: a file that is not there, so that no test reads the real one.
process.env.WIDAL_MANAGED_SETTINGS = join(dir, 'managed', 'managed-settings.json')
for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BASE_URL', 'OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS']) delete process.env[key]
mkdirSync(process.env.HOME, { recursive: true })

const { CONTROLS, AI_GROUP, controlsFor, controlWords, storedControlsFor } = await import('../src/controls.mjs')
const { RULES, makeFinding } = await import('../src/rules.mjs')
const { FRAMEWORKS } = await import('../src/settings.mjs')
const { checkSettings, readToml } = await import('../src/check-settings.mjs')
const { checkActions, commandRules, shellCommands } = await import('../src/check-log.mjs')
const { checkCode, terraformRules } = await import('../src/check-code.mjs')
const security = await import('../src/security.mjs')
const { readFindings, saveFindings, findingsFile } = await import('../src/findings.mjs')
const { saveConfig, statusLine } = await import('../src/claude-code.mjs')
const { setSetting } = await import('../src/settings.mjs')
const actions = await import('../src/actions.mjs')
const { riskPart } = await import('../src/risk.mjs')

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '')
const WIDAL = join(ROOT, 'cli', 'widal.mjs')
const NOW = Date.parse('2026-11-14T12:00:00')

// Made-up keys and numbers, put together here so that this file holds none of them whole.
const AWS_KEY = `AKIA${'Z7X3Q9W2E5R8T1Y4'}`
const GITHUB_TOKEN = `ghp_${'Ab3'.repeat(12)}`
const ANTHROPIC_KEY = `sk-ant-api03-${'x9Y'.repeat(30)}`
const OPENAI_KEY = `sk-proj-${'Q1w'.repeat(20)}`
const SLACK_TOKEN = `xoxb-${'1234567890'}-abcdefghij`
const PRIVATE_KEY = `-----BEGIN RSA ${'PRIVATE'} KEY-----`
const CARD = ['4111', '1111', '1111', '1111'].join('')
const SSN = ['123', '45', '6789'].join('-')

let fresh = 0
/** A fresh state: its own folder of Widal.Code, its own config folders of Claude Code and Codex, and no config. */
function freshState() {
  const base = join(dir, `state-${++fresh}`)
  process.env.WIDAL_HOME = join(base, 'widal')
  process.env.CLAUDE_CONFIG_DIR = join(base, 'claude')
  process.env.CODEX_HOME = join(base, 'codex')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  return base
}
const SETTINGS = () => join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
const writeSettings = (value) => writeFileSync(SETTINGS(), JSON.stringify(value, null, 2))
const readSettings = () => JSON.parse(readFileSync(SETTINGS(), 'utf8'))
const rules = (findings) => findings.map((f) => f.rule).sort()

/** Every file below a folder, as text: what Widal.Code wrote. */
function allText(folder) {
  if (!existsSync(folder)) return ''
  return readdirSync(folder, { recursive: true }).map((name) => join(folder, name)).filter((p) => statSync(p).isFile()).map((p) => readFileSync(p, 'utf8')).join('\n')
}

/** A git repository in a temp folder, with one commit, and these files written after it, so that they count as changed. */
function repo(files = {}, committed = {}) {
  const root = realpathSync(mkdtempSync(join(dir, 'repo-')))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
  git('init', '-q', '.')
  for (const [name, text] of Object.entries(committed)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  git('add', '-A')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'first')
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

let msg = 0
const assistant = (blocks, ts = '2026-11-14T11:00:00Z', id = `m${++msg}`) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5-5', role: 'assistant', content: blocks } })
const use = (name, input, id = `t${++msg}`) => ({ type: 'tool_use', id, name, input })
const bash = (command, id) => use('Bash', { command, description: 'x' }, id)
const user = (content) => JSON.stringify({ type: 'user', message: { role: 'user', content } })
const result = (id, text) => user([{ type: 'tool_result', tool_use_id: id, content: text }])
/** A session log in a temp folder. */
function log(lines, name = `s${++msg}`) {
  const folder = mkdtempSync(join(dir, 'log-'))
  const file = join(folder, `${name}.jsonl`)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

/** A stand-in's script that prints a text and ends with an exit code. It uses only what the shell has built in: the PATH of a test holds no other program. */
const printing = (text, code = 0) => `printf '%s\\n' '${text}'\nexit ${code}`
/** A folder of programs for a test: the scanners' stand-ins that `scripts` gives, by name. */
function programs(scripts = {}) {
  const bin = mkdtempSync(join(dir, 'bin-'))
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  return bin
}
/** A PATH for the command in a test: node and git, and nothing else of this computer. */
function cleanPath(extra) {
  const bin = mkdtempSync(join(dir, 'path-'))
  symlinkSync(process.execPath, join(bin, 'node'))
  symlinkSync(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
  return extra ? `${extra}:${bin}` : bin
}
/** Runs the command with the test's temp folders, and a PATH without any scanner unless `path` names one. */
function run(args, { cwd = dir, input, path = cleanPath(), env = {} } = {}) {
  const r = spawnSync(process.execPath, [WIDAL, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, PATH: path, NO_COLOR: '1', ...env } })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// The catalog of controls.

test('the catalog marks only the ids that were checked against the frameworks\' own text as confirmed', () => {
  const confirmed = Object.entries(CONTROLS).flatMap(([fw, list]) => list.filter(([, , c]) => c).map(([id]) => `${fw} ${id}`))
  assert.deepEqual(confirmed, [
    'hipaa 164.312(a)', 'hipaa 164.312(a)(2)(i)', 'hipaa 164.312(a)(2)(iv)', 'hipaa 164.312(b)', 'hipaa 164.312(c)', 'hipaa 164.312(d)', 'hipaa 164.312(e)', 'hipaa 164.514(b)(2)(i)',
    'part11 11.10(a)', 'part11 11.10(c)', 'part11 11.10(d)', 'part11 11.10(e)', 'part11 11.10(g)', 'part11 11.10(k)',
    'pci 6.4.3', 'pci 11.6.1', 'glba 314.4', 'dora Art. 28',
    ...['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((n) => `owasp-llm LLM${n}`),
  ])
  // The ids of the phase are there, unconfirmed.
  for (const [fw, id] of [['soc2', 'CC6.1'], ['soc2', 'CC7.2'], ['soc2', 'CC8.1'], ['iso27001', 'A.5.15'], ['iso27001', 'A.8.15'], ['iso27001', 'A.8.24'], ['iso27001', 'A.8.28'], ['iso27001', 'A.8.32'], ['pci', '3'], ['pci', '4'], ['pci', '7'], ['pci', '8'], ['pci', '10'], ['nydfs', '500.12'], ['gdpr', 'Art. 32'], ['gdpr', 'Art. 28'], ['owasp-agentic', 'ASI01'], ['owasp-agentic', 'ASI10'], ['nist-ai-rmf', 'GOVERN'], ['nist-ai-rmf', 'MANAGE']]) {
    assert.equal(CONTROLS[fw].find(([x]) => x === id)?.[2], false, `${fw} ${id}`)
  }
  // Every framework of the settings has controls, except HITRUST, which goes through HIPAA and ISO 27001.
  for (const [, list] of FRAMEWORKS) for (const [id] of list) assert.equal(Boolean(CONTROLS[id]?.length), id !== 'hitrust', id)
  assert.deepEqual(CONTROLS.iso42001, [[null, 'AI management system', false]])
})

test('every rule names controls that the catalog has, and controls of the AI agents group', () => {
  for (const r of Object.values(RULES)) {
    for (const [fw, ids] of Object.entries(r.controls)) for (const id of ids) assert.ok(CONTROLS[fw]?.some(([x]) => x === id), `${r.id}: ${fw} ${id}`)
    assert.ok(AI_GROUP.some((fw) => r.controls[fw]?.length), r.id)
    assert.ok(['settings', 'actions', 'code', 'data'].includes(r.kind) && ['high', 'medium', 'low'].includes(r.severity), r.id)
  }
})

test('a finding shows only the controls of the frameworks that are on, HITRUST through HIPAA and ISO 27001, and else those of the AI agents group', () => {
  const map = RULES['code.tls-off'].controls
  assert.deepEqual(controlsFor(map, ['hipaa']).map((c) => `${c.framework} ${c.id}`), ['hipaa 164.312(e)'])
  assert.deepEqual(controlsFor(map, ['pci', 'soc2']).map((c) => `${c.framework} ${c.id}`), ['soc2 CC6.1', 'pci 4'])
  const hitrust = controlsFor(map, ['hitrust'])
  assert.deepEqual(hitrust.map((c) => `${c.framework} ${c.id}`), ['hipaa 164.312(e)', 'iso27001 A.8.24', 'iso27001 A.8.28', 'hitrust null'])
  assert.equal(controlWords(hitrust.at(-1)), 'HITRUST: through the controls it shares with HIPAA and ISO 27001')
  // None of the frameworks that are on touches the rule: its AI agents controls stay.
  assert.deepEqual(controlsFor(RULES['code.card-number'].controls, ['hipaa']).map((c) => c.framework), ['owasp-llm', 'owasp-llm', 'nist-ai-rmf', 'iso42001'])
  assert.equal(controlWords(controlsFor(map, ['hipaa'])[0]), 'HIPAA 164.312(e) Transmission security')
  assert.equal(controlWords(controlsFor(map, ['soc2'])[0]), 'SOC 2 CC6.1 Logical access security (id to check)')
  assert.equal(controlWords({ framework: 'iso42001', id: null, confirmed: false, label: 'AI management system' }), 'ISO/IEC 42001: AI management system')
  // A finding that came with its own list (a cloud finding) is shown the same way.
  const stored = [{ framework: 'pci', id: '4' }, { framework: 'hipaa', id: '164.312(e)' }, { framework: 'owasp-llm', id: 'LLM02' }]
  assert.deepEqual(storedControlsFor(stored, ['hipaa']).map((c) => c.framework), ['hipaa'])
  assert.deepEqual(storedControlsFor(stored, ['gdpr']).map((c) => c.framework), ['owasp-llm'])
})

// The settings.

/** The findings of the settings for a folder, with these frameworks and this environment. */
const settingsCheck = ({ cwd, frameworks = [], env = {} } = {}) => checkSettings({ cwd, frameworks, env }).findings
const one = (findings, rule) => findings.filter((f) => f.rule === rule)

test('bypass mode: defaultMode bypassPermissions or auto in the user or managed settings, or the accepted dialog, unless bypass mode is disabled', () => {
  freshState()
  writeSettings({ permissions: { defaultMode: 'bypassPermissions' } })
  let [f] = one(settingsCheck(), 'set.bypass-mode')
  assert.equal(f.severity, 'high')
  assert.deepEqual(f.fix, { action: 'no-bypass', words: 'widal apply no-bypass' })
  assert.match(f.detail, /permissions\.defaultMode is bypassPermissions in .*settings\.json: every tool call runs without a question\./)
  writeSettings({ permissions: { defaultMode: 'auto' } })
  ;[f] = one(settingsCheck(), 'set.bypass-mode')
  assert.equal(f.fix, null)
  assert.match(f.detail, /a classifier decides in your place/)
  writeSettings({ permissions: { defaultMode: 'auto' }, disableAutoMode: 'disable' })
  assert.deepEqual(one(settingsCheck(), 'set.bypass-mode'), [])
  writeSettings({ skipDangerousModePermissionPrompt: true })
  assert.equal(one(settingsCheck(), 'set.bypass-mode').length, 1)
  writeSettings({ skipDangerousModePermissionPrompt: true, permissions: { defaultMode: 'bypassPermissions', disableBypassPermissionsMode: 'disable' } })
  assert.deepEqual(one(settingsCheck(), 'set.bypass-mode'), [])
  // Miss: another mode, and bypass mode in a project file, where Claude Code does not take it.
  writeSettings({ permissions: { defaultMode: 'acceptEdits' } })
  const project = repo()
  mkdirSync(join(project, '.claude'))
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }))
  assert.deepEqual(one(settingsCheck({ cwd: project }), 'set.bypass-mode'), [])
  // The managed settings count.
  mkdirSync(dirname(process.env.WIDAL_MANAGED_SETTINGS), { recursive: true })
  writeFileSync(process.env.WIDAL_MANAGED_SETTINGS, JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }))
  try {
    assert.equal(one(settingsCheck(), 'set.bypass-mode').length, 1)
  } finally {
    writeFileSync(process.env.WIDAL_MANAGED_SETTINGS, '{}')
  }
})

test('an allow rule for every shell command, in the user settings or a project\'s, and not a rule for one command', () => {
  freshState()
  for (const rule of ['Bash', 'Bash(*)', ' Bash(**) ', 'Bash(:*)']) {
    writeSettings({ permissions: { allow: ['Read', rule] } })
    assert.equal(one(settingsCheck(), 'set.allow-any-shell').length, 1, rule)
  }
  writeSettings({ permissions: { allow: ['Bash(npm test)', 'Bash(git status:*)'] } })
  assert.deepEqual(one(settingsCheck(), 'set.allow-any-shell'), [])
  const project = repo()
  mkdirSync(join(project, '.claude'))
  writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }))
  const [f] = one(settingsCheck({ cwd: project }), 'set.allow-any-shell')
  assert.equal(f.where.project, project)
  assert.equal(f.severity, 'high')
})

test('no deny rule for .env files and private keys; the deny rules of the fix are enough', () => {
  freshState()
  writeSettings({})
  assert.match(one(settingsCheck(), 'set.no-secret-deny')[0].detail, /no deny rule for reading \.env files or private keys\./)
  writeSettings({ permissions: { deny: ['Read(./.env)'] } })
  assert.match(one(settingsCheck(), 'set.no-secret-deny')[0].detail, /no deny rule for reading private keys\./)
  writeSettings({ permissions: { deny: actions.SECRET_DENY } })
  assert.deepEqual(one(settingsCheck(), 'set.no-secret-deny'), [])
  writeSettings({ permissions: { deny: ['Read'] } })
  assert.deepEqual(one(settingsCheck(), 'set.no-secret-deny'), [])
})

test('the sandbox off, every project MCP server approved, and MCP servers on another host (name, type and host only)', () => {
  freshState()
  writeSettings({ sandbox: { enabled: true } })
  assert.deepEqual(one(settingsCheck(), 'set.sandbox-off'), [])
  writeSettings({ sandbox: { enabled: false }, enableAllProjectMcpServers: true })
  const found = settingsCheck()
  assert.equal(one(found, 'set.sandbox-off')[0].severity, 'medium')
  assert.equal(one(found, 'set.all-project-mcp').length, 1)
  writeSettings({ enableAllProjectMcpServers: false })
  assert.equal(one(settingsCheck(), 'set.sandbox-off').length, 1)
  assert.deepEqual(one(settingsCheck(), 'set.all-project-mcp'), [])

  // .claude.json sits next to a config folder that is not ~/.claude, inside it.
  const project = repo()
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({
    oauthAccount: { emailAddress: 'person@example.com' },
    mcpServers: {
      remote: { type: 'http', url: 'https://mcp.example.com/v1', headers: { Authorization: 'Bearer SECRET-HEADER-VALUE' } },
      here: { type: 'sse', url: 'http://localhost:9000/sse' },
      local: { command: 'node', args: ['server.js'], env: { TOKEN: 'SECRET-ENV-VALUE' } },
    },
    projects: { [project]: { mcpServers: { team: { type: 'http', url: 'https://team.example.org/mcp' } } } },
  }))
  writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { type: 'sse', url: 'https://docs.example.net/sse' } } }))
  const remote = one(settingsCheck({ cwd: project }), 'set.remote-mcp')
  assert.deepEqual(remote.map((f) => f.detail).sort(), [
    'The MCP server "docs" (sse) is on docs.example.net.',
    'The MCP server "remote" (http) is on mcp.example.com.',
    'The MCP server "team" (http) is on team.example.org.',
  ])
  assert.ok(remote.every((f) => f.severity === 'low'))
  assert.doesNotMatch(JSON.stringify(remote), /SECRET-|person@example|Bearer|server\.js/)
})

test('a provider that the HIPAA configuration does not cover is a finding only while HIPAA is on', () => {
  freshState()
  writeSettings({})
  const env = { CLAUDE_CODE_USE_BEDROCK: '1' }
  assert.deepEqual(one(settingsCheck({ env }), 'set.provider-not-hipaa'), [])
  const [f] = one(settingsCheck({ env, frameworks: ['hipaa'] }), 'set.provider-not-hipaa')
  assert.equal(f.detail, 'CLAUDE_CODE_USE_BEDROCK is set in the environment.')
  assert.deepEqual(f.controls.map((c) => c.id), ['164.308(b)', '164.312(e)'])
  assert.deepEqual(one(settingsCheck({ env: { CLAUDE_CODE_USE_BEDROCK: '0' }, frameworks: ['hipaa'] }), 'set.provider-not-hipaa'), [])
  assert.deepEqual(one(settingsCheck({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, frameworks: ['hipaa'] }), 'set.provider-not-hipaa'), [])
  const proxy = one(settingsCheck({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com/path?key=SECRET-URL' }, frameworks: ['hipaa'] }), 'set.provider-not-hipaa')
  assert.equal(proxy.length, 1)
  assert.doesNotMatch(JSON.stringify(proxy), /SECRET-URL|proxy\.example/)
  writeSettings({ env: { CLAUDE_CODE_USE_VERTEX: 'true' } })
  assert.match(one(settingsCheck({ frameworks: ['hipaa'] }), 'set.provider-not-hipaa')[0].detail, /^CLAUDE_CODE_USE_VERTEX is set in .*settings\.json\.$/)
})

test('transcripts kept for long: low, and medium while HIPAA, PCI DSS, 21 CFR Part 11 or GDPR is on; 7 days for both is no finding', () => {
  freshState()
  writeSettings({})
  const [f] = one(settingsCheck(), 'set.transcripts-kept')
  assert.equal(f.severity, 'low')
  assert.equal(f.detail, 'cleanupPeriodDays is not set, so Claude Code keeps transcripts for 30 days. desktopSessionCleanupPeriodDays is not set, so the transcripts of desktop and Cowork sessions are kept without an end. They are plain text on disk.')
  assert.deepEqual(f.fix, { action: 'transcript-days', words: 'widal apply transcript-days' })
  for (const fw of ['hipaa', 'pci', 'part11', 'gdpr']) assert.equal(one(settingsCheck({ frameworks: [fw] }), 'set.transcripts-kept')[0].severity, 'medium', fw)
  assert.equal(one(settingsCheck({ frameworks: ['soc2'] }), 'set.transcripts-kept')[0].severity, 'low')
  writeSettings({ cleanupPeriodDays: 7, desktopSessionCleanupPeriodDays: 7 })
  assert.deepEqual(one(settingsCheck({ frameworks: ['hipaa'] }), 'set.transcripts-kept'), [])
  writeSettings({ cleanupPeriodDays: 30, desktopSessionCleanupPeriodDays: 3 })
  assert.match(one(settingsCheck(), 'set.transcripts-kept')[0].detail, /^cleanupPeriodDays is 30, so Claude Code keeps transcripts for 30 days\. They are plain text on disk\.$/)
})

test('prompts or tool details sent to the telemetry collector, from the environment or the settings, and not with an off value', () => {
  freshState()
  writeSettings({})
  assert.deepEqual(one(settingsCheck({ env: { OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_TOOL_DETAILS: 'false' } }), 'set.otel-prompts'), [])
  assert.deepEqual(one(settingsCheck({ env: { OTEL_LOG_USER_PROMPTS: '1' } }), 'set.otel-prompts').map((f) => f.detail), ['OTEL_LOG_USER_PROMPTS is set in the environment.'])
  writeSettings({ env: { OTEL_LOG_TOOL_DETAILS: '1' } })
  assert.match(one(settingsCheck(), 'set.otel-prompts')[0].detail, /^OTEL_LOG_TOOL_DETAILS is set in .*settings\.json\.$/)
})

test('Codex: approval "never", full access, network in the sandbox, and a full history, at the top or in a profile', () => {
  freshState()
  writeSettings({})
  assert.deepEqual(rules(settingsCheck()).filter((r) => r.startsWith('codex.')), [])
  const toml = join(process.env.CODEX_HOME, 'config.toml')
  writeFileSync(toml, 'model = "gpt-6"\napproval_policy = "never" # no questions\nsandbox_mode = "danger-full-access"\n\n[sandbox_workspace_write]\nnetwork_access = true\n\n[history]\npersistence = "save-all"\n')
  const found = settingsCheck().filter((f) => f.rule.startsWith('codex.'))
  assert.deepEqual(found.map((f) => [f.rule, f.severity]), [['codex.approval-never', 'high'], ['codex.full-access', 'high'], ['codex.network', 'medium'], ['codex.history', 'low']])
  assert.match(found[0].detail, /^approval_policy is "never" at the top of .*config\.toml\.$/)
  writeFileSync(toml, 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\nsandbox_workspace_write.network_access = false\n[history]\npersistence = "none"\n[profiles.fast]\napproval_policy = "never"\n')
  const again = settingsCheck().filter((f) => f.rule.startsWith('codex.'))
  assert.deepEqual(again.map((f) => f.rule), ['codex.approval-never'])
  assert.match(again[0].detail, /in the profile fast of /)
  assert.deepEqual(readToml('a.b = true\n[[x]]\nc = 1\n').tables, { a: { b: true } })
})

test('a run of the settings check keeps the findings of another project\'s files open, and resolves them once their folder is gone', () => {
  freshState()
  writeSettings({ sandbox: { enabled: true }, cleanupPeriodDays: 7, desktopSessionCleanupPeriodDays: 7, permissions: { deny: actions.SECRET_DENY } })
  const a = repo()
  const b = repo()
  mkdirSync(join(a, '.claude'))
  writeFileSync(join(a, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }))
  security.runSettings({ cwd: a, now: NOW })
  assert.equal(readFindings().filter((f) => f.status === 'open' && f.rule === 'set.allow-any-shell').length, 1)
  // A session in another project: the finding of the first one stays open.
  security.runSettings({ cwd: b, now: NOW + 1000 })
  assert.equal(readFindings().find((f) => f.rule === 'set.allow-any-shell').status, 'open')
  // Fixed in the first project: resolved.
  writeFileSync(join(a, '.claude', 'settings.json'), '{}')
  security.runSettings({ cwd: a, now: NOW + 2000 })
  assert.equal(readFindings().find((f) => f.rule === 'set.allow-any-shell').status, 'resolved')
})

// The actions.

const matched = (command) => shellCommands(command).flatMap(commandRules).map(([rule]) => rule)

test('the commands of the action rules match, and near misses do not', () => {
  const cases = {
    'act.force-push': {
      hit: ['git push --force', 'git push -f origin main', 'git push origin main --force', 'git -C ../x push --force', 'git push -uf origin x', 'cd app && git push --force', 'FOO=1 git push --force'],
      miss: ['git commit -m "do not use --force"', 'echo git push --force', 'grep -- --force notes.txt', 'npm install --force', 'git fetch -f', 'git push --force-with-lease', "git log --grep '--force'"],
    },
    'act.no-verify': {
      hit: ['git commit --no-verify -m x', 'git commit -nm "x"', 'git push --no-verify'],
      miss: ['git push -n', 'git commit -m "--no-verify"', 'npm run lint -- --no-verify', 'echo git commit --no-verify'],
    },
    'act.send-out': {
      hit: ['curl -T backup.tgz https://x.example', 'curl --upload-file f https://x', 'curl -d @data.json https://x', 'curl --data-binary @f https://x', 'curl -d@f https://x', 'curl -F file=@x https://x', 'curl -sF a=b https://x', 'scp f host:/tmp', 'rsync -av dist/ deploy@host:/srv', 'nc host 80', 'sudo -u web curl -T f https://x'],
      miss: ['curl -d "a=b" https://x', 'curl https://x', 'curl -fsSL https://x | sh', 'rsync -av a/ b/', 'echo scp f host:', 'git commit -m "curl -T"'],
    },
    'act.destroy': {
      hit: ['terraform destroy', 'terraform apply -destroy', 'tofu destroy -auto-approve', 'kubectl delete pod x', 'kubectl -n prod delete deploy y', 'aws ec2 delete-volume --volume-id v', 'aws --profile work s3 rm s3://b/k', 'aws s3api put-bucket-acl --bucket b', 'gcloud compute instances delete vm', 'vercel --prod', 'vercel rm app', 'npx prisma migrate reset', 'dropdb app', 'sudo terraform destroy'],
      miss: ['terraform plan', 'kubectl get pods', 'aws s3 ls', 'aws --profile delete-me s3 ls', 'vercel', 'vercel deploy', 'prisma migrate dev', 'echo terraform destroy', 'git commit -m "terraform destroy"', 'gcloud compute instances list'],
    },
  }
  for (const [rule, { hit, miss }] of Object.entries(cases)) {
    for (const c of hit) assert.ok(matched(c).includes(rule), `${rule} should match: ${c}`)
    for (const c of miss) assert.ok(!matched(c).includes(rule), `${rule} should not match: ${c}`)
  }
})

test('the actions of a session: secret files read, an agent\'s own config changed, and commands, with paths in the repository and no command text', () => {
  freshState()
  const root = repo()
  const forced = bash('git push --force origin MARKER-BRANCH-NAME', 'dup')
  const file = log([
    assistant([use('Read', { file_path: join(root, '.env') }), use('Read', { file_path: join(root, '.env.example') })], '2026-11-14T10:00:00Z'),
    assistant([use('Read', { file_path: join(root, 'keys', 'id_rsa.pub') }), use('Read', { file_path: join(process.env.HOME, '.aws', 'credentials') })]),
    assistant([bash('cat config/.env.local | head -3'), bash('tail -f server.log')]),
    assistant([use('Edit', { file_path: join(root, '.claude', 'settings.json'), old_string: 'a', new_string: 'b' }), use('Write', { file_path: join(root, 'src', 'app.js'), content: 'x' })]),
    assistant([use('Write', { file_path: join(root, '.mcp.json'), content: '{}' })]),
    assistant([forced], '2026-11-14T10:30:00Z'),
    // The same line twice in the log is one tool call.
    assistant([forced], '2026-11-14T10:30:00Z'),
    assistant([bash('git push -f origin other-MARKER')], '2026-11-14T10:45:00Z'),
    assistant([bash('git commit -m "terraform destroy is in the message only"')]),
  ])
  const found = checkActions({ transcript: file, session: 's-1', repo: root })
  const byRule = (rule) => found.filter((f) => f.rule === rule)
  assert.deepEqual(byRule('act.read-secret-file').map((f) => f.where.file).sort(), ['.env', 'config/.env.local', '~/.aws/credentials'])
  assert.deepEqual(byRule('act.self-config').map((f) => f.where.file).sort(), ['.claude/settings.json', '.mcp.json'])
  const [push] = byRule('act.force-push')
  assert.match(push.detail, /^git push --force: 2 times in this session, the last at \d\d:\d\d\.$/)
  assert.equal(push.where.repo, root)
  assert.equal(push.scope, 'session:s-1')
  assert.deepEqual(byRule('act.destroy'), [])
  saveFindings(found, { scope: 'session:s-1', kind: 'actions', now: NOW })
  // No command, no other text of the log, is in a file of Widal.Code's.
  const kept = allText(process.env.WIDAL_HOME)
  for (const text of ['MARKER', 'origin', 'head -3', 'server.log', 'message only']) assert.ok(!kept.includes(text), text)
})

test('a read or an edit that was denied or failed is no finding; a shell command that failed still is', () => {
  freshState()
  const root = repo()
  const denied = (id) => user([{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Permission to read this file was denied.' }])
  const file = log([
    assistant([use('Read', { file_path: join(root, '.env') }, 'r-denied')]),
    denied('r-denied'),
    assistant([use('Edit', { file_path: join(root, '.mcp.json'), old_string: 'a', new_string: 'b' }, 'e-failed')]),
    denied('e-failed'),
    assistant([bash('terraform destroy -auto-approve', 'b-failed')]),
    denied('b-failed'),
  ])
  const rules = checkActions({ transcript: file, session: 's-2', repo: root }).map((f) => f.rule)
  assert.deepEqual(rules, ['act.destroy'])
  // A later read of the same file that worked counts once.
  const again = log([
    assistant([use('Read', { file_path: join(root, '.env') }, 'r-1')]),
    denied('r-1'),
    assistant([use('Read', { file_path: join(root, '.env') }, 'r-2')]),
    result('r-2', 'the file'),
  ])
  const [read] = checkActions({ transcript: again, session: 's-3', repo: root })
  assert.equal(read.rule, 'act.read-secret-file')
  assert.match(read.detail, /^once in this session/)
})

// The code.

test('the code rules with Widal.Code\'s own patterns, and none of the matches in a file of Widal.Code\'s', () => {
  freshState()
  saveConfig({ security: { frameworks: ['hipaa', 'pci'] } })
  const root = repo({
    'src/keys.py': [`aws = "${AWS_KEY}"`, PRIVATE_KEY, `gh = "${GITHUB_TOKEN}"`, `a = "${ANTHROPIC_KEY}"`, `o = "${OPENAI_KEY}"`, `s = "${SLACK_TOKEN}"`].join('\n'),
    'src/client.py': 'requests.get(url, verify=False)\nprint("MARKER-PHI", patient.date_of_birth)\nprint(total)\n',
    'src/server.js': 'https.request({ rejectUnauthorized: false })\nprocess.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"\n',
    'main.go': 'cfg := &tls.Config{InsecureSkipVerify: true}\n',
    'deploy.sh': 'curl -sk https://example.com/install\ncurl https://example.com\necho "curl -k is bad"\n',
    'src/pay.js': `const card = "${CARD}"\nconst ts = 1794671775000\n`,
    'test/fixtures/cards.json': `{ "card": "${CARD}" }\n`,
    'config/app.yaml': 'api: http://api.example.com/v1\nlocal: http://localhost:3000\nschema: http://www.w3.org/2001/XMLSchema\n',
  })
  const r = security.runTurn({ cwd: root, now: NOW, env: { PATH: programs() } })
  const found = r.code
  const at = (rule) => found.filter((f) => f.rule === rule).map((f) => `${f.where.file}:${f.where.line}`).sort()
  assert.deepEqual(found.filter((f) => f.rule === 'code.secret').map((f) => f.detail.replace(/^The kind of key: (.*)\. Found by Widal.Code's own patterns\.$/, '$1')).sort(), ['AWS access key id', 'Anthropic API key', 'GitHub token', 'OpenAI API key', 'Slack token', 'private key'])
  assert.deepEqual(at('code.tls-off'), ['deploy.sh:1', 'main.go:1', 'src/client.py:1', 'src/server.js:1', 'src/server.js:2'])
  assert.deepEqual(at('code.phi-log'), ['src/client.py:2'])
  assert.deepEqual(at('code.card-number'), ['src/pay.js:1'])
  assert.deepEqual(at('code.http'), ['config/app.yaml:1'])
  assert.ok(found.every((f) => f.source === 'kestrel' && f.scope === `repo:${root}` && f.where.repo === root))
  assert.deepEqual(r.scanners, ["Widal.Code's own rules"])
  // The controls are those of the frameworks that are on.
  assert.deepEqual(found.find((f) => f.rule === 'code.card-number').controls.map((c) => `${c.framework} ${c.id}`), ['pci 3'])
  const kept = allText(process.env.WIDAL_HOME)
  for (const text of [AWS_KEY, GITHUB_TOKEN, ANTHROPIC_KEY, OPENAI_KEY, SLACK_TOKEN, 'PRIVATE KEY', CARD, 'MARKER-PHI', 'date_of_birth', 'api.example.com/v1']) assert.ok(!kept.includes(text), text)
})

test('the patient field and the card number are checked only while their frameworks are on', () => {
  freshState()
  const root = repo({ 'a.py': `logger.info(patient_name)\nx = "${CARD}"\n` })
  assert.deepEqual(rules(security.runTurn({ cwd: root, now: NOW, env: { PATH: programs() } }).code), [])
  saveConfig({ security: { frameworks: ['gdpr'] } })
  assert.deepEqual(rules(security.runTurn({ cwd: root, now: NOW, env: { PATH: programs() } }).code), ['code.phi-log'])
  // The repository's own file of frameworks wins over the person's.
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude', 'loobster-frameworks.json'), JSON.stringify({ frameworks: ['pci'] }))
  assert.deepEqual(rules(security.runTurn({ cwd: root, now: NOW, env: { PATH: programs() } }).code), ['code.card-number'])
})

test('Widal.Code\'s own rules for Terraform', () => {
  const tf = `resource "aws_s3_bucket" "logs" {
  bucket = "logs"
  acl    = "public-read"
}
resource "aws_security_group" "web" {
  ingress {
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 22
    to_port     = 22
    cidr_blocks = ["0.0.0.0/0"] # "}" in a comment
  }
}
resource "aws_db_instance" "db" {
  publicly_accessible = true
  storage_encrypted   = false
}
`
  assert.deepEqual(terraformRules(tf).map(([check, line, , severity]) => [check, line, severity]), [
    ['s3-public-acl', 3, 'high'], ['s3-no-encryption', 1, 'medium'], ['sg-open', 11, 'high'], ['db-public', 18, 'high'], ['storage-unencrypted', 19, 'medium'],
  ])
  const safe = 'resource "aws_s3_bucket" "b" {\n  bucket = "b"\n}\nresource "aws_s3_bucket_server_side_encryption_configuration" "e" {\n  bucket = aws_s3_bucket.b.id\n}\nresource "aws_security_group_rule" "r" {\n  type = "ingress"\n  from_port = 80\n  to_port = 80\n  cidr_blocks = ["0.0.0.0/0"]\n}\n'
  assert.deepEqual(terraformRules(safe), [])
})

// The JSON that each scanner prints, in the shape of its documentation (and, for gitleaks, of a real run on a made-up file).
const CHECKOV_JSON = JSON.stringify({
  check_type: 'terraform',
  results: {
    passed_checks: [],
    failed_checks: [
      { check_id: 'CKV_AWS_20', check_name: 'S3 Bucket has an ACL defined which allows public READ access.', check_result: { result: 'FAILED' }, code_block: [[3, 'acl = "public-read" MARKER-CODE']], file_path: '/main.tf', file_line_range: [1, 4], resource: 'aws_s3_bucket.logs', severity: null, guideline: 'https://docs.example.com' },
      { check_id: 'CKV_AWS_24', check_name: 'Ensure no security groups allow ingress from 0.0.0.0:0 to port 22', check_result: { result: 'FAILED' }, file_path: '/main.tf', file_line_range: [5, 12], resource: 'aws_security_group.web', severity: 'HIGH' },
    ],
    skipped_checks: [],
    parsing_errors: [],
  },
  summary: { passed: 0, failed: 2, skipped: 0, parsing_errors: 0, resource_count: 2, checkov_version: '3.2.0' },
})
const TRIVY_JSON = JSON.stringify({
  SchemaVersion: 2, ArtifactName: 'main.tf', ArtifactType: 'filesystem',
  Results: [{ Target: 'main.tf', Class: 'config', Type: 'terraform', MisconfSummary: { Successes: 1, Failures: 1 },
    Misconfigurations: [
      { Type: 'Terraform Security Check', ID: 'AVD-AWS-0086', AVDID: 'AVD-AWS-0086', Title: 'S3 Access block should block public ACL', Message: 'MARKER-MESSAGE', Severity: 'HIGH', Status: 'FAIL', CauseMetadata: { Resource: 'aws_s3_bucket.logs', Provider: 'AWS', Service: 's3', StartLine: 1, EndLine: 4, Code: { Lines: [{ Number: 1, Content: 'MARKER-CODE' }] } } },
      { Type: 'Terraform Security Check', ID: 'AVD-AWS-0088', Title: 'Bucket has encryption', Severity: 'LOW', Status: 'PASS' },
    ] }],
})
const KICS_JSON = JSON.stringify({
  kics_version: 'v2.1.0', files_scanned: 1, lines_scanned: 20, files_parsed: 1, queries_total: 1, queries_failed_to_execute: 0,
  queries: [{ query_name: 'S3 Bucket ACL Allows Read Or Write to All Users', query_id: '38c5ee0d-7f22-4260-ab72-5073048df100', severity: 'CRITICAL', platform: 'Terraform', category: 'Access Control',
    files: [{ file_name: 'main.tf', similarity_id: 'abc', line: 3, issue_type: 'IncorrectValue', search_key: 'aws_s3_bucket[logs].acl', expected_value: 'private', actual_value: 'MARKER-ACTUAL' }] }],
  severity_counters: { CRITICAL: 1, HIGH: 0, INFO: 0, LOW: 0, MEDIUM: 0, TRACE: 0 }, total_counter: 1,
})
const GITLEAKS_JSON = JSON.stringify([{ RuleID: 'aws-access-token', Description: 'Identified a pattern that may indicate AWS credentials.', StartLine: 2, EndLine: 2, StartColumn: 7, EndColumn: 26, Match: 'REDACTED', Secret: 'REDACTED', File: 'keys.py', SymlinkFile: '', Commit: '', Entropy: 3.88, Author: '', Email: '', Date: '', Message: '', Tags: [], Fingerprint: 'keys.py:aws-access-token:2' }])
const TF = 'resource "aws_s3_bucket" "logs" {\n  bucket = "logs"\n  acl    = "public-read"\n}\n'

test('a scanner stand-in for Checkov, Trivy, KICS and gitleaks: its findings, its severity, its name, and nothing of what it matched', () => {
  freshState()
  const root = repo({ 'main.tf': TF, 'keys.py': `x = 1\naws = "${AWS_KEY}"\n`, 'src/app.js': 'const a = 1\n' })
  const iac = (scripts) => security.runTurn({ cwd: root, now: NOW, env: { PATH: programs(scripts) } }).code.filter((f) => f.rule === 'code.iac')
  const checkov = iac({ checkov: printing(CHECKOV_JSON, 1) })
  // Checkov gives no severity without its platform: medium then.
  assert.deepEqual(checkov.map((f) => [f.source, f.severity, f.where.line, f.detail]), [
    ['checkov', 'medium', 1, 'S3 Bucket has an ACL defined which allows public READ access (CKV_AWS_20), found by Checkov.'],
    ['checkov', 'high', 5, 'Ensure no security groups allow ingress from 0.0.0.0:0 to port 22 (CKV_AWS_24), found by Checkov.'],
  ])
  const trivy = iac({ trivy: printing(TRIVY_JSON) })
  assert.deepEqual(trivy.map((f) => [f.source, f.severity, f.where.line, f.detail]), [['trivy', 'high', 1, 'S3 Access block should block public ACL (AVD-AWS-0086), found by Trivy.']])
  const kics = iac({ kics: `out=""\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\nprintf '%s\\n' '${KICS_JSON}' > "$out/results.json"\nexit 60` })
  assert.deepEqual(kics.map((f) => [f.source, f.severity, f.where.file, f.where.line]), [['kics', 'high', 'main.tf', 3]])
  // The first one found counts: Checkov before Trivy.
  assert.deepEqual([...new Set(iac({ checkov: printing(CHECKOV_JSON, 1), trivy: printing(TRIVY_JSON) }).map((f) => f.source))], ['checkov'])
  // gitleaks: the secret findings are its own, and Widal.Code's patterns do not run on the files it checked.
  const r = security.runTurn({ cwd: root, now: NOW, env: { PATH: programs({ gitleaks: `case "$*" in *keys.py*) printf '%s\\n' '${GITLEAKS_JSON}'; exit 1;; *) echo '[]';; esac` }) } })
  assert.deepEqual(r.code.filter((f) => f.rule === 'code.secret').map((f) => [f.source, f.where.file, f.where.line, f.detail]), [['gitleaks', 'keys.py', 2, 'The kind of key: AWS access key id. Found by gitleaks.']])
  assert.ok(r.scanners.includes('gitleaks'))
  const kept = allText(process.env.WIDAL_HOME)
  for (const text of ['MARKER', AWS_KEY, 'code_block', 'REDACTED']) assert.ok(!kept.includes(text), text)
})

test('a scanner that runs past the time limit is stopped, and Widal.Code\'s own rules stand in', () => {
  freshState()
  const root = repo({ 'main.tf': TF })
  const start = Date.now()
  const r = checkCode({ root, env: { PATH: programs({ checkov: 'while :; do :; done' }) }, limits: { files: 200, bytes: 2 * 1024 * 1024, ms: 300 } })
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`)
  assert.deepEqual(r.findings.map((f) => [f.rule, f.source, f.detail.split(',')[0]]).sort(), [['code.iac', 'kestrel', 'An S3 bucket has a public ACL'], ['code.iac', 'kestrel', 'An S3 bucket has no encryption set']])
  // A slow gitleaks: the files it did not reach get Widal.Code's own patterns.
  const keys = repo({ 'k.py': `aws = "${AWS_KEY}"\n` })
  const slow = checkCode({ root: keys, env: { PATH: programs({ gitleaks: 'while :; do :; done' }) }, limits: { files: 200, bytes: 2 * 1024 * 1024, ms: 300 } })
  assert.deepEqual(slow.findings.map((f) => [f.rule, f.source]), [['code.secret', 'kestrel']])
})

test('the file limits: at most so many files, none above the size, no binary file, nothing below node_modules', () => {
  freshState()
  const root = repo({
    'a.py': 'requests.get(u, verify=False)\n', 'b.py': 'requests.get(u, verify=False)\n', 'c.py': 'requests.get(u, verify=False)\n',
    'big.py': `requests.get(u, verify=False)\n${'#'.repeat(200)}\n`, 'node_modules/x/index.js': 'rejectUnauthorized: false\n',
  })
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0x76, 0x65, 0x72, 0x00, 0x69, 0x66, 0x79]))
  const r = checkCode({ root, env: { PATH: programs() }, limits: { files: 4, bytes: 100, ms: 1000 } })
  // Sorted, the first four are a.py, b.py, big.py and bin.dat. The large and the binary one are left out, and c.py is beyond the limit.
  assert.deepEqual(r.findings.map((f) => f.where.file).sort(), ['a.py', 'b.py'])
  assert.equal(r.files, 2)
  assert.equal(r.skipped, 3)
})

// The data of a session.

test('the data check is off until it is switched on, and keeps the kind and the count only', () => {
  freshState()
  const root = repo()
  const transcript = log([
    user(`my number is ${SSN} and the card ${CARD.replace(/(\d{4})/g, '$1 ').trim()}`),
    assistant([use('Read', { file_path: join(root, 'notes.txt') }, 'r1')]),
    result('r1', `aws = ${AWS_KEY} and again ${AWS_KEY}, and ${SSN}`),
  ], 'data-session')
  const off = security.runTurn({ session: 'data-session', transcript, cwd: root, now: NOW, env: { PATH: programs() } })
  assert.equal(off.data, undefined)
  assert.equal(readFindings().some((f) => f.kind === 'data'), false)
  setSetting('security.checks.data', 'on')
  writeSettings({ cleanupPeriodDays: 14 })
  const on = security.runTurn({ session: 'data-session', transcript, cwd: root, now: NOW, env: { PATH: programs() } }).data
  assert.deepEqual(on.map((f) => [f.rule, f.severity]), [['data.us-ssn', 'high'], ['data.card-number', 'high'], ['data.secret', 'high']])
  assert.match(on[0].detail, /^2 US social security numbers in the user messages and tool results of this session\. The transcript holds them in plain text at .*data-session\.jsonl\. Claude Code keeps it for 14 days \(cleanupPeriodDays\)\. Shorten that with: widal apply transcript-days$/)
  assert.match(on[2].detail, /^2 secret keys \(AWS access key id\) in the user/)
  assert.deepEqual(on[0].fix, { action: 'transcript-days', words: 'widal apply transcript-days' })
  const kept = allText(process.env.WIDAL_HOME)
  for (const text of [SSN, CARD, '4111 1111', AWS_KEY, 'my number']) assert.ok(!kept.includes(text), text)
})

test('the log checks read the whole log: a prompt at the start of a long session counts, and a letter across the end of a piece of 1 MB stays whole', async () => {
  freshState()
  const { checkData, logLines } = await import('../src/check-log.mjs')
  // The first prompt, then 3 MB of tool results, so the prompt is far before the last 256 KB.
  const filler = Array.from({ length: 30 }, (_, i) => result(`f${i}`, 'x'.repeat(100_000)))
  const transcript = log([user(`the test number is ${SSN}`), ...filler], 'long-session')
  assert.ok(statSync(transcript).size > 3_000_000)
  assert.deepEqual(checkData({ transcript, session: 'long-session' }).map((f) => f.rule), ['data.us-ssn'])
  // A line whose letter "é" (two bytes) sits on the end of the first piece of 1 MB.
  const head = JSON.stringify({ type: 'user', message: { role: 'user', content: '' } })
  // The text starts after the head without its last 3 bytes ("}}), so the first byte of "é" is the last byte of the piece.
  const pad = (1 << 20) - 1 - (Buffer.byteLength(head) - 3)
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: `${'a'.repeat(pad)}é` } })
  const file = log([line, user('end')], 'split-letter')
  const lines = [...logLines(file)]
  assert.equal(lines.length, 2)
  assert.ok(lines[0].message.content.endsWith('aé'))
  assert.deepEqual([...logLines(join(dir, 'no-such-log.jsonl'))], [])
})

// The hooks.

/** A stand-in for `spawn`: it notes each start and starts nothing. */
function spawner() {
  const starts = []
  const fn = (cmd, args, opts) => {
    starts.push({ cmd, args, opts })
    return { unref() {} }
  }
  fn.starts = starts
  return fn
}

test('the hook at a session\'s start starts the settings check in the background, at most once in 60 seconds, and not while it is off', () => {
  freshState()
  const s = spawner()
  assert.equal(security.sessionStartHook({ cwd: '/work/app', session_id: 'a' }, { now: NOW, spawner: s }), true)
  assert.deepEqual(s.starts.map((x) => [x.cmd, x.args.slice(1), x.opts]), [[process.execPath, ['security-run', '--what', 'settings', '--cwd', '/work/app'], { detached: true, stdio: 'ignore' }]])
  assert.equal(s.starts[0].args[0], WIDAL)
  assert.equal(security.sessionStartHook({ cwd: '/work/other' }, { now: NOW + 30e3, spawner: s }), false)
  assert.equal(security.sessionStartHook({ cwd: '/work/other' }, { now: NOW + 61e3, spawner: s }), true)
  assert.equal(security.sessionStartHook({ cwd: 'relative' }, { now: NOW + 200e3, spawner: s }), true)
  assert.deepEqual(s.starts.at(-1).args.slice(1), ['security-run', '--what', 'settings'])
  assert.equal(security.sessionStartHook({ cwd: '/work/app' }, { now: NOW + 400e3, spawner: s, cfg: { security: { checks: { settings: false } } } }), false)
  assert.equal(s.starts.length, 3)
})

test('the hook at the end of a turn starts the checks of the session and its repository in the background, at most once in 60 seconds per repository', () => {
  freshState()
  const a = repo()
  const b = repo()
  const s = spawner()
  const input = (cwd, id = 'sess-1') => ({ session_id: id, transcript_path: `/logs/${id}.jsonl`, cwd, hook_event_name: 'Stop', last_assistant_message: 'not read' })
  assert.equal(security.stopHook(input(a), { now: NOW, spawner: s }), true)
  assert.deepEqual(s.starts[0].args.slice(1), ['security-run', '--what', 'turn', '--cwd', a, '--session', 'sess-1', '--transcript', '/logs/sess-1.jsonl'])
  // The same repository soon after, also from another session: skipped. Another repository: started.
  assert.equal(security.stopHook(input(join(a), 'sess-2'), { now: NOW + 10e3, spawner: s }), false)
  assert.equal(security.stopHook(input(b), { now: NOW + 10e3, spawner: s }), true)
  assert.equal(security.stopHook(input(a), { now: NOW + 61e3, spawner: s }), true)
  // A session id that is not a plain name is not passed on.
  assert.equal(security.stopHook({ session_id: '../../x', transcript_path: '/logs/x.jsonl', cwd: a }, { now: NOW + 200e3, spawner: s }), true)
  assert.deepEqual(s.starts.at(-1).args.slice(1), ['security-run', '--what', 'turn', '--cwd', a])
  // All three checks off: nothing starts.
  assert.equal(security.stopHook(input(b), { now: NOW + 400e3, spawner: s, cfg: { security: { checks: { actions: false, code: false, data: false } } } }), false)
  assert.equal(s.starts.length, 4)
})

test('through the command, the hook at the end of a turn returns at once and prints nothing, while the checks finish in the background', async () => {
  freshState()
  const root = repo({ 'main.tf': TF })
  const transcript = log([assistant([bash('git push --force')])], 'bg-session')
  // A slow scanner stand-in: the background run takes 2 seconds or more, the hook does not wait for it.
  const path = cleanPath(programs({ checkov: `node -e 'setTimeout(() => {}, 2000)'\n${printing(CHECKOV_JSON, 1)}` }))
  const start = Date.now()
  const r = run(['hook', 'check-turn'], { cwd: root, path, input: JSON.stringify({ session_id: 'bg-session', transcript_path: transcript, cwd: root, hook_event_name: 'Stop' }) })
  const took = Date.now() - start
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''])
  assert.ok(took < 1800, `the hook took ${took} ms`)
  for (let i = 0; i < 100 && !readFindings().some((f) => f.kind === 'code'); i++) await new Promise((res) => setTimeout(res, 100))
  const found = readFindings()
  assert.deepEqual([...new Set(found.map((f) => `${f.kind} ${f.source}`))].sort(), ['actions kestrel', 'code checkov'])
  // The settings hook prints nothing either.
  assert.deepEqual(Object.values(run(['hook', 'check-settings'], { cwd: root, input: JSON.stringify({ cwd: root, source: 'startup' }) })), [0, '', ''])
})

/** A high finding of a kind in a repository, saved to the findings file. */
function highIn(root, kind = 'code', rule = 'code.secret', severity) {
  const scope = kind === 'code' ? `repo:${root}` : 'session:gate'
  const f = makeFinding(rule, { key: `${root}:x`, scope, where: { repo: root, file: 'x.py', line: 1 }, ...(severity && { severity }) })
  return saveFindings([f], { scope, kind: f.kind, now: NOW })
}

test('the gate asks before git push, gh pr create and gh pr merge only while a high finding of the code or the actions is open in that repository', () => {
  freshState()
  const root = repo()
  const other = repo()
  const ask = (command, cwd = root, cfg) => security.gateHook({ tool_name: 'Bash', tool_input: { command }, cwd }, cfg ? { cfg } : {})
  // No finding: nothing.
  assert.equal(ask('git push'), undefined)
  highIn(root, 'code', 'code.tls-off', 'medium')
  assert.equal(ask('git push'), undefined)
  highIn(root)
  const answer = ask('git push origin main')
  assert.deepEqual(answer, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Widal.Code: 1 high risk is open in this repository: A secret key is in the code. See them with widal check.' } })
  for (const command of ['gh pr create --fill', 'gh pr merge 12 --squash', 'npm test && git push']) assert.equal(ask(command)?.hookSpecificOutput.permissionDecision, 'ask', command)
  for (const command of ['git status', 'git commit -m "then git push"', 'echo git push', 'gh pr view 12', 'git pushd']) assert.equal(ask(command), undefined, command)
  // git's own options before "push", and the repository that -C or a cd names.
  for (const command of ['git -C . push', 'git -c http.extraHeader=x --no-pager push', `git -C ${root} push`, `cd ${root} && git push`]) assert.equal(ask(command, command.includes(root) ? other : root)?.hookSpecificOutput.permissionDecision, 'ask', command)
  for (const command of [`git -C ${other} push`, `cd ${other} && git push`, 'git -C . status', 'git -c push=x status']) assert.equal(ask(command), undefined, command)
  // Only in that repository, and also from a folder inside it.
  assert.equal(ask('git push', other), undefined)
  mkdirSync(join(root, 'src'), { recursive: true })
  assert.ok(ask('git push', join(root, 'src')))
  // A high finding of the actions counts too, and the reason names both.
  highIn(root, 'actions', 'act.destroy')
  assert.equal(ask('git push').hookSpecificOutput.permissionDecisionReason, 'Widal.Code: 2 high risks are open in this repository: An agent ran a command that deletes infrastructure or data, or deploys to production; A secret key is in the code. See them with widal check.')
  // A high finding of the settings does not count: it is not of this repository.
  freshState()
  saveFindings([makeFinding('set.bypass-mode', { key: 'x', scope: 'settings', where: { file: 'settings.json' } })], { scope: 'settings', kind: 'settings', now: NOW })
  assert.equal(ask('git push'), undefined)
  // Off: nothing. The key is security.checks.push, as the guide names it.
  highIn(root)
  assert.ok(ask('git push'))
  setSetting('security.checks.push', 'off')
  assert.equal(ask('git push'), undefined)
  // Other tools are left alone, and the gate never refuses.
  setSetting('security.checks.push', 'on')
  assert.equal(security.gateHook({ tool_name: 'Read', tool_input: { file_path: 'git push' }, cwd: root }), undefined)
  assert.doesNotMatch(readFileSync(join(ROOT, 'src', 'security.mjs'), 'utf8'), /permissionDecision: 'deny'/)
  // Through the command, as Claude Code runs it.
  const r = run(['hook', 'push-gate'], { cwd: root, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root, hook_event_name: 'PreToolUse' }) })
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask')
})

test('a broken findings file never breaks a hook or the status line', () => {
  freshState()
  const root = repo()
  mkdirSync(process.env.WIDAL_HOME, { recursive: true })
  writeFileSync(findingsFile(), '{ not json')
  assert.equal(security.gateHook({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root }), undefined)
  assert.equal(riskPart(root), undefined)
  for (const [hook, input] of [['push-gate', { tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root }], ['check-turn', { session_id: 'x', cwd: root }], ['check-settings', { cwd: root }]]) {
    assert.deepEqual(Object.values(run(['hook', hook], { cwd: root, input: JSON.stringify(input) })), [0, '', ''], hook)
    assert.deepEqual(Object.values(run(['hook', hook, '--plugin'], { cwd: root, input: 'not json' })), [0, '', ''], hook)
  }
  writeFileSync(findingsFile(), JSON.stringify({ findings: [{ id: 'x' }, 'y', null] }))
  assert.equal(riskPart(root), undefined)
  assert.equal(statusLine({ session_id: 'broken', cwd: root }, NOW, { color: false, layout: 'one' }).includes('risk'), false)
})

test('the plugin\'s security hooks do not act twice: silent while the settings hold the same hook or while turned off', () => {
  freshState()
  const root = repo()
  highIn(root)
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root })
  assert.notEqual(run(['hook', 'push-gate', '--plugin'], { cwd: root, input }).stdout, '')
  writeSettings({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${join(process.env.WIDAL_HOME, 'bin', 'widal')} hook push-gate`, timeout: 5 }] }] } })
  assert.equal(run(['hook', 'push-gate', '--plugin'], { cwd: root, input }).stdout, '')
  assert.notEqual(run(['hook', 'push-gate'], { cwd: root, input }).stdout, '')
  writeSettings({})
  assert.equal(run(['hooks', 'off', 'push-gate']).status, 0)
  assert.equal(run(['hook', 'push-gate', '--plugin'], { cwd: root, input }).stdout, '')
})

test('"widal connect" adds the three hooks, a change of the limit or of keep-warm keeps them, and "uninstall" takes them out', () => {
  const base = freshState()
  const home = join(base, 'person')
  mkdirSync(home, { recursive: true })
  const env = { HOME: home, USERPROFILE: home }
  writeSettings({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: '/x/other-stop.sh' }] }] } })
  const r = run(['connect'], { env })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^Added the hooks of the security checks to Claude Code: at the start of a session, at the end of a turn, and before a push\. See the findings with: widal check$/m)
  const link = join(process.env.WIDAL_HOME, 'bin', 'widal')
  const hook = (name) => ({ type: 'command', command: `${link} hook ${name}`, timeout: 5 })
  assert.deepEqual(readSettings().hooks, {
    Stop: [{ hooks: [{ type: 'command', command: '/x/other-stop.sh' }] }, { hooks: [hook('check-turn')] }],
    SessionStart: [{ hooks: [hook('check-settings')] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [hook('push-gate')] }],
  })
  assert.match(run(['connect'], { env }).stdout, /^The hooks of the security checks were already set\./m)
  // A limit adds its own hook and takes it out again, and the gate stays.
  assert.equal(run(['limit', '--session', '50'], { env }).status, 0)
  assert.equal(readSettings().hooks.PreToolUse.length, 2)
  assert.match(run(['doctor'], { env }).stdout, /^Claude Code limit hook +set$/m)
  assert.equal(run(['limit', '--off'], { env }).status, 0)
  assert.deepEqual(readSettings().hooks.PreToolUse, [{ matcher: 'Bash', hooks: [hook('push-gate')] }])
  assert.match(run(['doctor'], { env }).stdout, /^Claude Code limit hook +not set/m)
  assert.equal(run(['disconnect'], { env }).status, 0)
  assert.deepEqual(readSettings().hooks, { Stop: [{ hooks: [{ type: 'command', command: '/x/other-stop.sh' }] }] })
})

// The status line.

test('the status line shows a red part for high risks and a yellow one for medium risks of the settings and this repository, and nothing else', () => {
  freshState()
  const root = repo()
  const other = repo()
  const input = { session_id: 'risk', cwd: root, model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } }
  const one = () => statusLine(input, NOW, { color: false, layout: 'one', env: {} })
  assert.equal(riskPart(root), undefined)
  assert.doesNotMatch(one(), /risk/)
  // Of another repository, and of the cloud: not counted.
  highIn(other)
  saveFindings([{ id: 'cloud.x', rule: 'cloud.x', kind: 'cloud', severity: 'high', title: 'A bucket is public', scope: 'cloud:aws:1', where: { provider: 'aws', account: '1' } }], { scope: 'cloud:aws:1', kind: 'cloud', now: NOW })
  assert.equal(riskPart(root), undefined)
  highIn(root, 'code', 'code.tls-off', 'medium')
  assert.deepEqual(riskPart(root), ['1 medium risk', 'warn'])
  saveFindings([makeFinding('set.sandbox-off', { key: 'p', scope: 'settings' })], { scope: 'settings', kind: 'settings', now: NOW })
  assert.deepEqual(riskPart(join(root)), ['2 medium risks', 'warn'])
  saveFindings([makeFinding('set.sandbox-off', { key: 'p', scope: 'settings' }), makeFinding('set.bypass-mode', { key: 'q', scope: 'settings' })], { scope: 'settings', kind: 'settings', now: NOW })
  assert.deepEqual(riskPart(root), ['1 high risk', 'bad'])
  // The risks come first, so that a terminal that cuts the line at its end still shows them.
  assert.equal(one(), '1 high risk | $0.00 session (list prices) | today $0.00')
  // The lines: at the start of the line "session", in red.
  const lines = statusLine(input, NOW, { color: true, layout: 'lines', env: {}, spawn: () => ({ unref() {} }) }).split('\n')
  assert.ok(lines[0].startsWith(`\x1b[31m1 high risk\x1b[0m │ `), lines[0])
  // Resolved: gone again.
  saveFindings([], { scope: 'settings', kind: 'settings', now: NOW })
  assert.deepEqual(riskPart(root), ['1 medium risk', 'warn'])
})

test('with 500 findings the part of the status line takes well under 100 ms', () => {
  freshState()
  const root = repo()
  const many = Array.from({ length: 500 }, (_, i) => makeFinding('code.tls-off', { key: `${root}:f${i}.py:${i}`, scope: `repo:${root}`, where: { repo: root, file: `f${i}.py`, line: i + 1 }, detail: 'verify=False.' }))
  saveFindings(many, { scope: `repo:${root}`, kind: 'code', now: NOW })
  assert.equal(readFindings().length, 500)
  riskPart(root)
  const start = performance.now()
  for (let i = 0; i < 10; i++) assert.deepEqual(riskPart(root), ['500 high risks', 'bad'])
  const each = (performance.now() - start) / 10
  assert.ok(each < 25, `${each} ms per run`)
  // A whole run of the status line, after a first one that makes its folders.
  statusLine({ session_id: 'speed', cwd: root }, NOW, { color: false, layout: 'one', env: {} })
  const t = performance.now()
  assert.match(statusLine({ session_id: 'speed', cwd: root }, NOW, { color: false, layout: 'one', env: {} }), /500 high risks/)
  assert.ok(performance.now() - t < 100, `${performance.now() - t} ms`)
})

// "widal check".

test('"widal check": the frameworks that are on, the open findings by kind with their controls and fixes, and the sentence at the end; --json as the contract says', () => {
  freshState()
  saveConfig({ security: { frameworks: ['hipaa', 'soc2'] } })
  const root = repo()
  saveFindings([makeFinding('set.bypass-mode', { key: 'x', scope: 'settings', where: { file: '~/.claude/settings.json' }, frameworks: ['hipaa'] })], { scope: 'settings', kind: 'settings', now: NOW })
  highIn(root)
  saveFindings([makeFinding('code.http', { key: 'h', scope: `repo:${root}`, where: { repo: root, file: 'c.yaml', line: 2 } })], { scope: `repo:${root}`, kind: 'code', now: NOW + 1 })
  const text = run(['check'], { cwd: root }).stdout
  const lines = text.trimEnd().split('\n')
  assert.equal(lines[0], 'Frameworks that are on: HIPAA, SOC 2.')
  assert.ok(text.includes('\nOpen findings: 1 high, 0 medium, 1 low.\n'))
  assert.ok(text.indexOf('\nSettings\n') < text.indexOf('\nCode\n'))
  assert.ok(text.includes('  high    Claude Code may run tool calls without asking you\n          where: ~/.claude/settings.json\n          controls: HIPAA 164.312(a) Access control; SOC 2 CC6.1 Logical access security (id to check)\n          fix: widal apply no-bypass\n'))
  assert.ok(text.includes(`  low     A config file names a plain http:// address on another host\n          where: c.yaml:2, in ${root}\n`))
  assert.equal(lines.at(-1), 'Widal.Code checks technical controls and flags risks. It does not make a company compliant or certify it.')
  // The code findings of the repository with its own frameworks show those.
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude', 'loobster-frameworks.json'), JSON.stringify({ frameworks: ['pci'] }))
  const data = JSON.parse(run(['check', '--json'], { cwd: root }).stdout)
  assert.deepEqual(Object.keys(data), ['at', 'frameworks', 'counts', 'findings', 'note'])
  assert.deepEqual(data.frameworks, ['hipaa', 'soc2'])
  assert.deepEqual(data.counts, { high: 1, medium: 0, low: 1, info: 0 })
  assert.deepEqual(data.findings.map((f) => f.rule), ['set.bypass-mode', 'code.http'])
  assert.deepEqual(data.findings[1].controls.map((c) => `${c.framework} ${c.id}`), ['pci 4'])
  assert.equal(data.note, 'Widal.Code checks technical controls and flags risks. It does not make a company compliant or certify it.')
  assert.ok(Number.isFinite(data.at))
  assert.match(run(['check'], { cwd: root }).stdout, new RegExp(`\\nFor ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: PCI DSS, from .*loobster-frameworks\\.json\\.\\n`))
  assert.match(run(['help']).stdout, /^ {2}widal check \[--run\] \[--json\] {3}the open security findings/m)
})

test('"widal check --run" runs the settings, the actions of this folder\'s sessions and the code now', () => {
  freshState()
  const root = repo({ 'client.py': 'requests.get(u, verify=False)\n' })
  writeSettings({ permissions: { allow: ['Bash'] } })
  // A session of this folder, where Claude Code keeps its log.
  const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'run-session.jsonl'), `${assistant([use('Read', { file_path: join(root, '.env') })])}\n`)
  const r = run(['check', '--run'], { cwd: root })
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes(`The code: 1 changed file in ${root}, checked with Widal.Code's own rules.`), r.stdout)
  assert.ok(r.stdout.includes('The sessions: 1 of this folder in the last 7 days.'))
  assert.ok(r.stdout.includes('Off: data (widal settings set security.checks.<name> on).'))
  assert.deepEqual([...new Set(readFindings().map((f) => f.kind))].sort(), ['actions', 'code', 'settings'])
  for (const rule of ['set.allow-any-shell', 'act.read-secret-file', 'code.tls-off']) assert.ok(r.stdout.includes(RULES[rule].title), rule)
})

test('the desktop tool security_check shows the controls that "widal check" shows, from the rule and not from what was stored', () => {
  freshState()
  saveConfig({ security: { frameworks: ['hipaa'] } })
  const root = repo()
  // A finding as an older version stored it: no controls of its own.
  const f = { ...makeFinding('code.tls-off', { key: 't', scope: `repo:${root}`, where: { repo: root, file: 'app.py', line: 3 } }), controls: [] }
  saveFindings([f], { scope: `repo:${root}`, kind: 'code', now: NOW })
  const asks = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'security_check', arguments: {} } },
  ]
  const r = run(['desktop-mcp'], { input: `${asks.map((a) => JSON.stringify(a)).join('\n')}\n` })
  const answer = r.stdout.trim().split('\n').map((l) => JSON.parse(l)).find((m) => m.id === 2)
  const text = answer.result.content[0].text
  assert.match(text, /\n {2}Controls: HIPAA 164\.312\(e\) Transmission security/)
  const check = JSON.parse(run(['check', '--json']).stdout).findings[0].controls.map((c) => `${c.framework} ${c.id}`)
  assert.ok(check.includes('hipaa 164.312(e)'))
})

test('"widal check --export" writes the open and the resolved findings with their dates and controls, for an audit', () => {
  freshState()
  saveConfig({ security: { frameworks: ['hipaa'] } })
  const root = repo()
  highIn(root)
  saveFindings([makeFinding('code.tls-off', { key: 't', scope: `repo:${root}`, where: { repo: root, file: 'a, "b".py', line: 3 } })], { scope: `repo:${root}`, kind: 'code', now: NOW + 3600e3 })
  const file = join(dir, 'audit.csv')
  const r = run(['check', '--export', file])
  assert.equal(r.status, 0)
  assert.match(r.stdout, new RegExp(`^Wrote 2 findings, open and resolved, to ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d{4}-\\d\\d-\\d\\d\\)\\.\\nWidal.Code checks technical controls`))
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n')
  assert.equal(rows[0], 'id,rule,kind,severity,status,title,detail,where,controls,fix,source,first seen,last seen,resolved')
  assert.equal(rows.length, 4)
  assert.equal(rows[3], 'Widal.Code checks technical controls and flags risks. It does not make a company compliant or certify it.')
  assert.ok(rows[1].includes(',code.tls-off,code,high,open,The code turns off the check of TLS certificates,,"a, ""b"".py:3, in '))
  assert.ok(rows[1].includes(',HIPAA 164.312(e) Transmission security,,kestrel,2026-11-14T'))
  assert.ok(rows[2].includes(',code.secret,code,high,resolved,'))
  assert.match(rows[2], /,2026-11-14T\d\d:00:00\.000Z,2026-11-14T\d\d:00:00\.000Z,2026-11-14T\d\d:00:00\.000Z$/)
  assert.deepEqual(Object.values(run(['check', '--export'])).slice(0, 2), [1, ''])
  // A cell that a spreadsheet would run as a formula is kept as text.
  assert.deepEqual(['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', 'plain', ''].map(security.cell), [`"'=HYPERLINK(""x"")"`, "'+1", "'-2", "'@SUM(A1)", 'plain', ''])
})

// The fixes.

test('no-bypass: apply, undo, and the other settings stay; the finding resolves', () => {
  freshState()
  writeSettings({ theme: 'dark', skipDangerousModePermissionPrompt: true, permissions: { allow: ['Read'], defaultMode: 'bypassPermissions' } })
  security.runSettings({ now: NOW })
  assert.ok(readFindings().some((f) => f.rule === 'set.bypass-mode' && f.status === 'open'))
  const said = actions.apply('no-bypass', OWN, NOW)
  assert.equal(said[0], 'Sets "permissions.disableBypassPermissionsMode" to "disable" in Claude Code\'s settings, and takes out "skipDangerousModePermissionPrompt". Bypass mode, in which every tool call runs without a question, can then no longer start.')
  assert.deepEqual(readSettings(), { theme: 'dark', permissions: { allow: ['Read'], defaultMode: 'bypassPermissions', disableBypassPermissionsMode: 'disable' } })
  security.runSettings({ now: NOW + 1000 })
  assert.equal(readFindings().find((f) => f.rule === 'set.bypass-mode').status, 'resolved')
  assert.deepEqual(actions.apply('no-bypass', OWN, NOW), ['no-bypass is already applied.'])
  assert.deepEqual(actions.undo('no-bypass', OWN), ['no-bypass is taken back. Bypass mode can start again, as before.'])
  assert.deepEqual(readSettings(), { theme: 'dark', skipDangerousModePermissionPrompt: true, permissions: { allow: ['Read'], defaultMode: 'bypassPermissions' } })
  // Without "permissions" before, undo leaves none behind. A value changed by hand stays.
  writeSettings({ theme: 'light' })
  actions.apply('no-bypass', OWN, NOW)
  actions.undo('no-bypass', OWN)
  assert.deepEqual(readSettings(), { theme: 'light' })
  actions.apply('no-bypass', OWN, NOW)
  writeSettings({ ...readSettings(), permissions: { disableBypassPermissionsMode: 'other' } })
  assert.match(actions.undo('no-bypass', OWN).join('\n'), /^no-bypass is taken back, except for one setting\.\n"permissions\.disableBypassPermissionsMode" in Claude Code's settings was not put back/)
  // A backup of the file was saved before each change.
  assert.ok(readdirSync(join(process.env.WIDAL_HOME, 'backup')).length >= 3)
})

test('deny-secret-files: apply adds only the rules that are missing, undo takes out only those, and the other settings stay', () => {
  freshState()
  writeSettings({ theme: 'dark', permissions: { deny: ['Bash(rm -rf *)', 'Read(./.env)'], allow: ['Read'] } })
  actions.apply('deny-secret-files', OWN, NOW)
  assert.deepEqual(readSettings().permissions, { deny: ['Bash(rm -rf *)', 'Read(./.env)', 'Read(./.env.*)', 'Read(**/*.pem)', 'Read(**/id_rsa*)', 'Read(**/.aws/credentials)'], allow: ['Read'] })
  assert.deepEqual(one(settingsCheck(), 'set.no-secret-deny'), [])
  assert.deepEqual(actions.undo('deny-secret-files', OWN), ['deny-secret-files is taken back. The deny rules that this tool added are out. Your other rules stay.'])
  assert.deepEqual(readSettings(), { theme: 'dark', permissions: { deny: ['Bash(rm -rf *)', 'Read(./.env)'], allow: ['Read'] } })
  writeSettings({})
  actions.apply('deny-secret-files', OWN, NOW)
  actions.undo('deny-secret-files', OWN)
  assert.deepEqual(readSettings(), {})
  writeSettings({ permissions: { deny: 'all' } })
  assert.throws(() => actions.apply('deny-secret-files', OWN, NOW), /"permissions\.deny" in .* is not a list, so this tool does not change it\./)
  writeSettings({ permissions: [] })
  assert.throws(() => actions.apply('no-bypass', OWN, NOW), /"permissions" in .* is not an object/)
})

test('transcript-days: 7 days or --days, both keys, undo puts back what was there, and the other settings stay', () => {
  freshState()
  writeSettings({ theme: 'dark', cleanupPeriodDays: 30 })
  assert.deepEqual(actions.apply('transcript-days', OWN, NOW).slice(0, 1), ['Set "cleanupPeriodDays" and "desktopSessionCleanupPeriodDays" to 7 in Claude Code\'s settings. Claude Code deletes transcripts that are older than 7 days.'])
  assert.deepEqual(readSettings(), { theme: 'dark', cleanupPeriodDays: 7, desktopSessionCleanupPeriodDays: 7 })
  assert.deepEqual(one(settingsCheck({ frameworks: ['hipaa'] }), 'set.transcripts-kept'), [])
  actions.apply('transcript-days', OWN, NOW, ['--days', '3'])
  assert.deepEqual(readSettings(), { theme: 'dark', cleanupPeriodDays: 3, desktopSessionCleanupPeriodDays: 3 })
  assert.match(actions.undo('transcript-days', OWN)[0], /^transcript-days is taken back\./)
  assert.deepEqual(readSettings(), { theme: 'dark', cleanupPeriodDays: 30 })
  for (const bad of ['0', '366', 'week']) assert.throws(() => actions.apply('transcript-days', OWN, NOW, ['--days', bad]), /--days is a whole number of days from 1 to 365\./)
  assert.deepEqual(readSettings(), { theme: 'dark', cleanupPeriodDays: 30 })
  // Through the command: the reports' own --days must not take the option before "apply" sees it.
  const r = run(['apply', 'transcript-days', '--days', '14'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /to 14 in Claude Code's settings/)
  assert.deepEqual(readSettings(), { theme: 'dark', cleanupPeriodDays: 14, desktopSessionCleanupPeriodDays: 14 })
})

test('tools-unused: apply denies the named tools, a second apply adds to them, undo takes out only what it added', () => {
  freshState()
  writeSettings({ theme: 'dark', permissions: { deny: ['Read(./.env)', 'WebFetch'] } })
  assert.equal(actions.apply('tools-unused', OWN, NOW, ['--tools', 'Workflow,WebFetch'])[0], 'Added Workflow, WebFetch to "permissions.deny" in Claude Code\'s settings. New sessions start without those tools.')
  assert.deepEqual(readSettings().permissions.deny, ['Read(./.env)', 'WebFetch', 'Workflow'])
  assert.deepEqual(actions.apply('tools-unused', OWN, NOW, ['--tools', 'Workflow']), ['tools-unused is already applied.'])
  actions.apply('tools-unused', OWN, NOW, ['--tools', 'Task'])
  assert.deepEqual(readSettings().permissions.deny, ['Read(./.env)', 'WebFetch', 'Workflow', 'Task'])
  assert.deepEqual(actions.undo('tools-unused', OWN), ['tools-unused is taken back. The tools that this tool denied are allowed again. Your other rules stay.'])
  assert.deepEqual(readSettings(), { theme: 'dark', permissions: { deny: ['Read(./.env)', 'WebFetch'] } })
  writeSettings({})
  actions.apply('tools-unused', OWN, NOW, ['--tools', 'ListAgents'])
  actions.undo('tools-unused', OWN)
  assert.deepEqual(readSettings(), {})
  // Only the tools that the proposal knows: never Bash, Read or ToolSearch.
  for (const bad of ['Bash', 'ToolSearch', 'Workflow,Read', '']) assert.throws(() => actions.apply('tools-unused', OWN, NOW, ['--tools', bad]), /--tools takes a list of these tools/)
  assert.throws(() => actions.apply('tools-unused', OWN, NOW), /--tools takes a list of these tools/)
})
