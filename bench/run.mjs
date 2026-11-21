// Runs tasks through Claude Code, one real session per task, and scores what each session left.
//
//   node bench/run.mjs --out <folder> [--arms a,b] [--arms-file <file>] [--tasks t1,t2] [--reps 1] [--round 2] [--paired] [--budget 6] [--minutes 30] [--lane b]
//
// Each run:
// - starts from the sample project in a new git repository, on a branch that names a ticket;
// - runs "claude -p" with the arm's settings, the person's own sign-in, no MCP servers, none of
//   the person's own settings or plugins, and a short list of allowed tools;
// - ends at the task's end, at the budget, or after the time limit;
// - is scored with the hidden checks (bench/score.mjs).
//
// The arms run side by side. Inside an arm the tasks run one after the other, in one folder, so
// that an arm is one project in Claude Code's logs. A run that has a record already is skipped.
// --lane names a second work folder, so that a second command can run other tasks of the same
// arm at the same time.
//
// --paired starts a task in all arms at the same moment, and starts the next task when all of
// them have ended. Every arm then works next to the same number of other sessions, so that the
// times of the arms can be compared. Without it an arm that ends early leaves the others alone.
// --round runs one round only (the number in the name of the record), in place of --reps.
// --arms-file adds arms from a file, for example the baseline with another tool on (addArms in
// bench/arms.mjs says what such an arm can hold).
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { ARMS, TOOLS, addArms, armOf, settingsOf } from './arms.mjs'
import { linkLogs } from './collect.mjs'
import { ROOT, flags, outDir, paths, readJson, writeJson } from './lib.mjs'
import { taskHash } from './record.mjs'
import { score, startState } from './score.mjs'
import { TASKS, taskOf } from './tasks.mjs'

const f = flags()
const out = outDir(f)
const P = paths(out)
if (typeof f['arms-file'] === 'string') addArms(f['arms-file'], out)
const arms = (typeof f.arms === 'string' ? f.arms.split(',') : ARMS.filter((a) => !a.from && !a.extra).map((a) => a.id)).map(armOf)
const tasks = (typeof f.tasks === 'string' ? f.tasks.split(',') : TASKS.map((t) => t.id)).map(taskOf)
const reps = Number(f.reps ?? 1)
/** The rounds to run: one round with --round, otherwise 1 to --reps. */
const rounds = f.round !== undefined ? [Number(f.round)] : Array.from({ length: reps }, (_, i) => i + 1)
if (rounds.some((n) => !Number.isInteger(n) || n < 1 || n > 9)) throw new Error('--round and --reps take a whole number from 1 to 9')
const paired = f.paired === true
const budget = Number(f.budget ?? 6)
const minutes = Number(f.minutes ?? 30)
/** A second work folder for the arms, so that this command can run next to another one for the same arm. */
const lane = typeof f.lane === 'string' ? f.lane : undefined
if (lane !== undefined && !/^\w+$/.test(lane)) throw new Error('--lane takes letters and digits only')

