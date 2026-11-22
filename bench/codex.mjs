// Runs a task through Codex in place of Claude Code: an arm of an arms file with "agent": "codex".
//
// A Codex session of the benchmark:
// - reads a Codex folder of its own (CODEX_HOME) inside the folder of the benchmark run, so that
//   the person's own instructions file, rules, MCP servers, plugins and settings are not read, and
//   its session logs do not go into the person's own Codex folder;
// - signs in with the person's own sign-in: the file auth.json of the person's Codex folder is
//   linked into that folder, never copied or read;
// - runs "codex exec" with approval "never" and the sandbox "workspace-write": it can write in
//   its work folder and the temp folders only, and it has no network;
// - has no web search, because the Claude Code sessions of the benchmark have none;
// - has a rules file that forbids the type check, builds, installs and git commands that reach a
//   remote. Codex has no list of allowed commands as Claude Code has, so this is a list of
//   forbidden ones. A command that starts with a variable, such as "NODE_OPTIONS=... tsc", is not
//   matched by these rules.
//
// Codex reports tokens, not dollars. The cost of a session is what Widal.Code computes from the
// session's log (src/parse-codex.mjs and src/prices.mjs), call by call: a call with a long prompt
// costs more per token, so the totals that Codex prints at the end are not enough. The totals are
// kept too, and the report checks that the two counts agree.
//
// The sign-in: Codex renews its sign-in when the access token is about to expire, and it saves
// the new one by writing a new file in place of the old. In the benchmark's folder that replaces
// the link with a file, and the person's own folder keeps the old sign-in. linkIntact() finds
// that after a session, and bench/run.mjs then stops the arm and says what to do.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CodexParser } from '../src/parse-codex.mjs'
import { cost } from '../src/prices.mjs'

/** Commands that a Codex session of the benchmark may not run, in Codex's rules language. */
export const RULES = `# The benchmark's limits for a Codex session, written by bench/codex.mjs.
# The type check and builds need more memory than several sessions at once can have, packages are
# installed already, and a run has no remote repository.
prefix_rule(
    pattern = [["tsc", "next", "vue-tsc"]],
    decision = "forbidden",
    justification = "Not available in this benchmark run: check your change with the unit tests and the linter.",
    match = ["tsc --noEmit", "next build"],
    not_match = ["node test.mjs"],
)
prefix_rule(
    pattern = [["npx", "pnpx", "bunx"], ["tsc", "next", "vue-tsc"]],
    decision = "forbidden",
    justification = "Not available in this benchmark run: check your change with the unit tests and the linter.",
)
prefix_rule(
    pattern = ["pnpm", ["tsc", "typecheck", "type-check", "build", "install", "i", "add", "update", "dlx"]],
    decision = "forbidden",
    justification = "Not available in this benchmark run: check your change with the unit tests and the linter.",
)
prefix_rule(
    pattern = ["pnpm", ["exec", "run"], ["tsc", "next", "typecheck", "type-check", "build"]],
    decision = "forbidden",
    justification = "Not available in this benchmark run: check your change with the unit tests and the linter.",
)
prefix_rule(
    pattern = ["npm", ["install", "i", "ci", "add", "update"]],
    decision = "forbidden",
    justification = "Installing packages is not available in this benchmark run.",
)
prefix_rule(
    pattern = ["npm", "run", ["build", "typecheck", "type-check"]],
    decision = "forbidden",
    justification = "Not available in this benchmark run: check your change with the unit tests and the linter.",
)
prefix_rule(
    pattern = ["git", ["push", "pull", "fetch", "clone", "remote"]],
    decision = "forbidden",
    justification = "This benchmark run has no remote repository.",
)
`

/** A TOML string. */
const toml = (text) => JSON.stringify(String(text))

/** The settings of a Codex arm in Codex's config.toml. */
export function configOf(arm) {
  const lines = [
    '# Written by bench/codex.mjs for one arm of a benchmark run. Codex reads this folder in place of',
    "# the person's own, so that no instructions file, rules, MCP server or plugin of the person's is used.",
    `model = ${toml(arm.settings.model)}`,
  ]
  if (arm.settings.effortLevel) lines.push(`model_reasoning_effort = ${toml(arm.settings.effortLevel)}`)
  lines.push('approval_policy = "never"', 'sandbox_mode = "workspace-write"', 'web_search = "disabled"', '', '[sandbox_workspace_write]', 'network_access = false', '', '[shell_environment_policy]', 'inherit = "all"', '')
  return lines.join('\n')
}

/**
 * The Codex folder of an arm, made ready for a session: config.toml, the rules file, and a link to
 * the file auth.json of the person's Codex folder `from`. Throws when that file is not there, for
 * example when Codex keeps its sign-in in the system's keychain.
 * @returns {string} The folder, for CODEX_HOME.
 */
export function codexHome(out, arm, from) {
  const signIn = join(resolve(from), 'auth.json')
  if (!existsSync(signIn)) throw new Error(`The arm "${arm.id}" runs Codex, which needs its sign-in in ${signIn}. Sign in with "codex login" first. A sign-in that Codex keeps in the system's keychain cannot be used by the benchmark.`)
  const home = join(out, 'codex', arm.id)
  mkdirSync(join(home, 'rules'), { recursive: true })
  writeFileSync(join(home, 'config.toml'), configOf(arm))
  writeFileSync(join(home, 'rules', 'bench.rules'), RULES)
  const link = join(home, 'auth.json')
  if (!linkIntact(home, from)) {
    rmSync(link, { force: true })
    symlinkSync(signIn, link)
  }
  return home
}

