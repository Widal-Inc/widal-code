// Tests for Widal.Code as a plugin for Claude Code and Cowork: the layout of the repo, the plugin's
// files, the hooks that the plugin carries, the setup from a plugin's folder, and the name line.
// With made-up home folders. Run: node --test
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-plugin-test-'))
// Widal.Code also reads the config folders of Claude Code in the home folder, so the home folder is a
// made-up one too.
process.env.HOME = join(dir, 'person')
process.env.WIDAL_HOME = join(dir, 'home')
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
// Cowork's folder too: without this a test would read the real Cowork logs of whoever runs it.
process.env.WIDAL_COWORK_DIR = join(dir, 'cowork')
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })

// The folder of the repo, which is also the folder of the plugin.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '')
const WIDAL = join(ROOT, 'cli', 'widal.mjs')

/** A JSON file of the repo as a value. */
const json = (...path) => JSON.parse(readFileSync(join(ROOT, ...path), 'utf8'))

/**
 * A made-up machine: the empty home folder of a person, below `name`. Returns the folder and a
 * function that runs the command there. The command gets nothing of the real environment but
 * the PATH. WIDAL_HOME is not set, so that the command looks for its folder in the home
 * folder, as it does on a real machine. `more` sets further variables for every run.
 *
 * `run` takes the arguments of the command, and then `bin` (the file to run, the command in the
 * repo unless another is given), `input` (what the command gets on stdin) and `env` (further
 * variables for this one run).
 */
function machine(name, more = {}) {
  const home = join(dir, name)
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), WIDAL_COWORK_DIR: join(home, 'cowork'), NO_COLOR: '1', ...more }
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true })
  // The command reaches into the home folder. A test must only ever reach the made-up one.
  assert.equal(spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'], { encoding: 'utf8', env }).stdout, home)
  const run = (args, { bin = WIDAL, input, env: forRun = {} } = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input, env: { ...env, ...forRun } })
  return { home, env, run }
}

/** The exit code of a run, and what it printed. */
const result = (r) => [r.status, r.stdout, r.stderr]

