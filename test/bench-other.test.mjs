// Tests for the tasks of a tasks file: issues of another project, scored with that project's own tests.
// They are in a file of their own, because a tasks file takes the place of the benchmark's own tasks
// for the whole process.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { oneTaskSet, paths, workFolders } from '../bench/lib.mjs'
import { markStart, passingNow, scoreOther, startOther } from '../bench/other.mjs'
import { taskHash } from '../bench/record.mjs'
import { OWN_SET, TASKS, taskOf, taskSet, useTasks } from '../bench/tasks.mjs'

const put = (root, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

/** A small project whose test command writes its report in the JSON form of Jest, and a tasks file for one issue of it. */
function project() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'widal-bench-other-')))
  put(join(dir, 'start'), {
    '.gitignore': 'cache/\n',
    'src/total.mjs': 'export const total = (items) => items.reduce((sum, item) => sum + item.price, 0)\n',
    'src/label.mjs': "export const label = (amount) => `$${amount.toFixed(2)}`\n",
    'test/total.test.mjs': "import assert from 'node:assert/strict'\nimport { total } from '../src/total.mjs'\nexport const tests = { 'adds the prices': () => assert.equal(total([{ price: 2, count: 1 }, { price: 3, count: 1 }]), 5) }\n",
    'test/label.test.mjs': "import assert from 'node:assert/strict'\nimport { label } from '../src/label.mjs'\nexport const tests = { 'shows two digits': () => assert.equal(label(2), '$2.00') }\n",
    // The test command: the files it is given, or with --related every test file of the start.
    'run-tests.mjs': `import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const args = process.argv.slice(2)
const out = args[args.indexOf('--out') + 1]
const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
const files = args.includes('--related') ? ['test/total.test.mjs', 'test/label.test.mjs'] : named
const testResults = []
for (const file of files) {
  const assertionResults = []
  try {
    const { tests } = await import(resolve(file))
    for (const [fullName, run] of Object.entries(tests)) {
      let status = 'passed'
      try { run() } catch { status = 'failed' }
      assertionResults.push({ fullName, status })
    }
  } catch {}
  testResults.push({ name: resolve(file), status: assertionResults.length && assertionResults.every((a) => a.status === 'passed') ? 'passed' : 'failed', assertionResults })
}
writeFileSync(out, JSON.stringify({ testResults }))
`,
  })
  put(join(dir, 'hidden'), {
    'test/count.test.mjs': "import assert from 'node:assert/strict'\nimport { total } from '../src/total.mjs'\nexport const tests = {\n  'counts each item as often as its count': () => assert.equal(total([{ price: 2, count: 3 }]), 6),\n  'an empty list is 0': () => assert.equal(total([]), 0),\n}\n",
  })
  writeFileSync(join(dir, 'expect.json'), JSON.stringify(['test/count.test.mjs > counts each item as often as its count', 'test/count.test.mjs > an empty list is 0']))
  writeFileSync(join(dir, 'passing.json'), JSON.stringify(['test/total.test.mjs > adds the prices', 'test/label.test.mjs > shows two digits']))
  // The one expected test that fails at the start.
  writeFileSync(join(dir, 'failing.json'), JSON.stringify(['test/count.test.mjs > counts each item as often as its count']))
  const task = {
    id: 'p1', number: 1, slug: 'count', kind: 'bug fix', minutes: 20, prompt: 'The total ignores the count of an item.', version: 'abc123',
    start: '${dir}/start', folder: 'shop', tools: ['Bash(node run-tests.mjs:*)'],
    hidden: { files: '${dir}/hidden', command: ['node', 'run-tests.mjs', '--out', '${report}', 'test/count.test.mjs'], expect: '${dir}/expect.json' },
    still: { command: ['node', 'run-tests.mjs', '--out', '${report}', '--related', '${changed}'], passing: '${dir}/passing.json', tests: ['.test.mjs'] },
  }
  const file = join(dir, 'tasks.json')
  const write = (change = {}) => writeFileSync(file, JSON.stringify({ set: 'shop-issues', tasks: [{ ...task, ...change }] }))
  write()
  return { dir, file, write }
}

/** A work folder as a run starts it, with the changes of a made-up session. */
function work(dir, name, changes) {
  const folder = join(dir, 'w', name, 'shop')
  mkdirSync(dirname(folder), { recursive: true })
  startOther(taskOf('p1'), folder)
  markStart(folder)
  put(folder, changes)
  return folder
}