/** Git in a folder, with a made-up author and without the person's own hooks or signing. */
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`)
  return r.stdout
}

/** The environment of a session: the person's, without what marks it as a child of another Claude Code session. */
function sessionEnv(arm) {
  const env = { ...process.env, WIDAL_HOME: P.view(arm.id).home }
  for (const name of Object.keys(env)) if (/^CLAUDE(CODE|_CODE_|_PID|_EFFORT)/.test(name)) delete env[name]
  // What an arm of an arms file adds: folders in front of PATH, and variables of its own.
  if (arm.path?.length) env.PATH = [...arm.path, env.PATH].join(delimiter)
  return { ...env, ...(arm.env ?? {}) }
}

/** The settings file of an arm. An arm with Widal.Code on has one already, written by bench/widal-on.mjs. */
function settingsFile(arm) {
  const file = P.settings(arm.id)
  if (arm.from) {
    if (!existsSync(file)) throw new Error(`The arm "${arm.id}" has no settings yet. Run first: node bench/widal-on.mjs --out ${out} --arm ${arm.id}`)
    return file
  }
  writeJson(file, settingsOf(arm))
  return file
}

function claude(args, { cwd, env, timeoutMs }) {
  return new Promise((done) => {
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ status: null, stdout, stderr: String(e), timedOut })
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      done({ status, stdout, stderr, timedOut })
    })
  })
}

/** What the runs of this command have in common, kept in every record: the versions, the computer, and how the runs were started. */
const version = (command, args) => {
  const r = spawnSync(command, args, { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : undefined
}
const setup = {
  claudeCode: version('claude', ['--version'])?.split(' ')[0],
  widalCode: readJson(join(ROOT, 'package.json')).version,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  paired,
  armsSideBySide: arms.length,
}

async function runOne(arm, task, rep) {
  const file = P.result(arm.id, task.id, rep)
  if (existsSync(file)) return readJson(file)
  const work = P.work(arm.id, lane)
  if (!work.startsWith(out)) throw new Error('the work folder is outside the folder of the benchmark run')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(join(work, '..'), { recursive: true })
  startState(task, work)
  git(work, 'init', '-q', '-b', 'main')
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'start')
  const ticket = `ABC-${arm.number}${String(task.number).padStart(2, '0')}${rep}`
  const branch = `user/${ticket.toLowerCase()}-${task.slug}`
  git(work, 'checkout', '-q', '-b', branch)
  // With Widal.Code on, the tool's own Claude Code folder gets the logs of this work folder before the session starts.
  if (arm.plugin) linkLogs(out, arm.id, arm.id, { early: true })

  const args = ['-p', task.prompt, '--output-format', 'json', '--setting-sources', 'project', '--settings', settingsFile(arm), '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-budget-usd', String(budget)]
  // An effort level that the settings file cannot name (max) goes on the command line.
  if (arm.effort) args.push('--effort', arm.effort)
  if (arm.plugin) args.push('--plugin-dir', P.plugin(arm.id))
  if (arm.pluginDir) args.push('--plugin-dir', arm.pluginDir)
  if (arm.systemPrompt) args.push('--append-system-prompt', arm.systemPrompt)
  args.push('--allowedTools', [...TOOLS, ...(arm.tools ?? [])].join(','))
  const started = Date.now()
  const r = await claude(args, { cwd: work, env: sessionEnv(arm), timeoutMs: minutes * 60_000 })
  const ended = Date.now()

  let reported
  try {
    const parsed = JSON.parse(r.stdout)
    // Newer versions can print a list of events: the result is the last one of type "result".
    reported = Array.isArray(parsed) ? parsed.findLast((e) => e.type === 'result') : parsed
  } catch {
    // The session ended without a result, for example at the time limit.
  }
  const kept = P.kept(arm.id, task.id, rep)
  rmSync(kept, { recursive: true, force: true })
  cpSync(work, kept, { recursive: true, filter: (path) => !path.endsWith('/.git') })
  const record = {
    arm: arm.id, task: task.id, taskNumber: task.number, taskHash: taskHash(task), rep, ticket, branch, cwd: work, setup, settings: readJson(settingsFile(arm)),
    // The effort level that the session got on the command line, when the arm names one.
    ...(arm.effort ? { effort: arm.effort } : {}),
    // An arm of an arms file: what it added to the session, next to the settings.
    ...(arm.other ? { other: { name: arm.name, pluginDir: arm.pluginDir, tools: arm.tools, path: arm.path, env: arm.env && Object.keys(arm.env), systemPrompt: arm.systemPrompt } } : {}),
    started: new Date(started).toISOString(), wallMs: ended - started, exit: r.status, timedOut: r.timedOut,
    claude: reported && {
      cost: reported.total_cost_usd, durationMs: reported.duration_ms, apiMs: reported.duration_api_ms, turns: reported.num_turns,
      session: reported.session_id, isError: reported.is_error, subtype: reported.subtype, usage: reported.usage, modelUsage: reported.modelUsage,
      denials: (reported.permission_denials ?? []).map((d) => `${d.tool_name}${d.tool_input?.command ? `: ${String(d.tool_input.command).slice(0, 80)}` : ''}`),
    },
    stderr: reported ? undefined : r.stderr.slice(-400),
    score: score(task.id, kept),
  }
  writeJson(file, record)
  return record
}

const line = (r) =>
  `${r.arm.padEnd(13)} ${r.task.padEnd(3)} r${r.rep}  ${r.score.closed ? 'closed' : 'open  '}  ${String(r.score.passed).padStart(2)}/${String(r.score.total).padEnd(2)} checks  $${(r.claude?.cost ?? 0).toFixed(3).padStart(6)}  ${String(Math.round(r.wallMs / 1000)).padStart(4)}s  ${r.claude ? `${r.claude.turns} turns` : 'no result'}${r.timedOut ? '  (time limit)' : ''}`

// Fails before any agent starts when the arm's settings are missing.
for (const arm of arms) settingsFile(arm)
writeFileSync(join(out, 'README.txt'), 'A run of the Widal.Code benchmark (bench/ in the Widal.Code repository). The folders: w = where the agents work, kept = what they left, runs = the records, widal = a home of its own for Widal.Code per arm.\n')
/** One run, with its line printed. A failure of the run itself ends neither the arm nor the command. */
async function attempt(arm, task, rep) {
  // An arm can name the only tasks it runs: a change that acts on one kind of work is tried there.
  if (arm.only && !arm.only.includes(task.id)) return
  try {
    console.log(line(await runOne(arm, task, rep)))
  } catch (e) {
    console.log(`${arm.id} ${task.id} r${rep}: the run failed: ${e.message}`)
  }
}

if (paired) {
  for (const rep of rounds) for (const task of tasks) await Promise.all(arms.map((arm) => attempt(arm, task, rep)))
} else {
  await Promise.all(
    arms.map(async (arm) => {
      for (const task of tasks) for (const rep of rounds) await attempt(arm, task, rep)
    }),
  )
}
