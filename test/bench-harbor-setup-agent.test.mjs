// The agent of a setup (bench/harbor/setup_agent.py): an API key reaches the container in a file, and
// is in no command line. Harbor is not installed here: the test runs the agent with Python on a small
// stand-in for Harbor's Claude Code agent, which passes a command and its variables on as Harbor does,
// and on a made-up container that notes each command line. No container and no session is started.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const python = spawnSync('python3', ['--version']).status === 0
const dir = mkdtempSync(join(tmpdir(), 'widal-code-bench-agent-test-'))

// A made-up key with a quote, a space and a dollar sign, which the file of keys must keep as they are.
const KEY = `sk-made-up-key 'with' "quotes" and $HOME`

/** The stand-in for Harbor: its Claude Code agent runs three commands, each with the key among its variables. */
const HARBOR = `
import os


class ClaudeCodeOptions:
    pass


class ClaudeCode:
    def __init__(self, logs_dir, *args, **kwargs):
        self.logs_dir = logs_dir
        self._resolved_env_vars = {}

    async def install(self, environment):
        pass

    def build_cli_flags(self):
        return ""

    async def _exec(self, environment, command, user=None, env=None, cwd=None, timeout_sec=None):
        return await environment.exec(command=command, env=env, user=user, cwd=cwd, timeout_sec=timeout_sec)

    async def exec_as_root(self, environment, command, env=None, cwd=None, timeout_sec=None):
        return await self._exec(environment, command, user="root", env=env, cwd=cwd, timeout_sec=timeout_sec)

    async def exec_as_agent(self, environment, command, env=None, cwd=None, timeout_sec=None):
        return await self._exec(environment, command, env=env, cwd=cwd, timeout_sec=timeout_sec)

    async def run(self, instruction, environment, context):
        env = {"ANTHROPIC_API_KEY": os.environ["ANTHROPIC_API_KEY"], "IS_SANDBOX": "1", **self._resolved_env_vars}
        await self.exec_as_agent(environment, command="mkdir -p /logs/agent/sessions", env=env)
        await self.exec_as_agent(environment, command="cp -r /skills /logs/agent/sessions", env=env)
        await self.exec_as_agent(environment, command="claude --print -- " + instruction, env=env)
`

/** The run of one case: a made-up container, the agent's install and session, and what was noted, as JSON. */
const DRIVER = `
import asyncio
import json
import os
import sys
from pathlib import Path

from harbor.agents.installed.claude_code import ClaudeCode
from bench.harbor.setup_agent import KEYS_FILE, READ_KEYS, SetupAgent, keys_text, split_keys


class Container:
    """Notes each command line as Harbor's Docker environment starts it: variables as -e NAME=value."""

    def __init__(self, default_user, fail):
        self.default_user = default_user
        self.fail = fail
        self.lines = []
        self.uploads = []

    async def exec(self, command, env=None, user=None, cwd=None, timeout_sec=None):
        line = ["docker", "compose", "exec"]
        for name, value in (env or {}).items():
            line += ["-e", f"{name}={value}"]
        if user is not None:
            line += ["-u", str(user)]
        self.lines.append(line + ["main", "bash", "-c", command])
        if self.fail and command.endswith("claude --print -- task"):
            raise RuntimeError("the session failed")

    async def upload_file(self, source, target):
        self.lines.append(["docker", "compose", "cp", str(source), f"main:{target}"])
        self.uploads.append({"to": str(target), "text": Path(source).read_text(), "mode": oct(Path(source).stat().st_mode & 0o777)})

    async def upload_dir(self, source, target):
        self.lines.append(["docker", "compose", "cp", str(source), f"main:{target}"])


async def main(case):
    container = Container(case.get("user"), case.get("fail", False))
    if case.get("harbor_alone"):
        agent = ClaudeCode(Path("."))
    else:
        agent = SetupAgent(Path("."), setups=case["setups"], setup="baseline")
    await agent.install(container)
    error = None
    try:
        await agent.run("task", container, None)
    except RuntimeError as exc:
        error = str(exc)
    for extra in case.get("then", []):
        await agent.exec_as_agent(container, extra["command"], env=extra["env"])
    keys, rest = split_keys({"OPENAI_API_KEY": "k", "aws_secret_access_key": "s", "EMPTY_TOKEN": "", "PATH": "/bin"})
    print(json.dumps({
        "lines": container.lines,
        "uploads": container.uploads,
        "error": error,
        "keysFile": KEYS_FILE,
        "readKeys": READ_KEYS,
        "split": [sorted(keys), sorted(rest)],
        "text": keys_text({"B": "it's", "A": "1"}),
    }))


asyncio.run(main(json.loads(sys.argv[1])))
`

const standIn = join(dir, 'stand-in')
mkdirSync(join(standIn, 'harbor', 'agents', 'installed'), { recursive: true })
writeFileSync(join(standIn, 'harbor', 'agents', 'installed', 'claude_code.py'), HARBOR)
writeFileSync(join(standIn, 'pydantic.py'), 'def Field(default=None, **kwargs):\n    return default\n')
writeFileSync(join(dir, 'driver.py'), DRIVER)
const setups = join(dir, 'setups.json')
writeFileSync(setups, JSON.stringify({ setups: [{ id: 'baseline', env: { TOOL_TOKEN: 'made-up-token', TOOL_MODE: 'quiet' }, rootInstall: ['echo 0.0.0.0 example.org >> /etc/hosts'] }] }))