test('package.json names the package, its version and its command, and the tool has no dependencies', () => {
  const pkg = json('package.json')
  assert.equal(pkg.name, '@widal/widal-code')
  assert.equal(pkg.version, '0.3.2')
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  // The command, and for one release the command under the name before.
  assert.deepEqual(pkg.bin, { widal: 'cli/widal.mjs', kestrel: 'cli/kestrel.mjs' })
  assert.deepEqual(pkg.engines, { node: '>=22' })
  assert.deepEqual(pkg.scripts, { test: 'node --test', 'build:desktop': 'node scripts/build-desktop.mjs' })
  assert.equal(typeof pkg.description, 'string')
  assert.ok(pkg.description.length > 0)
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(pkg[key], undefined, key)
  // The files that "bin" names can be run as programs.
  for (const file of Object.values(pkg.bin)) {
    assert.ok(existsSync(join(ROOT, file)), file)
    assert.match(readFileSync(join(ROOT, file), 'utf8'), /^#!\/usr\/bin\/env node\n/, file)
    assert.ok(statSync(join(ROOT, file)).mode & 0o100, file)
  }
})

test('the repo has no top-level "bin" folder: the command and the files for its old names are in "cli"', () => {
  // Cowork does not install a plugin that has a top-level "bin" folder.
  assert.equal(existsSync(join(ROOT, 'bin')), false)
  assert.deepEqual(readdirSync(join(ROOT, 'cli')).sort(), ['agent-spend.mjs', 'kestrel.mjs', 'widal.mjs'])
})

/** The note on stderr for a command typed under an old name. */
const note = (old) => `${old} is now called widal. Type widal in place of ${old}. The name ${old} stops working with the next release.\n`

test('"widal --version" prints the version that package.json holds, also under the old names of the command, which add the note', () => {
  const m = machine('version')
  const { version } = json('package.json')
  assert.deepEqual(result(m.run(['--version'])), [0, `${version}\n`, ''])
  for (const old of ['kestrel', 'agent-spend']) assert.deepEqual(result(m.run(['--version'], { bin: join(ROOT, 'cli', `${old}.mjs`) })), [0, `${version}\n`, note(old)], old)
  // It reads nothing else and makes nothing: the home folder holds only what the test put there.
  assert.deepEqual(readdirSync(m.home), ['.claude'])
  assert.deepEqual(readdirSync(m.env.CLAUDE_CONFIG_DIR), [])
})

/** The link that puts the command on the PATH under a name, in a made-up home folder. */
const linkIn = (home, name) => join(home, '.local', 'bin', name)

/**
 * A machine with the two links on the PATH as an install made them before the command's files
 * moved from "bin" to "cli": each points at the file of its name in "bin" of this repo, which is
 * gone now.
 */
function linksToBin(name) {
  const m = machine(name)
  mkdirSync(join(m.home, '.local', 'bin'), { recursive: true })
  for (const command of ['kestrel', 'agent-spend']) symlinkSync(join(ROOT, 'bin', `${command}.mjs`), linkIn(m.home, command))
  return m
}

test('"migrate" and "connect" point both links on the PATH from the old "bin" folder at "cli", add the new name, and leave a link to another folder alone', () => {
  const cli = (command) => join(realpathSync(ROOT), 'cli', `${command}.mjs`)
  const pointed = (m, command) => `Pointed the command ${linkIn(m.home, command)} at ${cli(command)}, where the command's files are now.`
  const moved = linksToBin('links-migrate')
  const own = join(moved.home, '.widal', 'bin', 'widal')
  assert.deepEqual(result(moved.run(['migrate'])), [0, [
    `Made the link ${own} to ${cli('widal')}: Claude Code's settings call this tool through it.`,
    `Added the command ${linkIn(moved.home, 'widal')}, and left the old commands ${linkIn(moved.home, 'kestrel')} and ${linkIn(moved.home, 'agent-spend')} in place so that open sessions keep working.`,
    pointed(moved, 'kestrel'),
    pointed(moved, 'agent-spend'),
    '',
  ].join('\n'), ''])
  for (const command of ['widal', 'kestrel', 'agent-spend']) assert.equal(readlinkSync(linkIn(moved.home, command)), cli(command), command)
  // Each name runs the program again. The old names add the note.
  const version = `${json('package.json').version}\n`
  for (const command of ['widal', 'kestrel', 'agent-spend']) assert.deepEqual(result(moved.run(['--version'], { bin: linkIn(moved.home, command) })), [0, version, command === 'widal' ? '' : note(command)], command)
  // A second run finds nothing to change.
  assert.deepEqual(result(moved.run(['migrate'])), [0, 'Nothing was left to do.\n', ''])

  // "connect" runs the same steps first.
  const installed = linksToBin('links-install')
  const r = installed.run(['connect'])
  assert.deepEqual([r.status, r.stderr], [0, ''])
  assert.ok(r.stdout.includes(pointed(installed, 'agent-spend')))
  for (const command of ['widal', 'kestrel', 'agent-spend']) assert.equal(readlinkSync(linkIn(installed.home, command)), cli(command), command)

  // A link to the "bin" folder of another place is not this tool's. It stays, and the move says so.
  const other = machine('links-other')
  mkdirSync(join(other.home, '.local', 'bin'), { recursive: true })
  const elsewhere = join(dir, 'elsewhere', 'bin', 'kestrel.mjs')
  symlinkSync(elsewhere, linkIn(other.home, 'kestrel'))
  const left = `Another program named kestrel is at ${linkIn(other.home, 'kestrel')}, so it was left as it is, and this tool can be run as ${cli('widal')}.`
  assert.deepEqual(result(other.run(['migrate'])), [0, `${left}\nNothing was left to do.\n`, ''])
  assert.equal(readlinkSync(linkIn(other.home, 'kestrel')), elsewhere)

  // A link to the "bin" folder of another copy of this tool is this tool's: that folder's
  // package.json names this tool's package. It is pointed at the files of the tool that runs.
  const copy = machine('links-copy')
  mkdirSync(join(copy.home, '.local', 'bin'), { recursive: true })
  const checkout = join(dir, 'other-checkout')
  mkdirSync(checkout, { recursive: true })
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: '@widal/kestrel', version: '0.0.1' }))
  symlinkSync(join(checkout, 'bin', 'kestrel.mjs'), linkIn(copy.home, 'kestrel'))
  assert.equal(copy.run(['migrate']).status, 0)
  assert.equal(readlinkSync(linkIn(copy.home, 'kestrel')), cli('kestrel'))
})

