// A task of another project (a tasks file, see useTasks in bench/tasks.mjs): how its work folder
// starts, and how the project's own tests score what a session left.
//
//   node bench/other.mjs --tasks-file <file> <task id> <work folder>
//
// The command scores a work folder by hand. The folder must have been started with startOther and
// markStart, as bench/run.mjs does it.
//
// A task is closed when every test in the task's "expect" list passes, and no test that passed at
// the start fails now. The hidden test files come into the work folder only when the session has
// ended. Test files of the start that the session changed are put back first, so a session cannot
// pass by changing a test.
import { spawnSync } from 'node:child_process'
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flags } from './lib.mjs'
import { taskOf, useTasks } from './tasks.mjs'

/** The name of the git tag on the state a session starts from. */
const START = 'bench-start'
const MINUTE = 60_000

/** Git in a folder, with a made-up author and without the person's own hooks or signing. */
export function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`)
  return r.stdout
}

/** Marks the state of a work folder as the start: a new git repository with one commit and a tag on it. */
export function markStart(work) {
  git(work, 'init', '-q', '-b', 'main')
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'start')
  git(work, 'tag', START)
}

/** Copies the task's start folder to a new work folder. Files are shared with the start where the disk can do that, so a large project copies fast. */
export function startOther(task, into) {
  cpSync(task.start, into, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
}

/** The files of a folder, as paths from its root. */
function filesOf(root, dir = root) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesOf(root, path))
    else out.push(relative(root, path))
  }
  return out.sort()
}

/** What a session changed since the start: the files that are new or different, and the files that are gone. Files that the project's .gitignore leaves out do not count. */
function changedSince(work) {
  git(work, 'add', '-A')
  const list = (filter) => git(work, 'diff', '--cached', '--name-only', '-z', `--diff-filter=${filter}`, START).split('\0').filter(Boolean)
  return { present: list('d'), gone: list('D') }
}

/**
 * Runs a test command of the task and reads its report: per test file the tests with their
 * result, in the JSON form that Jest and Vitest write. Undefined when there is no report.
 * @returns {{tests: Map<string, boolean>, broken: Set<string>} | undefined} `tests` says for each
 *   test ("file > name") whether it passed. `broken` holds the files that failed without the
 *   result of a single test, for example because an import failed.
 */
function runTests(task, part, work, changed = []) {
  const cwd = realpathSync(join(work, part.cwd ?? ''))
  const temp = mkdtempSync(join(tmpdir(), 'widal-bench-tests-'))
  const report = join(temp, 'report.json')
  try {
    const command = part.command.flatMap((x) => (x === '${changed}' ? changed.map((file) => relative(cwd, join(work, file))) : [x.replaceAll('${report}', report)]))
    // Without NODE_TEST_CONTEXT: under "node --test" that variable changes what a test command in a child process does.
    const { NODE_TEST_CONTEXT: _, ...env } = process.env
    spawnSync(command[0], command.slice(1), { cwd, encoding: 'utf8', timeout: (part.minutes ?? 20) * MINUTE, env: { ...env, ...(task.env ?? {}), CI: '1' }, maxBuffer: 256 * 1024 * 1024 })
    let data
    try {
      data = JSON.parse(readFileSync(report, 'utf8'))
    } catch {
      return undefined
    }
    const tests = new Map()
    const broken = new Set()
    for (const file of data.testResults ?? []) {
      const path = relative(cwd, file.name)
      const results = file.assertionResults ?? []
      if (!results.length && file.status !== 'passed') broken.add(path)
      for (const t of results) {
        const key = `${path} > ${t.fullName}`
        // Two tests with one name: both must pass.
        tests.set(key, t.status === 'passed' && tests.get(key) !== false)
      }
    }
    return { tests, broken }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/** The tests of a folder of test files that pass now, as the list a task's "expect" and "passing" files hold. */
export function passingNow(task, part, work, changed) {
  const ran = runTests(task, part, work, changed)
  if (!ran) throw new Error('the test command wrote no report')
  return [...ran.tests].filter(([, ok]) => ok).map(([name]) => name).sort()
}

/**
 * The score of a work folder for a task of another project. With `kept`, the files the session
 * changed and a patch of all its changes are saved there first.
 * @returns {{task: string, checks: {name: string, ok: boolean, why?: string}[], passed: number, total: number, quality: number, testsPass: boolean, changed: string[], closed: boolean, still: {ran: number, failed: string[]}}}
 */
export function scoreOther(task, work, kept) {
  const { present, gone } = changedSince(work)
  const changed = [...present, ...gone].sort()
  if (kept) {
    rmSync(kept, { recursive: true, force: true })
    mkdirSync(kept, { recursive: true })
    for (const file of present) cpSync(join(work, file), join(kept, file), { recursive: true, verbatimSymlinks: true })
    writeFileSync(join(kept, '.bench-changes.patch'), git(work, 'diff', '--cached', '--binary', START))
  }

  // The start's own test files as they were: a session's changes to them do not count.
  const isTest = new RegExp(task.still.tests)
  const atStart = new Set(git(work, 'ls-tree', '-r', '--name-only', '-z', START).split('\0'))
  const back = changed.filter((file) => isTest.test(file) && atStart.has(file))
  if (back.length) git(work, 'checkout', '-q', START, '--', ...back)
  // The hidden test files, over whatever the session put in their place.
  const hidden = filesOf(task.hidden.files)
  for (const file of hidden) {
    mkdirSync(dirname(join(work, file)), { recursive: true })
    cpSync(join(task.hidden.files, file), join(work, file))
  }

  const expect = JSON.parse(readFileSync(task.hidden.expect, 'utf8'))
  let ran
  let again
  // The tests that passed at the start, of the files that the session's changes reach. The
  // session's own new test files are left out, and so are the hidden files: those are the checks.
  const reach = present.filter((file) => !isTest.test(file) || atStart.has(file))
  try {
    ran = runTests(task, task.hidden, work)
    if (reach.length) again = runTests(task, task.still, work, reach)
  } finally {
    // The hidden files do not stay: the folder is next to the folders in which other sessions work.
    for (const file of hidden) rmSync(join(work, file), { force: true })
  }
  const checks = expect.map((name) => (ran ? { name, ok: ran.tests.get(name) === true } : { name, ok: false, why: 'the hidden tests did not finish' }))

  const passing = new Set(JSON.parse(readFileSync(task.still.passing, 'utf8')))
  const hiddenPaths = new Set(hidden.map((file) => relative(join(work, task.still.cwd ?? ''), join(work, file))))
  const still = { ran: 0, failed: [] }
  let stillFinished = true
  if (reach.length) {
    if (!again) stillFinished = false
    else {
      const fileOf = (name) => name.slice(0, name.indexOf(' > '))
      for (const name of passing) {
        const file = fileOf(name)
        if (hiddenPaths.has(file)) continue
        if (again.tests.has(name)) {
          still.ran += 1
          if (!again.tests.get(name)) still.failed.push(name)
        } else if (again.broken.has(file)) still.failed.push(name)
      }
    }
  }
  const passed = checks.filter((c) => c.ok).length
  const testsPass = stillFinished && still.failed.length === 0
  return { task: task.id, checks, passed, total: checks.length, quality: checks.length ? passed / checks.length : 0, testsPass, changed, closed: passed === checks.length && testsPass, still: { ...still, finished: stillFinished } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = flags()
  const [id, dir] = process.argv.slice(2).filter((x, i, all) => !x.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'))
  if (typeof f['tasks-file'] !== 'string' || !id || !dir || !existsSync(dir)) {
    console.error('usage: node bench/other.mjs --tasks-file <file> <task id> <work folder>')
    process.exit(1)
  }
  useTasks(f['tasks-file'])
  console.log(JSON.stringify(scoreOther(taskOf(id), dir), null, 2))
}