/** Runs one case and gives what the made-up container noted. */
function run(more = {}) {
  const r = spawnSync('python3', [join(dir, 'driver.py'), JSON.stringify({ setups, ...more })], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, PYTHONPATH: `${standIn}:${ROOT}`, PYTHONDONTWRITEBYTECODE: '1', ANTHROPIC_API_KEY: KEY },
  })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

/** The command lines that hold the text, each as one line. */
const holding = (lines, text) => lines.map((l) => l.join(' ')).filter((l) => l.includes(text))
/** The shell command of a command line, and the variables it got with -e. */
const commandOf = (line) => line.at(-1)
const variablesOf = (line) => line.flatMap((part, i) => (line[i - 1] === '-e' ? [part.split('=')[0]] : []))

test('the stand-in passes the key on the command line, as Harbor does without this agent', { skip: !python }, () => {
  const r = run({ harbor_alone: true })
  assert.equal(holding(r.lines, KEY).length, 3, 'each of the three commands of a session shows the key')
  assert.equal(r.uploads.length, 0)
})

test('the key is in no command line: it reaches the container in a file that each command reads', { skip: !python }, () => {
  const r = run({ user: 'agent' })
  assert.deepEqual(holding(r.lines, KEY), [], 'no command line holds the key')
  assert.deepEqual(holding(r.lines, 'made-up-token'), [], 'nor the token of the setup')

  // The file: uploaded once for the three commands, with the keys only, readable by its owner only.
  assert.equal(r.uploads.length, 1)
  assert.equal(r.uploads[0].to, '/var/tmp/.keys-of-session')
  assert.equal(r.uploads[0].mode, '0o600')
  assert.match(r.uploads[0].text, /^export ANTHROPIC_API_KEY=.*\nexport TOOL_TOKEN=made-up-token\n$/s)
  assert.ok(!r.uploads[0].text.includes('IS_SANDBOX') && !r.uploads[0].text.includes('TOOL_MODE'), 'a variable that holds no key stays out of the file')

  // The three commands of the session read the file first, and still get their other variables with -e.
  const session = r.lines.filter((l) => commandOf(l).startsWith(r.readKeys))
  assert.deepEqual(session.map((l) => commandOf(l).slice(r.readKeys.length)), ['mkdir -p /logs/agent/sessions', 'cp -r /skills /logs/agent/sessions', 'claude --print -- task'])
  assert.equal(r.readKeys, '. /var/tmp/.keys-of-session || exit 1; ', 'a command that cannot read the keys stops')
  for (const line of session) assert.deepEqual(variablesOf(line), ['IS_SANDBOX', 'TOOL_MODE'])

  // The file belongs to the user of the agent's commands, and is removed when the session has ended.
  const commands = r.lines.map(commandOf)
  const upload = commands.findIndex((c) => c.startsWith('main:'))
  assert.equal(commands[upload + 1], 'chown agent /var/tmp/.keys-of-session && chmod 600 /var/tmp/.keys-of-session')
  assert.ok(r.lines[upload + 1].includes('root'))
  assert.equal(commands.at(-1), 'rm -f /var/tmp/.keys-of-session')
  // A command without a key is passed on as it is.
  assert.ok(commands.includes('echo 0.0.0.0 example.org >> /etc/hosts'))
})

test('the shell reads the key from the file as it is, with its quotes, spaces and dollar sign', { skip: !python }, () => {
  const r = run({ user: 'agent' })
  const file = join(dir, 'keys')
  writeFileSync(file, r.uploads[0].text)
  const read = spawnSync('sh', ['-c', `. "$1" && printf %s "$ANTHROPIC_API_KEY"`, 'sh', file], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/somewhere' } })
  assert.equal(read.stdout, KEY)
  assert.equal(r.text, `export A=1\nexport B='it'"'"'s'\n`)
  assert.deepEqual(r.split, [['OPENAI_API_KEY', 'aws_secret_access_key'], ['EMPTY_TOKEN', 'PATH']], 'a key is found by its name, in any case of letters, when it has a value')
})

test('without a user named by Harbor the file is readable in the container, and a failed session still removes it', { skip: !python }, () => {
  const r = run({ fail: true })
  assert.equal(r.error, 'the session failed')
  assert.deepEqual(holding(r.lines, KEY), [])
  const commands = r.lines.map(commandOf)
  assert.ok(commands.includes('chmod 644 /var/tmp/.keys-of-session'))
  assert.ok(!commands.some((c) => c.startsWith('chown')))
  assert.equal(commands.at(-1), 'rm -f /var/tmp/.keys-of-session')
})

test('the file is uploaded again only when the keys change', { skip: !python }, () => {
  const same = run({ user: 'agent', then: [{ command: 'true', env: { ANTHROPIC_API_KEY: KEY, TOOL_TOKEN: 'made-up-token' } }] })
  // The session ended and removed the file, so the next command with keys uploads it again.
  assert.equal(same.uploads.length, 2)
  const other = run({ user: 'agent', then: [{ command: 'one', env: { OPENAI_API_KEY: 'made-up-key-2' } }, { command: 'two', env: { OPENAI_API_KEY: 'made-up-key-2' } }, { command: 'three', env: { OPENAI_API_KEY: 'made-up-key-3' } }] })
  assert.deepEqual(other.uploads.map((u) => u.text).slice(1), ['export OPENAI_API_KEY=made-up-key-2\n', 'export OPENAI_API_KEY=made-up-key-3\n'], 'one upload for the two commands with the same key')
  assert.deepEqual(holding(other.lines, 'made-up-key-'), [])
})