/** The front matter of a Markdown file (the "key: value" lines between two lines of "---" at its top) as an object, and the text after it. */
function markdown(...path) {
  const text = readFileSync(join(ROOT, ...path), 'utf8')
  const [, head, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? []
  assert.ok(head, `${path.join('/')} has front matter`)
  const fields = Object.fromEntries(head.split('\n').map((line) => {
    const [, key, value] = /^([\w-]+): (.*)$/.exec(line)
    return [key, value.replace(/^'(.*)'$/, '$1')]
  }))
  return { fields, body }
}

// How a command file and the skill run the tool: node with the command's file in the plugin's folder.
const TOOL = 'node "${CLAUDE_PLUGIN_ROOT}/cli/widal.mjs"'

// The commands of the plugin, and the words each one gives the tool. "open" and "settings" open the
// Widal.Code pane where a mod can draw it. The mod answers them then, and these words run only where
// no pane can show (see pane.test.mjs).
const COMMANDS = { advise: 'advise', compactions: 'compactions', connect: 'connect', doctor: 'doctor', findings: 'findings', open: 'top --once --no-names', report: 'summary', session: 'session', settings: 'settings' }

test('the plugin\'s manifest and marketplace are valid, name files that exist, and carry the version of package.json', () => {
  const plugin = json('.claude-plugin', 'plugin.json')
  assert.equal(plugin.name, 'widal')
  // One place holds the version. The manifest has to say the same, or Claude Code would show another one.
  assert.equal(plugin.version, json('package.json').version)
  assert.match(plugin.description, /^[A-Z][^.]*\.$/)
  assert.deepEqual(plugin.author, { name: 'Widal, Inc.', email: 'hello@widal.com', url: 'https://code.widal.com' })
  assert.equal(plugin.license, 'MIT')
  assert.equal(plugin.repository, 'https://github.com/Widal-Inc/widal-code')
  assert.equal(plugin.icon, './assets/widal-code-512.png')
  assert.ok(existsSync(join(ROOT, plugin.icon)))

  const market = json('.claude-plugin', 'marketplace.json')
  assert.equal(market.name, 'widal')
  assert.deepEqual(market.owner, { name: 'Widal, Inc.', email: 'hello@widal.com' })
  assert.equal(market.plugins.length, 1)
  const [entry] = market.plugins
  // The entry's name is what the person installs: widal@widal. It has to be the manifest's name.
  assert.equal(entry.name, plugin.name)
  // The plugin's root is the repo's root.
  assert.equal(entry.source, './')
  assert.ok(existsSync(join(ROOT, entry.source, '.claude-plugin', 'plugin.json')))
  assert.equal(entry.version, undefined)
})

test('each command of the plugin runs the tool from the plugin\'s folder and asks for the output as it is', () => {
  // The command "hud" asks the model to pick a command, so it has a shape of its own. Its test is in hud.test.mjs.
  assert.deepEqual(readdirSync(join(ROOT, 'commands')).sort(), [...Object.keys(COMMANDS), 'hud'].sort().map((name) => `${name}.md`))
  for (const [name, words] of Object.entries(COMMANDS)) {
    const { fields, body } = markdown('commands', `${name}.md`)
    assert.deepEqual(Object.keys(fields).sort(), ['allowed-tools', 'description', 'disable-model-invocation'], name)
    assert.ok(fields.description.length > 20, name)
    // The person runs a command. The model does not start one on its own.
    assert.equal(fields['disable-model-invocation'], 'true', name)
    // The one shell command that the file runs is allowed, and nothing else.
    assert.equal(fields['allowed-tools'], `Bash(${TOOL} ${words})`, name)
    assert.equal(body, `\n!\`${TOOL} ${words}\`\n\nShow the output above to the person exactly as it is, in one code block. Add no summary and no comment.\n`, name)
  }
  // The file that the commands name is there, in the plugin's folder.
  assert.ok(existsSync(join(ROOT, 'cli', 'widal.mjs')))
})

test('each command line of the plugin runs in a made-up home folder and ends without an error', () => {
  for (const [name, words] of Object.entries(COMMANDS)) {
    const m = machine(`command-${name}`)
    const r = m.run(words.split(' '))
    assert.deepEqual([r.status, r.stderr], [0, ''], name)
    assert.ok(r.stdout.length > 0, name)
  }
})

test('the skill says when to use the tool, names only reports and the plugin\'s folder, and forbids reading a session log', () => {
  const { fields, body } = markdown('skills', 'widal', 'SKILL.md')
  assert.equal(fields.name, 'widal')
  assert.match(fields.description, /spend/)
  assert.match(fields.description, /how to spend less/)
  assert.match(body, /\*\*Never open, read or quote a session log\.\*\*/)
  assert.match(body, /The tool reads the logs itself and prints only numbers\./)
  // Every command it names is a report of the tool, run from the plugin's folder. The view of the
  // sessions that run now is named without the names of tasks.
  const named = [...body.matchAll(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/cli\/widal\.mjs" ([a-z]+(?: --[a-z-]+)*)`/g)].map(([, words]) => words)
  assert.deepEqual(named, ['summary', 'findings', 'session', 'models', 'compactions', 'advise', 'branches', 'tickets', 'accounts', 'top --once --no-names', 'doctor', 'check'])
  assert.equal(body.split('node "').length - 1, named.length)
})

test('no file of the tool holds an en dash or an em dash', () => {
  // The dashes are built from their codes, so that this file holds none either.
  const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)
  const files = ['package.json', 'README.md', '.claude-plugin', 'cli', 'commands', 'hooks', 'skills', 'src', 'test']
    .filter((path) => existsSync(join(ROOT, path)))
    .flatMap(walk)
    // Claude Code writes its type files for mods into .claude-plugin/types when it loads the plugin from this folder. They are not the tool's, and git ignores them.
    .filter((file) => !file.startsWith(join('.claude-plugin', 'types')))
  assert.ok(files.length > 30)
  for (const file of files) assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), dashes, file)
})

/** The files below a path of the repo, as paths in the repo. A path that is a file gives itself. */
function walk(path) {
  if (statSync(join(ROOT, path)).isFile()) return [path]
  return readdirSync(join(ROOT, path), { withFileTypes: true, recursive: true }).filter((f) => f.isFile()).map((f) => join(f.parentPath ?? f.path, f.name).slice(ROOT.length + 1))
}

// From here on: the hooks that the plugin carries.

