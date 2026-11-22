// Widal.Code's setup for the benchmark on public task sets, made as a person would make it: Widal.Code
// reads the baseline's sessions, proposes changes, and applies every one it can apply itself.
//
//   node bench/harbor-widal.mjs --jobs <folder> --setups <file> --from <setup> --into <setup> [--plugin /opt/widal-code]
//
// --jobs is a folder of Harbor's job folders of the setup --from (any depth). The script
// 1. links every trial's Claude Code sessions (agent/sessions/projects/*) into a Claude Code folder of
//    its own, next to the file of setups, so that Widal.Code sees them as a person's earlier work;
// 2. runs "widal advise --json" there, with a home folder of its own, never the person's;
// 3. writes the settings of the setup --from into that folder's settings.json and runs "widal apply"
//    for every proposal the tool can apply itself;
// 4. adds the setup --into to the file of setups: the setup --from with the settings after the
//    changes, and Widal.Code's plugin (its hooks), uploaded from this repository into the container;
// 5. writes <into>.proposals.json next to the file of setups: every proposal with its predicted
//    saving, and what was applied. The pre-registration commits this file before the main stage.
//
// Nobody adds or removes a proposal by hand.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const WIDAL = join(ROOT, 'cli', 'widal.mjs')

/** The session folders of every trial under `jobs`: each trial's agent/sessions/projects/<project>. */
export function sessionFolders(jobs) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (!statSync(path).isDirectory()) continue
      const projects = join(path, 'agent', 'sessions', 'projects')
      if (existsSync(join(path, 'result.json')) && existsSync(projects)) {
        for (const project of readdirSync(projects)) if (statSync(join(projects, project)).isDirectory()) out.push({ trial: name, project, path: join(projects, project) })
      } else walk(path)
    }
  }
  walk(jobs)
  return out.sort((a, b) => a.trial.localeCompare(b.trial))
}

/** Links the session folders into <claude>/projects, one folder per trial. Returns how many. */
export function linkSessions(folders, claude) {
  const projects = join(claude, 'projects')
  mkdirSync(projects, { recursive: true })
  let n = 0
  for (const f of folders) {
    const target = join(projects, `${f.trial}-${f.project}`.replace(/[^A-Za-z0-9._-]+/g, '_'))
    if (!existsSync(target)) symlinkSync(f.path, target)
    n++
  }
  return n
}

/** The settings Widal.Code starts from: the setup's settings, with its effort level written in. */
export const settingsBefore = (spec) => ({ ...(spec.settings ?? {}), ...(spec.effort ? { effortLevel: spec.effort } : {}) })

/** The new setup: the setup it starts from, with the settings after the changes and Widal.Code's hooks. */
export function setupOf(spec, into, after, plugin) {
  const { effort: _, ...rest } = spec
  const settings = { ...after }
  const entry = { ...rest, id: into, name: `Widal.Code's changes on top of "${spec.id}", with its hooks`, settings }
  if (settings.effortLevel) entry.effort = settings.effortLevel
  entry.uploads = [...(spec.uploads ?? []), { from: ROOT, to: plugin }]
  entry.pluginDirs = [...(spec.pluginDirs ?? []), plugin]
  return entry
}

function widal(env, args) {
  const r = spawnSync(process.execPath, [WIDAL, ...args], { env, encoding: 'utf8', timeout: 600_000 })
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

function main() {
  const f = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) f[argv[i].slice(2)] = argv[++i]
  for (const key of ['jobs', 'setups', 'from', 'into']) if (!f[key]) throw new Error('usage: node bench/harbor-widal.mjs --jobs <folder> --setups <file> --from <setup> --into <setup> [--plugin /opt/widal-code]')
  const plugin = f.plugin ?? '/opt/widal-code'
  const file = resolve(f.setups)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const spec = data.setups.find((s) => s.id === f.from)
  if (!spec) throw new Error(`The file of setups has no setup "${f.from}".`)
  if (data.setups.some((s) => s.id === f.into)) throw new Error(`The file of setups already has a setup "${f.into}". Remove it first, so that nothing is mixed.`)

  // A home, a Widal.Code folder and a Claude Code folder of the benchmark's own.
  const view = join(dirname(file), `${f.into}-view`)
  const env = { ...process.env, HOME: join(view, 'person'), USERPROFILE: join(view, 'person'), WIDAL_HOME: join(view, 'widal'), CLAUDE_CONFIG_DIR: join(view, 'claude'), CODEX_HOME: join(view, 'person', '.codex') }
  for (const dir of [env.HOME, env.WIDAL_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(dir, { recursive: true })
  const folders = sessionFolders(resolve(f.jobs))
  if (!folders.length) throw new Error(`No sessions of Claude Code under ${f.jobs}.`)
  linkSessions(folders, env.CLAUDE_CONFIG_DIR)

  const before = settingsBefore(spec)
  const settingsFile = join(env.CLAUDE_CONFIG_DIR, 'settings.json')
  writeFileSync(settingsFile, `${JSON.stringify(before, null, 2)}\n`)
  const adviseText = widal(env, ['advise', '--days', '30'])
  const adviseJson = widal(env, ['advise', '--json', '--days', '30'])
  if (adviseJson.status !== 0) throw new Error(`"widal advise --json" failed: ${adviseJson.err || adviseJson.out}`)
  const advise = JSON.parse(adviseJson.out)
  const applied = []
  for (const p of advise.proposals ?? []) {
    if (!p.action || p.applied || applied.some((a) => a.action === p.action)) continue
    const r = widal(env, ['apply', p.action, ...(p.args ?? [])])
    applied.push({ proposal: p.id, action: p.action, args: p.args ?? [], saving: p.saving ?? null, share: p.share ?? null, status: r.status, said: (r.out || r.err).split('\n')[0] })
  }
  const after = JSON.parse(readFileSync(settingsFile, 'utf8'))
  const entry = setupOf(spec, f.into, after, plugin)
  data.setups.push(entry)
  writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`)
  const state = { at: new Date().toISOString(), from: f.from, into: f.into, sessions: folders.length, total: advise.total ?? null, proposals: advise.proposals ?? [], applied, settingsBefore: before, settingsAfter: after }
  writeFileSync(join(dirname(file), `${f.into}.proposals.json`), `${JSON.stringify(state, null, 2)}\n`)
  writeFileSync(join(view, 'advise.txt'), `${adviseText.out}\n`)
  console.log(`"widal advise" read ${folders.length} sessions: ${state.proposals.length} proposals, ${applied.filter((a) => a.status === 0).length} applied. The setup "${f.into}" is in ${file}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