const RIGHT = { 'src/total.mjs': 'export const total = (items) => items.reduce((sum, item) => sum + item.price * item.count, 0)\n' }

test('a tasks file takes the place of the own tasks, with its folders filled in, and a wrong task is refused', () => {
  assert.equal(taskSet(), OWN_SET)
  const { dir, file, write } = project()
  for (const [change, message] of [
    [{ id: 'P1' }, /needs an "id"/],
    [{ number: 0 }, /needs a "number"/],
    [{ prompt: '' }, /needs a "prompt"/],
    [{ start: '${dir}/none' }, /needs a "start" folder/],
    [{ tools: ['node'] }, /"Bash\(\.\.\.\)" rules/],
    [{ folder: 'lane2' }, /needs a "folder"/],
    [{ secret: 'x' }, /has the field "secret"/],
    [{ still: { command: ['node', 'run-tests.mjs', '${report}'], passing: '${dir}/passing.json', tests: ['.test.mjs'] } }, /needs "\$\{changed\}"/],
    [{ still: { command: ['node', 'run-tests.mjs', '--out', '${report}', '--related', '${changed}'], passing: '${dir}/passing.json', tests: '.test.mjs' } }, /the endings of the names of test files/],
    [{ hidden: { files: '${dir}/hidden', command: ['node', 'run-tests.mjs', '--out', '${report}', 'test/count.test.mjs'], expect: '${dir}/expect.json', failing: '${dir}/passing.json' } }, /all of them from the "expect" file/],
  ]) {
    write(change)
    assert.throws(() => useTasks(file), message)
  }
  assert.equal(taskSet(), OWN_SET, 'a refused file changes nothing')
  write()
  const [task] = useTasks(file)
  assert.equal(taskSet(), 'shop-issues')
  assert.deepEqual(TASKS.map((t) => t.id), ['p1'])
  assert.equal(task.start, join(dir, 'start'))
  assert.equal(task.checks, 2)
  assert.equal(task.other, true)
  assert.match(taskHash(task), /^[0-9a-f]{16}$/)
  assert.throws(() => taskOf('t1'), /no task/)
})

test('the project\'s own tests score a session: open at the start, closed with the fix, and the hidden files do not stay', () => {
  const { dir, file } = project()
  useTasks(file)
  const task = taskOf('p1')

  const untouched = scoreOther(task, work(dir, 'none', {}))
  assert.equal(untouched.closed, false)
  assert.equal(untouched.passed, 1, 'the empty list is 0 at the start too')
  assert.deepEqual(untouched.changed, [])

  const folder = work(dir, 'right', { ...RIGHT, 'cache/tmp.txt': 'ignored by the project' })
  const kept = join(dir, 'kept', 'right')
  const right = scoreOther(task, folder, kept)
  assert.equal(right.closed, true)
  assert.equal(right.passed, 2)
  assert.equal(right.testsPass, true)
  assert.deepEqual(right.changed, ['src/total.mjs'])
  assert.equal(right.still.ran, 2)
  assert.equal(existsSync(join(folder, 'test/count.test.mjs')), false, 'the hidden test file is gone again')
  assert.equal(readFileSync(join(kept, 'src/total.mjs'), 'utf8'), RIGHT['src/total.mjs'])
  assert.match(readFileSync(join(kept, '.bench-changes.patch'), 'utf8'), /item\.price \* item\.count/)
  assert.equal(existsSync(join(kept, 'cache')), false)
})