// The plugin's hooks by name, with their events. The same as src/plugin.mjs, written out so that a change there is seen.
const PLUGIN_HOOKS = { 'compact-keep': 'PreCompact', 'cold-start': 'UserPromptSubmit', 'model-switch': 'PreModelSwitch' }

/** Each plugin hook in hooks/hooks.json, by the name of the hook in its command: its entry with its event and the matcher of its group. Each group holds one hook. */
function hookLines() {
  const { hooks } = json('hooks', 'hooks.json')
  return Object.fromEntries(Object.entries(hooks).flatMap(([event, groups]) => groups.map((group) => {
    assert.equal(group.hooks.length, 1, event)
    const [hook] = group.hooks
    assert.equal(hook.type, 'command', event)
    const name = / hook (\S+) --plugin/.exec(hook.command)?.[1]
    return [name, { ...hook, event, matcher: group.matcher }]
  })))
}

/** The text that the hook before a compaction prints when the person set none. */
const DEFAULT_KEEP = 'Keep what the person asked for and decided, the current plan with its open steps, the files that were changed, commands that have to be run again, and everything the person said not to do.'

/**
 * What each plugin hook is given, and how to tell that it acted. The hook for a sent prompt acts
 * only for a session whose cache has ended, so `ready` writes the file that the status line keeps
 * for such a session first. Each run needs a fresh one: the hook notes in it that it has warned.
 */
const HOOK_CASES = {
  'compact-keep': { input: '{}', acted: (out) => out === DEFAULT_KEEP },
  'cold-start': {
    input: JSON.stringify({ session_id: 'cold', prompt: 'a prompt' }),
    ready: (folder) => {
      mkdirSync(join(folder, 'sessions'), { recursive: true })
      writeFileSync(join(folder, 'sessions', 'cold.json'), JSON.stringify({ cacheUntil: Date.parse('2026-11-12T10:00:00'), ctx: 400000, recache: 400000, billing: 'subscription' }))
    },
    acted: (out) => /^widal: this session's cache ended at \d\d:\d\d\. This prompt sent 400k tokens again\./.test(JSON.parse(out).systemMessage),
  },
  'model-switch': {
    input: JSON.stringify({ estimated_cache_write_usd: 0.2, from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', context_tokens: 300000, pricing: 'catalog', source: 'picker' }),
    acted: (out) => /^widal: a switch from opus-5-5 to sonnet-5-5 sends the whole context/.test(JSON.parse(out).systemMessage),
  },
}

// The plugin's fourth hook: at the start of a session it keeps the stable copy at the plugin's version.
// The other three start the security checks and ask before a push (see test/security.test.mjs).
const ALL_HOOKS = { ...PLUGIN_HOOKS, 'refresh-copy': 'SessionStart', 'check-settings': 'SessionStart', 'check-turn': 'Stop', 'push-gate': 'PreToolUse', 'load-gate': 'PreToolUse' }

test('hooks/hooks.json carries the three hooks, the one for the stable copy, the three of the security checks and the check before a subagent starts, each calling the tool from the plugin\'s folder with its name and --plugin', () => {
  const lines = hookLines()
  // The keep-warm experiment is not in the plugin.
  assert.deepEqual(Object.keys(lines).sort(), Object.keys(ALL_HOOKS).sort())
  for (const [name, event] of Object.entries(ALL_HOOKS)) {
    assert.equal(lines[name].event, event, name)
    assert.equal(lines[name].command, `command -v node >/dev/null 2>&1 && node "\${CLAUDE_PLUGIN_ROOT}/cli/widal.mjs" hook ${name} --plugin 2>/dev/null; exit 0`, name)
    // A copy of a few files may take longer than a check.
    // The check before a subagent starts waits in a queue for up to 140 seconds.
    assert.equal(lines[name].timeout, name === 'refresh-copy' ? 10 : name === 'load-gate' ? 150 : 5, name)
    // A shell runs the line, so it has no "args".
    assert.equal(lines[name].args, undefined, name)
    // Only the two gates have a matcher: one runs before shell commands, the other before a subagent or a workflow starts.
    assert.equal(lines[name].matcher, { 'push-gate': 'Bash', 'load-gate': 'Agent|Task|Workflow' }[name], name)
  }
})

/** Runs a hook's command line through a shell, as Claude Code does, with the plugin's folder in CLAUDE_PLUGIN_ROOT. `path` is the PATH. */
function shellRun(m, command, { path, input }) {
  return spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', input, env: { ...m.env, PATH: path, CLAUDE_PLUGIN_ROOT: ROOT } })
}

test('each plugin hook\'s command line prints nothing and exits 0 where there is no node, and runs the tool where there is', () => {
  // A PATH with no program in it at all. The shell is started by its full path.
  const empty = mkdtempSync(join(tmpdir(), 'widal-code-no-node-'))
  const withNode = dirname(process.execPath)
  const lines = hookLines()
  for (const [name, event] of Object.entries(PLUGIN_HOOKS)) {
    const c = HOOK_CASES[name]
    const m = machine(`hook-line-${name}`)
    c.ready?.(join(m.home, '.widal'))
    assert.deepEqual(result(shellRun(m, lines[name].command, { path: empty, input: c.input })), [0, '', ''], name)
    const r = shellRun(m, lines[name].command, { path: withNode, input: c.input })
    assert.deepEqual([r.status, r.stderr], [0, ''], name)
    assert.ok(c.acted(r.stdout), `${name}: ${r.stdout}`)
  }
  // The hook at a session's start prints nothing in either case. That it runs the tool is in the tests of the stable copy.
  const m = machine('hook-line-refresh-copy')
  for (const path of [empty, withNode]) assert.deepEqual(result(shellRun(m, lines['refresh-copy'].command, { path, input: '{}' })), [0, '', ''], path)
})

test('a plugin hook does not act twice: it is silent when the settings hold the tool\'s own hook or when it is off, and acts otherwise', () => {
  for (const [name, event] of Object.entries(PLUGIN_HOOKS)) {
    const c = HOOK_CASES[name]
    // One made-up machine for each case, run through the command with --plugin.
    const run = (label, set = () => {}) => {
      const m = machine(`twice-${name}-${label}`)
      const folder = join(m.home, '.widal')
      c.ready?.(folder)
      set(m, folder)
      const r = m.run(['hook', name, '--plugin'], { input: c.input })
      assert.deepEqual([r.status, r.stderr], [0, ''], `${name} ${label}`)
      return r.stdout
    }
    const settings = (value) => (m) => writeFileSync(join(m.env.CLAUDE_CONFIG_DIR, 'settings.json'), typeof value === 'string' ? value : JSON.stringify(value))
    const withHook = (command) => settings({ hooks: { [event]: [{ hooks: [{ type: 'command', command, timeout: 5 }] }] } })
    // The settings hold the tool's own hook for that event, put there by "apply" or "connect": the plugin's hook is silent.
    assert.equal(run('own', (m) => withHook(`${join(m.home, '.widal', 'bin', 'widal')} hook ${name}`)(m)), '', name)
    // An entry from before a change of name is the tool's own as well.
    assert.equal(run('own-kestrel', (m) => withHook(`${join(m.home, '.kestrel', 'bin', 'kestrel')} hook ${name}`)(m)), '', name)
    assert.equal(run('own-old', (m) => withHook(`${linkIn(m.home, 'agent-spend')} hook ${name}`)(m)), '', name)
    // Only another tool's hook for that event: the plugin's hook acts.
    assert.ok(c.acted(run('other', withHook('/x/other-tool before'))), name)
    // The tool's own hook for another event does not count.
    assert.ok(c.acted(run('elsewhere', (m) => settings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `${join(m.home, '.widal', 'bin', 'widal')} hook ${name}` }] }] } })(m))), name)
    // No settings file: it acts.
    assert.ok(c.acted(run('none')), name)
    // Turned off by the person: it is silent.
    assert.equal(run('off', (m, folder) => {
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'config.json'), JSON.stringify({ pluginHooks: { [name]: false } }))
    }), '', name)
    // A broken settings file: it acts, and nothing is thrown.
    assert.ok(c.acted(run('broken', settings('{ not json'))), name)
  }
})

