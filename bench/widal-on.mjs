// Turns Widal.Code on for an arm, the way a person would after a period of work.
//
//   node bench/widal-on.mjs --out <folder>          advise from the baseline's runs, apply, and set up the hooks
//   node bench/widal-on.mjs --out <folder> --undo   ask the tool to measure, take the changes back, and check the settings
//   node bench/widal-on.mjs --out <folder> --arm opus-widal-on   the same for another arm with Widal.Code on
//
// The arm is "widal-on", or the one that --arm names. Its `from` in bench/arms.mjs is the arm
// whose runs the tool advises from. This text calls that arm the baseline.
//
// The first form, after the baseline arm has run:
// 1. "widal advise --json" on the baseline's sessions gives the proposals.
// 2. "widal apply" runs for every proposal that the tool can apply itself. It changes a settings
//    file that starts as the baseline's settings, in a Claude Code folder of the benchmark's own.
// 3. That file becomes the settings of the arm, and Widal.Code's hooks are set up as a plugin for
//    the arm's sessions (bench/hook.mjs runs each one and notes its time).
//
// Nothing of the person's real setup is read or changed: Widal.Code runs with a home, a tool
// folder and a Claude Code folder inside the folder of the benchmark run.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { armOf, settingsOf } from './arms.mjs'
import { collect, linkLogs, widal } from './collect.mjs'
import { ROOT, flags, outDir, paths, readJson, viewEnv, writeJson } from './lib.mjs'

const f = flags()
const ARM = typeof f.arm === 'string' ? f.arm : 'widal-on'
if (!armOf(ARM).from || !armOf(ARM).plugin) throw new Error(`The arm "${ARM}" is not an arm with Widal.Code on.`)
/** The arm whose runs the tool advises from, and whose settings the changes start from. */
const BASELINE = armOf(ARM).from
const out = outDir(f)
const P = paths(out)
const env = viewEnv(out, ARM)
const settingsFile = join(env.CLAUDE_CONFIG_DIR, 'settings.json')
const stateFile = join(P.view(ARM).root, 'widal-on.json')
const quote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`

/** The plugin of the arm: Widal.Code's own hooks, each run through bench/hook.mjs in the arm's environment. */
function writePlugin() {
  const dir = P.plugin(ARM)
  const log = join(P.view(ARM).root, 'hooks.jsonl')
  const own = readJson(join(ROOT, 'hooks', 'hooks.json'))
  const hooks = {}
  for (const [event, groups] of Object.entries(own.hooks)) {
    hooks[event] = groups.map((group) => ({
      ...group,
      hooks: group.hooks.map((hook) => {
        const name = / hook ([a-z-]+) --plugin/.exec(hook.command)?.[1]
        if (!name) throw new Error(`hooks/hooks.json has a hook command that this benchmark cannot read: ${hook.command}`)
        const set = ['HOME', 'USERPROFILE', 'WIDAL_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'].map((key) => `${key}=${quote(env[key])}`).join(' ')
        return { ...hook, command: `${set} ${quote(process.execPath)} ${quote(join(ROOT, 'bench', 'hook.mjs'))} ${name} ${quote(log)} 2>/dev/null; exit 0` }
      }),
    }))
  }
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeJson(join(dir, '.claude-plugin', 'plugin.json'), { name: 'widal-bench', version: '0.0.0', description: "Widal.Code's hooks for a benchmark session" })
  writeJson(join(dir, 'hooks', 'hooks.json'), { description: "Widal.Code's hooks, run through bench/hook.mjs", hooks })
  return Object.values(hooks).flat().flatMap((group) => group.hooks).length
}

if (f.undo) {
  const state = readJson(stateFile)
  if (!state) throw new Error(`Nothing to take back: ${stateFile} is not there.`)
  // The tool's own check of each change, before it is taken back.
  linkLogs(out, ARM, BASELINE)
  linkLogs(out, ARM)
  for (const change of state.applied) {
    change.measure = widal(out, ARM, ['measure', change.action]).stdout.trim()
    const r = widal(out, ARM, ['undo', change.action])
    change.undo = { status: r.status, said: (r.stdout || r.stderr).trim().split('\n')[0] }
  }
  state.settingsAfterUndo = readJson(settingsFile)
  state.undoPutSettingsBack = JSON.stringify(state.settingsAfterUndo) === JSON.stringify(state.settingsBefore)
  writeJson(stateFile, state)
  for (const change of state.applied) console.log(`undo ${change.action}: ${change.undo.said}`)
  console.log(`The settings are ${state.undoPutSettingsBack ? 'the same as before the changes' : 'NOT the same as before the changes'}.`)
} else {
  const base = collect(out, BASELINE)
  if (!base) throw new Error(`The baseline arm "${BASELINE}" has not run yet: node bench/run.mjs --out ${out} --arms ${BASELINE}`)
  if (base.advise.error) throw new Error(`"widal advise" failed on the baseline's runs: ${base.advise.error}`)
  const settingsBefore = settingsOf(armOf(BASELINE))
  writeJson(settingsFile, settingsBefore)
  // The arm's Widal.Code sees the baseline's sessions, as a person's would see their earlier work.
  linkLogs(out, ARM, BASELINE)
  // What a person reads: the proposals as text.
  const adviseText = widal(out, ARM, ['advise', '--days', '30']).stdout
  const advise = JSON.parse(widal(out, ARM, ['advise', '--json', '--days', '30']).stdout)
  const applied = []
  for (const p of advise.proposals) {
    if (!p.action || p.applied || applied.some((a) => a.action === p.action)) continue
    const r = widal(out, ARM, ['apply', p.action, ...p.args])
    applied.push({ proposal: p.id, action: p.action, args: p.args, saving: p.saving, share: p.share, status: r.status, said: (r.stdout || r.stderr).trim().split('\n')[0] })
  }
  const settingsAfter = readJson(settingsFile)
  writeJson(P.settings(ARM), settingsAfter)
  const hooks = writePlugin()
  writeJson(stateFile, { at: new Date().toISOString(), baselineTotal: advise.total, proposals: advise.proposals, applied, settingsBefore, settingsAfter, hooks })
  writeFileSync(join(P.view(ARM).root, 'advise.txt'), adviseText)

  const money = (n) => (n === null ? 'no amount yet' : `$${n.toFixed(2)}`)
  console.log(`"widal advise" on the baseline's ${base.sessions.length} sessions ($${advise.total.toFixed(2)}): ${advise.proposals.length} proposals.`)
  for (const p of advise.proposals) console.log(`  ${p.id}: ${p.title}. Saving: ${money(p.saving)}. ${p.action ? `The tool can apply it: widal apply ${[p.action, ...p.args].join(' ')}` : 'A person has to do it by hand.'}`)
  for (const a of applied) console.log(`applied ${a.action}: ${a.status === 0 ? a.said : `FAILED: ${a.said}`}`)
  console.log(`The arm's settings: ${JSON.stringify(settingsAfter)}`)
  console.log(`${hooks} hooks are set up for the arm's sessions. Run the arm with: node bench/run.mjs --out ${out} --arms ${ARM}`)
  if (!existsSync(P.settings(ARM))) throw new Error('the settings of the arm were not written')
}
