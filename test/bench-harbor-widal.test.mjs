// Widal.Code's setup from the baseline's Harbor sessions (bench/harbor-widal.mjs): finding and linking
// the sessions, and the new setup. Widal.Code itself is not run here.
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { linkSessions, sessionFolders, settingsBefore, setupOf } from '../bench/harbor-widal.mjs'

const dir = mkdtempSync(join(tmpdir(), 'widal-code-bench-widal-test-'))

function trial(name) {
  const t = join(dir, 'jobs', 'job-1', name)
  mkdirSync(join(t, 'agent', 'sessions', 'projects', '-app'), { recursive: true })
  writeFileSync(join(t, 'result.json'), '{}')
  writeFileSync(join(t, 'agent', 'sessions', 'projects', '-app', 'session.jsonl'), '')
}

test('the sessions of every trial are found and linked, one folder per trial', () => {
  trial('task-1__abc')
  trial('task-2__def')
  mkdirSync(join(dir, 'jobs', 'job-1', 'no-trial'), { recursive: true })
  const folders = sessionFolders(join(dir, 'jobs'))
  assert.deepEqual(folders.map((f) => f.trial), ['task-1__abc', 'task-2__def'])
  const claude = join(dir, 'claude')
  assert.equal(linkSessions(folders, claude), 2)
  assert.ok(lstatSync(join(claude, 'projects', 'task-1__abc--app')).isSymbolicLink())
  assert.equal(linkSessions(folders, claude), 2, 'linking again changes nothing')
})

test('the settings start from the setup, with its effort level written in', () => {
  assert.deepEqual(settingsBefore({ settings: { model: 'm' }, effort: 'xhigh' }), { model: 'm', effortLevel: 'xhigh' })
  assert.deepEqual(settingsBefore({ settings: { model: 'm' } }), { model: 'm' })
})

test('the new setup has the settings after the changes and Widal.Code\'s plugin', () => {
  const spec = { id: 'fable-baseline', effort: 'xhigh', settings: { a: 1 }, budget: 15, rootInstall: ['x'], uploads: [{ from: '/t', to: '/c' }] }
  const entry = setupOf(spec, 'fable-widal', { a: 1, effortLevel: 'high', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5' } }, '/opt/widal-code')
  assert.equal(entry.id, 'fable-widal')
  assert.equal(entry.effort, 'high')
  assert.equal(entry.budget, 15)
  assert.deepEqual(entry.rootInstall, ['x'])
  assert.equal(entry.uploads.length, 2)
  assert.equal(entry.uploads[1].to, '/opt/widal-code')
  assert.ok(existsSync(entry.uploads[1].from), 'the plugin is uploaded from this repository')
  assert.deepEqual(entry.pluginDirs, ['/opt/widal-code'])
  const plain = setupOf({ id: 'baseline', settings: {} }, 'widal-on', {}, '/opt/widal-code')
  assert.equal(plain.effort, undefined, 'no effort level when Widal.Code set none')
})