/** Whether the arm's folder still links to the person's sign-in. False when Codex wrote a renewed sign-in in its place. */
export function linkIntact(home, from) {
  const link = join(home, 'auth.json')
  try {
    return lstatSync(link).isSymbolicLink() && resolve(home, readlinkSync(link)) === join(resolve(from), 'auth.json')
  } catch {
    return false
  }
}

/** What to tell the person when a session renewed the sign-in inside the benchmark's folder. */
export const renewedSignIn = (home, from) =>
  `Codex renewed its sign-in during the session, and wrote it to ${join(home, 'auth.json')}. Your own Codex folder still has the old sign-in, which may no longer work. Sign in again with "codex login", or move the new file over yours: mv ${join(home, 'auth.json')} ${join(resolve(from), 'auth.json')}`

/** The command line of a session: the prompt, the work folder, and events as JSON lines on stdout. */
export const argsOf = (prompt, work) => ['exec', '--json', '--strict-config', '-C', work, prompt]

/**
 * The numbers in the events that "codex exec --json" printed: the thread, Codex's own token count,
 * the commands and whether the session ended with an error. Messages, commands and their output are
 * not kept.
 */
export function readEvents(stdout) {
  const out = { thread: undefined, usage: { input: 0, cached: 0, written: 0, output: 0, reasoning: 0 }, turns: 0, commands: 0, failedCommands: 0, fileChanges: 0, errors: 0, ended: false }
  for (const line of String(stdout).split('\n')) {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e?.type === 'thread.started' && typeof e.thread_id === 'string') out.thread = e.thread_id
    else if (e?.type === 'turn.completed') {
      out.turns++
      out.ended = true
      const u = e.usage ?? {}
      const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      out.usage.input += n(u.input_tokens)
      out.usage.cached += n(u.cached_input_tokens)
      out.usage.written += n(u.cache_write_input_tokens)
      out.usage.output += n(u.output_tokens)
      out.usage.reasoning += n(u.reasoning_output_tokens)
    } else if (e?.type === 'turn.failed' || e?.type === 'error') out.errors++
    else if (e?.type === 'item.completed' && e.item?.type === 'command_execution') {
      out.commands++
      if (e.item.status !== 'completed' || (typeof e.item.exit_code === 'number' && e.item.exit_code !== 0)) out.failedCommands++
    } else if (e?.type === 'item.completed' && e.item?.type === 'file_change') out.fileChanges++
  }
  return out
}

/** The log of a thread in the arm's Codex folder: sessions/<year>/<month>/<day>/rollout-<time>-<thread>.jsonl. */
export function logOf(home, thread) {
  const found = []
  const walk = (dir, depth) => {
    let names
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of names) {
      if (d.isDirectory() && depth < 3) walk(join(dir, d.name), depth + 1)
      else if (d.isFile() && d.name.startsWith('rollout-') && d.name.endsWith(`${thread}.jsonl`)) found.push(join(dir, d.name))
    }
  }
  if (thread) walk(join(home, 'sessions'), 0)
  return found[0]
}

/**
 * What a session cost, as Widal.Code computes it from the session's log, call by call. `known` is
 * false when a model of the session has no price.
 */
export function costOfLog(file) {
  const parser = new CodexParser(file)
  for (const line of readFileSync(file, 'utf8').split('\n')) if (line) parser.feed(line)
  const { records } = parser.result()
  const total = { cost: 0, known: true, calls: records.length, input: 0, output: 0, models: {} }
  for (const r of records) {
    const c = cost(r)
    if (!c.known) total.known = false
    total.cost += c.total
    total.input += r.in + r.w5 + r.w1 + r.cr
    total.output += r.out
    const m = (total.models[r.m ?? 'unknown'] ??= { inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, costUSD: 0 })
    m.inputTokens += r.in
    m.cacheReadInputTokens += r.cr
    m.cacheCreationInputTokens += r.w5 + r.w1
    m.outputTokens += r.out
    m.costUSD += c.total
  }
  return total
}

/**
 * The record's part about the agent, in the shape that the report reads for Claude Code too: cost,
 * time, turns (model calls), session, error, tokens per model. `counted` is Widal.Code's count of
 * the tokens, `usage` Codex's own.
 */
export function numbersOf(events, log, wallMs, timedOut) {
  const counted = log ? costOfLog(log) : undefined
  return {
    agent: 'codex',
    cost: counted?.known ? counted.cost : undefined,
    durationMs: wallMs,
    turns: counted?.calls ?? events.turns,
    session: events.thread,
    isError: timedOut || events.errors > 0 || !events.ended,
    subtype: timedOut ? 'time limit' : events.errors ? 'error' : events.ended ? 'success' : 'no end',
    usage: events.usage,
    counted: counted && { input: counted.input, output: counted.output, calls: counted.calls, priced: counted.known },
    modelUsage: counted?.models ?? {},
    commands: events.commands,
    failedCommands: events.failedCommands,
    fileChanges: events.fileChanges,
    // Codex refuses a forbidden command as a failed command, which is counted above.
    denials: [],
  }
}

/** Whether Widal.Code's count of a session's tokens is Codex's own: the input (with cached and written input) and the output. */
export const tokensAgree = (n) => Boolean(n?.counted) && n.counted.input === n.usage.input && n.counted.output === n.usage.output