test('the plugin\'s hook before a compaction prints the default text when the tool\'s config is broken or its folder is missing', () => {
  const m = machine('keep-broken')
  mkdirSync(join(m.home, '.widal'))
  writeFileSync(join(m.home, '.widal', 'config.json'), '{ broken')
  assert.deepEqual(result(m.run(['hook', 'compact-keep', '--plugin'], { input: '{}' })), [0, DEFAULT_KEEP, ''])
  // The hook from the settings prints nothing then, so that the default never stands in for the person's own text without a word.
  assert.deepEqual(result(m.run(['hook', 'compact-keep'], { input: '{}' })), [0, '', ''])
  // No folder of the tool at all.
  const none = machine('keep-none')
  assert.deepEqual(result(none.run(['hook', 'compact-keep', '--plugin'], { input: '{}' })), [0, DEFAULT_KEEP, ''])
  assert.deepEqual(readdirSync(none.home), ['.claude'])
  // A hook name that the plugin does not carry prints nothing.
  assert.deepEqual(result(none.run(['hook', 'keep-warm', '--plugin'], { input: '{}' })), [0, '', ''])
})

test('"widal hooks" shows where each plugin hook runs from, and "hooks off" and "hooks on" keep the choice in the config', () => {
  const m = machine('hooks-command')
  const config = () => JSON.parse(readFileSync(join(m.home, '.widal', 'config.json'), 'utf8'))
  const shown = () => Object.fromEntries(m.run(['hooks']).stdout.split('\n').filter((line) => line.startsWith('  ')).map((line) => [line.trim().split(' ')[0], line.replace(/^ +\S+ +(before a compaction|when you send a prompt|before a change of model|when a session starts|when an agent's turn ends|before a shell command|before a subagent starts) +/, '')]))
  const ALL_PLUGIN = {
    'compact-keep': 'runs from the plugin', 'cold-start': 'runs from the plugin', 'model-switch': 'runs from the plugin',
    'check-settings': 'runs from the plugin', 'check-turn': 'runs from the plugin', 'push-gate': 'runs from the plugin',
    'load-gate': 'runs from the plugin',
  }
  // On by default.
  assert.deepEqual(shown(), ALL_PLUGIN)
  assert.match(m.run(['hooks']).stdout, /^The hooks that the plugin carries:\n\n {2}compact-keep +before a compaction +runs from the plugin\n/)
  assert.match(m.run(['hooks']).stdout, /\nTurn a plugin hook off with "widal hooks off <name>", and on with "widal hooks on <name>"\.\n$/)

  assert.deepEqual(result(m.run(['hooks', 'off', 'cold-start'])), [0, 'The plugin\'s hook cold-start is off.\n', ''])
  assert.deepEqual(config(), { pluginHooks: { 'cold-start': false } })
  assert.deepEqual(shown(), { ...ALL_PLUGIN, 'cold-start': 'off' })

  // A hook that "apply" put into the settings runs from there, whatever the plugin's hook does.
  assert.equal(m.run(['apply', 'compact-keep']).status, 0)
  assert.deepEqual(shown(), { ...ALL_PLUGIN, 'compact-keep': 'runs from Claude Code\'s settings', 'cold-start': 'off' })
  assert.deepEqual(result(m.run(['hooks', 'off', 'compact-keep'])), [0, 'The plugin\'s hook compact-keep is off.\nClaude Code\'s settings hold this hook too, and it runs from there. Take it out of the settings with: widal undo compact-keep\n', ''])
  assert.deepEqual(shown(), { ...ALL_PLUGIN, 'compact-keep': 'runs from Claude Code\'s settings', 'cold-start': 'off' })
  assert.equal(m.run(['undo', 'compact-keep']).status, 0)
  assert.deepEqual(shown(), { ...ALL_PLUGIN, 'compact-keep': 'off', 'cold-start': 'off' })

  assert.deepEqual(result(m.run(['hooks', 'on', 'cold-start'])), [0, 'The plugin\'s hook cold-start is on.\n', ''])
  assert.deepEqual(config().pluginHooks, { 'cold-start': true, 'compact-keep': false })
  assert.deepEqual(shown(), { ...ALL_PLUGIN, 'compact-keep': 'off' })

  // A name that is not one of the plugin's hooks, or a word that is neither on nor off, changes nothing.
  const how = 'widal: Use "widal hooks", "widal hooks off <name>" or "widal hooks on <name>". The names are: compact-keep, cold-start, model-switch, check-settings, check-turn, push-gate, load-gate.\n'
  for (const bad of [['off', 'keep-warm'], ['maybe', 'cold-start'], ['off'], ['off', 'cold-start', 'more']]) assert.deepEqual(result(m.run(['hooks', ...bad])), [1, '', how], bad.join(' '))
  assert.deepEqual(config().pluginHooks, { 'cold-start': true, 'compact-keep': false })
  assert.match(m.run(['help']).stdout, /^ {2}widal hooks off\|on <name> {6}turn one of them off or on$/m)
})

// From here on: the setup from a plugin's folder, and the stable copy of the tool.

/**
 * A plugin's folder as Claude Code installs it: a copy of the repo's files in
 * <Claude Code's folder>/plugins/cache/widal/widal/<version>, with that version in its
 * package.json and in its manifest.
 */
function pluginCache(m, ver = json('package.json').version, folder = join(m.env.CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'widal', 'widal', ver)) {
  mkdirSync(folder, { recursive: true })
  for (const name of ['cli', 'src', 'package.json', 'assets', 'hooks', '.claude-plugin', 'commands', 'skills']) cpSync(join(ROOT, name), join(folder, name), { recursive: true })
  for (const file of ['package.json', join('.claude-plugin', 'plugin.json')]) writeFileSync(join(folder, file), JSON.stringify({ ...JSON.parse(readFileSync(join(folder, file), 'utf8')), version: ver }, null, 2))
  return folder
}

/** Every file below a folder with its inode and the time it was last written: a second look tells whether anything was written again. */
const filesOf = (folder) => readdirSync(folder, { recursive: true, withFileTypes: true }).filter((f) => f.isFile()).map((f) => {
  const file = join(f.parentPath ?? f.path, f.name)
  return [file.slice(folder.length), statSync(file).ino, statSync(file).mtimeMs]
}).sort(([a], [b]) => (a < b ? -1 : 1))

/** The lines that a run printed. */
const linesOf = (r) => r.stdout.split('\n')

test('"connect" from a plugin\'s folder copies the tool to ~/.widal/app and links to the copy, and a second connect changes nothing', () => {
  const m = machine('plugin-install')
  const cache = pluginCache(m)
  const [app, own, path] = [join(m.home, '.widal', 'app'), join(m.home, '.widal', 'bin', 'widal'), linkIn(m.home, 'widal')]
  const command = join(app, 'cli', 'widal.mjs')
  const fromCache = (args) => m.run(args, { bin: join(cache, 'cli', 'widal.mjs') })
  const r = fromCache(['connect'])
  assert.deepEqual([r.status, r.stderr], [0, ''])
  assert.deepEqual(linesOf(r).slice(0, 4), [
    `Copied the tool to ${app}, because the plugin's own folder changes with every update.`,
    `Made the link ${own} to ${command}: Claude Code's settings call this tool through it.`,
    `The command is at ${path}.`,
    'The status line is set, with a refresh every 30 seconds. Open sessions show it after their next answer.',
  ])
  // The copy holds what the tool needs to run, and its command can be run as a program.
  assert.deepEqual(readdirSync(app).sort(), ['assets', 'cli', 'package.json', 'src'])
  assert.equal(statSync(command).mode & 0o111, 0o111)
  assert.equal(readlinkSync(path), command)
  assert.equal(readlinkSync(own), command)
  // The status line in the settings calls the link in the tool's folder, and nothing points into the plugin's folder.
  const settings = join(m.env.CLAUDE_CONFIG_DIR, 'settings.json')
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).statusLine.command, `${own} statusline`)
  assert.doesNotMatch(readFileSync(settings, 'utf8'), /plugins/)
  // Both links run the copy.
  const line = spawnSync(own, ['statusline'], { encoding: 'utf8', input: '{}', env: m.env })
  assert.deepEqual([line.status, line.stderr], [0, ''])
  assert.deepEqual(result(m.run(['--version'], { bin: path })), [0, `${json('package.json').version}\n`, ''])

  // A second connect from the same plugin's folder changes nothing: not the copy, not the links, not the settings.
  const state = () => [filesOf(app), readlinkSync(own), readlinkSync(path), statSync(settings).ino, readFileSync(settings, 'utf8')]
  const before = state()
  const again = fromCache(['connect'])
  assert.deepEqual([again.status, again.stderr], [0, ''])
  assert.deepEqual(linesOf(again).slice(0, 2), [`The command is at ${path}.`, 'The status line was already set, with a refresh every 30 seconds.'])
  assert.deepEqual(state(), before)
})

test('the plugin\'s hook at a session\'s start copies the plugin over the stable copy only when the versions differ, and makes nothing where there is no copy', () => {
  const m = machine('plugin-refresh')
  const app = join(m.home, '.widal', 'app')
  const sessionStart = (root) => spawnSync('/bin/sh', ['-c', hookLines()['refresh-copy'].command], { encoding: 'utf8', input: '{}', env: { ...m.env, CLAUDE_PLUGIN_ROOT: root } })
  // No copy yet: the hook makes none, and makes no folder of the tool.
  const first = pluginCache(m)
  assert.deepEqual(result(sessionStart(first)), [0, '', ''])
  assert.equal(existsSync(join(m.home, '.widal')), false)

  assert.equal(m.run(['connect'], { bin: join(first, 'cli', 'widal.mjs') }).status, 0)
  const copied = filesOf(app)
  // The same version: nothing is written.
  assert.deepEqual(result(sessionStart(first)), [0, '', ''])
  assert.deepEqual(filesOf(app), copied)
  // An update of the plugin: its folder has another version, and the hook copies it.
  const second = pluginCache(m, '0.2.0')
  assert.deepEqual(result(sessionStart(second)), [0, '', ''])
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '0.2.0')
  assert.deepEqual(readdirSync(app).sort(), ['assets', 'cli', 'package.json', 'src'])
  // The links still run the copy, now of the new version.
  assert.deepEqual(result(m.run(['--version'], { bin: join(m.home, '.widal', 'bin', 'widal') })), [0, '0.2.0\n', ''])
  // Now the versions agree again: nothing is written.
  const refreshed = filesOf(app)
  assert.deepEqual(result(sessionStart(second)), [0, '', ''])
  assert.deepEqual(filesOf(app), refreshed)
})

test('with nothing to do, the check at a session\'s start reads two small files and takes a few milliseconds', async () => {
  const { appDir, refreshCopy } = await import('../src/app.mjs')
  const plugin = join(dir, 'refresh-plugin')
  mkdirSync(join(appDir(), 'cli'), { recursive: true })
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(appDir(), 'package.json'), JSON.stringify({ name: '@widal/widal-code', version: '1.0.0' }))
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: '@widal/widal-code', version: '1.0.0' }))
  const start = performance.now()
  for (let i = 0; i < 20; i++) assert.equal(refreshCopy({ root: plugin }), false)
  assert.ok(performance.now() - start < 100, `${performance.now() - start} ms for 20 checks`)
  // Another version: it copies.
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: '@widal/widal-code', version: '1.1.0' }))
  assert.equal(refreshCopy({ root: plugin }), true)
  assert.equal(JSON.parse(readFileSync(join(appDir(), 'package.json'), 'utf8')).version, '1.1.0')
})