test('a fix that breaks a test of the start is open, also when the session changed or removed that test', () => {
  const { dir, file } = project()
  useTasks(file)
  const task = taskOf('p1')
  const BREAKS = { ...RIGHT, 'src/label.mjs': 'export const label = (amount) => `${amount} dollars`\n' }

  const broke = scoreOther(task, work(dir, 'broke', BREAKS))
  assert.equal(broke.passed, 2)
  assert.equal(broke.testsPass, false)
  assert.equal(broke.closed, false)
  assert.deepEqual(broke.still.failed, ['test/label.test.mjs > shows two digits'])

  // The session made the old test agree with its code: the test of the start is put back.
  const edited = scoreOther(task, work(dir, 'edited', { ...BREAKS, 'test/label.test.mjs': "export const tests = { 'shows two digits': () => {} }\n" }))
  assert.equal(edited.closed, false)
  assert.deepEqual(edited.still.failed, ['test/label.test.mjs > shows two digits'])

  // A source file that no longer loads fails every test of the start that needs it.
  const noLoad = scoreOther(task, work(dir, 'noload', { ...RIGHT, 'src/label.mjs': 'export const label = (\n' }))
  assert.equal(noLoad.closed, false)
  assert.deepEqual(noLoad.still.failed, ['test/label.test.mjs > shows two digits'])

  // The session's own copy of the hidden file does not count: the real one is put over it.
  const own = scoreOther(task, work(dir, 'own', { 'test/count.test.mjs': "export const tests = { 'counts each item as often as its count': () => {}, 'an empty list is 0': () => {} }\n" }))
  assert.equal(own.passed, 1)
  assert.equal(own.closed, false)
})

test('with a list of the tests that fail at the start, only those are checks, and the other expected tests must still pass', () => {
  const { dir, file, write } = project()
  write({ hidden: { files: '${dir}/hidden', command: ['node', 'run-tests.mjs', '--out', '${report}', 'test/count.test.mjs'], expect: '${dir}/expect.json', failing: '${dir}/failing.json' } })
  const [task] = useTasks(file)
  assert.equal(task.checks, 1)

  const untouched = scoreOther(task, work(dir, 'none', {}))
  assert.equal(untouched.total, 1)
  assert.equal(untouched.quality, 0, 'the test that passes at the start already earns nothing')
  assert.equal(untouched.closed, false)

  const right = scoreOther(task, work(dir, 'right', RIGHT))
  assert.equal(right.passed, 1)
  assert.equal(right.closed, true)
  assert.equal(right.still.ran, 3, 'two tests of the start and the expected test that passed already')

  // The fix is in, and the empty list no longer gives 0: the session broke a test that passed at the start.
  const broke = scoreOther(task, work(dir, 'broke', { 'src/total.mjs': 'export const total = (items) => (items.length ? items.reduce((sum, item) => sum + item.price * item.count, 0) : -1)\n' }))
  assert.equal(broke.passed, 1)
  assert.equal(broke.testsPass, false)
  assert.equal(broke.closed, false)
  assert.deepEqual(broke.still.failed, ['test/count.test.mjs > an empty list is 0'])
})

test('the tests that pass now are the list that a task\'s files hold', () => {
  const { dir, file } = project()
  useTasks(file)
  const task = taskOf('p1')
  const folder = work(dir, 'list', {})
  assert.deepEqual(passingNow(task, { command: ['node', 'run-tests.mjs', '--out', '${report}', 'test/total.test.mjs', 'test/label.test.mjs'] }, folder), ['test/label.test.mjs > shows two digits', 'test/total.test.mjs > adds the prices'])
})

test('a work folder can have the name of another project, and a folder of runs holds one set of tasks', () => {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'widal-bench-out-')))
  assert.equal(paths(out).work('a'), join(out, 'w', 'a', 'ledger'))
  assert.equal(paths(out).work('a', 'b', 'shop'), join(out, 'w', 'a', 'laneb', 'shop'))
  for (const dir of [paths(out).work('a'), paths(out).work('a', undefined, 'shop'), paths(out).work('a', 'b', 'shop')]) mkdirSync(dir, { recursive: true })
  assert.deepEqual(workFolders(out, 'a'), [join(out, 'w', 'a', 'ledger'), join(out, 'w', 'a', 'shop'), join(out, 'w', 'a', 'laneb', 'shop')])
  assert.deepEqual(workFolders(out, 'none'), [])

  const setFile = oneTaskSet(out, 'shop-issues', OWN_SET)
  writeFileSync(setFile, 'shop-issues\n')
  assert.equal(oneTaskSet(out, 'shop-issues', OWN_SET), setFile)
  assert.throws(() => oneTaskSet(out, OWN_SET, OWN_SET), /holds runs of the task set "shop-issues"/)
  // A folder with runs from before the note was written holds the own set.
  const old = realpathSync(mkdtempSync(join(tmpdir(), 'widal-bench-out-')))
  mkdirSync(join(old, 'runs'))
  assert.throws(() => oneTaskSet(old, 'shop-issues', OWN_SET), /holds runs of the task set "ledger"/)
})