test('"disconnect" removes the stable copy with the links, and a connect from a checkout copies nothing', () => {
  const m = machine('plugin-uninstall')
  const cache = pluginCache(m)
  const [app, own, path] = [join(m.home, '.widal', 'app'), join(m.home, '.widal', 'bin', 'widal'), linkIn(m.home, 'widal')]
  assert.equal(m.run(['connect'], { bin: join(cache, 'cli', 'widal.mjs') }).status, 0)
  // The person types "widal disconnect": that runs the copy itself.
  assert.deepEqual(result(m.run(['disconnect'], { bin: path })), [0, `Removed the copy of the tool in ${app}.\nRemoved the status line and the hook from Claude Code, and the command from your PATH.\n`, ''])
  for (const gone of [app, own, path]) assert.equal(existsSync(gone), false, gone)
  assert.equal(JSON.parse(readFileSync(join(m.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).statusLine, undefined)
  // The tool's folder stays, with what it keeps.
  assert.equal(existsSync(join(m.home, '.widal')), true)

  // From a checkout: the links point at the checkout, and nothing is copied.
  const checkout = machine('checkout-install')
  const r = checkout.run(['connect'])
  assert.deepEqual([r.status, r.stderr], [0, ''])
  assert.equal(linesOf(r).some((line) => line.startsWith('Copied')), false)
  assert.equal(existsSync(join(checkout.home, '.widal', 'app')), false)
  assert.equal(readlinkSync(join(checkout.home, '.widal', 'bin', 'widal')), join(realpathSync(ROOT), 'cli', 'widal.mjs'))
  // CLAUDE_PLUGIN_ROOT that names this checkout does not make it a plugin's folder: a git checkout is never copied.
  const named = machine('checkout-named')
  assert.equal(named.run(['connect'], { env: { CLAUDE_PLUGIN_ROOT: ROOT } }).status, 0)
  assert.equal(existsSync(join(named.home, '.widal', 'app')), false)
  // A plugin's folder outside Claude Code's plugins folder, which CLAUDE_PLUGIN_ROOT names, is copied.
  const loaded = machine('plugin-named')
  const folder = pluginCache(loaded, json('package.json').version, join(dir, 'loaded-plugin'))
  assert.equal(loaded.run(['connect'], { bin: join(folder, 'cli', 'widal.mjs'), env: { CLAUDE_PLUGIN_ROOT: folder } }).status, 0)
  assert.equal(readlinkSync(join(loaded.home, '.widal', 'bin', 'widal')), join(loaded.home, '.widal', 'app', 'cli', 'widal.mjs'))
})

test('"connect" says in one sentence when Node is older than 22', async () => {
  const { nodeNote } = await import('../src/app.mjs')
  assert.equal(nodeNote('20.18.1'), 'Widal.Code needs Node 22 or newer, and this computer runs Node 20.18.1.')
  assert.equal(nodeNote('21.7.3'), 'Widal.Code needs Node 22 or newer, and this computer runs Node 21.7.3.')
  for (const fine of ['22.0.0', '24.11.1', process.versions.node]) assert.equal(nodeNote(fine), undefined, fine)
  assert.doesNotMatch(machine('node-new').run(['connect']).stdout, /needs Node/)
})

// From here on: the name line.

test('"widal" with no arguments shows the name and the version above every command, and "connect" ends with them, never the status line or a hook', () => {
  const m = machine('name-command')
  const version = json('package.json').version
  const plain = m.run([])
  assert.deepEqual([plain.status, plain.stderr], [0, ''])
  assert.ok(plain.stdout.startsWith(`Widal.Code ${version}\n\nwidal: what your AI coding agents spend, and what the money pays for.\n`))
  assert.match(plain.stdout, /^ {2}widal summary \[--days 7\] {7}spend by day, project and model, and what it paid for$/m)
  // "help" shows the commands without it.
  assert.ok(m.run(['help']).stdout.startsWith('widal: what your AI coding agents spend'))
  const connect = m.run(['connect'])
  assert.equal(connect.status, 0)
  assert.ok(connect.stdout.endsWith(`\n\nWidal.Code ${version}\n`))
  // The status line and the hooks print no name.
  for (const args of [['statusline'], ['hook', 'compact-keep'], ['hook', 'compact-keep', '--plugin'], ['hook', 'refresh-copy', '--plugin']]) {
    const r = m.run(args, { input: '{}' })
    assert.doesNotMatch(r.stdout, new RegExp(`Widal.Code ${version}`), args.join(' '))
  }
  // Every line of the help with a description has it in the same column.
  // A line that names a long command has its description further right, and a line that only goes
  // on from the line above starts in that column too.
  const long = /^ {2}widal (accounts (label|price)|check --export|apply no-bypass)/
  const columns = new Set(plain.stdout.split('\n').filter((line) => /^ {2}\S/.test(line) && !long.test(line)).map((line) => /^ {2}\S.*? {2,}(?=\S)/.exec(line)?.[0].length).filter(Boolean))
  const goesOn = new Set(plain.stdout.split('\n').filter((line) => /^ {20,}\S/.test(line)).map((line) => line.search(/\S/)))
  assert.deepEqual([...columns], [33])
  assert.deepEqual([...goesOn], [33])
})
