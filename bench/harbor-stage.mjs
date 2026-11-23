// One stage of the benchmark on public task sets: every setup on every task, in blocks, with a ledger
// of the spend and rules that stop the stage.
//
//   node bench/harbor-stage.mjs --config <stage.json> [--plan]
//
// The tasks are shuffled with a fixed seed and cut into blocks. Every setup runs every task of a block,
// side by side, before the next block starts, so a stop at any point leaves complete pairs. After each
// block the runner reads Harbor's results into records (bench/harbor.mjs), adds up the spend per
// provider and per stage from the cost that Claude Code reports, writes status.md, and stops when:
//
// - the stage reached `stopAt` (90%) of its cap, or a provider reached it of its cap;
// - more than `maxHarnessErrors` (10%) of a block's trials ended on an error of the harness;
// - a setup solved `safetyGap` (20 points) fewer tasks than the reference setup after two blocks.
//
// status.md shows the spend and the health of the run, never the comparison between the setups, so
// that nobody reads the result before the stage ends. A stage that is run again skips every task a
// setup already finished. --plan prints the blocks and the commands and runs nothing.
//
// The stage file:
//   name          the stage, for example "pilot"
//   out           the folder of the records, ledger.json and status.md (shared by all stages)
//   jobs          the folder of Harbor's job folders
//   commands      per provider, the command that starts Harbor, for example
//                 {"api": ["/opt/bench/with-key.sh", "/opt/bench/harbor.sh"], "bedrock": ["/opt/bench/harbor.sh"]}
//   env           per provider, variables for the agent (Harbor's --ae), for example {"bedrock": {"CLAUDE_CODE_USE_BEDROCK": "1"}}.
//                 A value "${env:NAME}" is read from the runner's environment when the command is made, so
//                 a key is never written into the stage file; every such value is masked in the logs.
//   setupsFile    the file of setups for bench/harbor/setup_agent.py
//   claudeCode    the version of Claude Code to install
//   setups        [{"id", "model", "provider", "arm" (default: id), "rep" (default: 1), "agent"}]. "agent" is
//                 another Harbor agent. "codex" runs the setup "id" of the file of setups with
//                 bench/harbor/codex_setup_agent.py; any other agent gets no setup.
//   codex         the version of Codex to install (default: Harbor's)
//   reference     the setup the safety rule compares with (default: the first)
//   tasks         [{"dataset", "task"}]
//   blockSize     tasks per block (default 25)
//   seed          the seed of the shuffle
//   concurrency   trials at a time per setup (default 2)
//   taskSetsTogether   true: within a setup, the task sets of a block (one Harbor command each) run at the
//                 same time instead of one after the other, each with at most `concurrency` trials at a time
//                 and at most half its tasks at once, so that a block waits for its slowest task once and not
//                 once per task set (default false)
//   setupTimeoutMultiplier   Harbor's --agent-setup-timeout-multiplier (default 2): installing Claude Code
//                 in many containers at once can take longer than Harbor's 360 seconds, and the setup
//                 ends before the agent starts, so a longer limit changes no measure
//   cap           the most the stage may spend, in dollars
//   providerCaps  the most each provider may spend over all stages, for example {"api": 1500, "bedrock": 1500}
//   stopAt, maxHarnessErrors, safetyGap   the stop rules (defaults 0.9, 0.1, 0.2)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importJobs, readRecords, taskFile } from './harbor.mjs'
import { seeded } from './stats.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..')

/** The tasks in an order fixed by the seed. */
export function shuffled(list, seed) {
  const random = seeded(seed)
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const blocksOf = (tasks, size, seed) => {
  const order = shuffled(tasks, seed)
  const blocks = []
  for (let i = 0; i < order.length; i += size) blocks.push(order.slice(i, i + size))
  return blocks
}

/** The defaults of a stage file, filled in and checked. */
export function stageOf(config) {
  const c = { blockSize: 25, concurrency: 2, setupTimeoutMultiplier: 2, stopAt: 0.9, maxHarnessErrors: 0.1, safetyGap: 0.2, env: {}, ...config }
  for (const key of ['name', 'out', 'jobs', 'setupsFile', 'claudeCode']) if (typeof c[key] !== 'string' || !c[key]) throw new Error(`The stage needs "${key}".`)
  if (!(c.cap > 0)) throw new Error('The stage needs a "cap" in dollars.')
  if (!Array.isArray(c.setups) || !c.setups.length) throw new Error('The stage needs "setups".')
  if (!Array.isArray(c.tasks) || !c.tasks.length) throw new Error('The stage needs "tasks".')
  c.setups = c.setups.map((s) => {
    if (!s.id || !s.model || !s.provider) throw new Error('Each setup of the stage needs "id", "model" and "provider".')
    if (!Array.isArray(c.commands?.[s.provider])) throw new Error(`The stage needs a command for the provider "${s.provider}".`)
    return { arm: s.id, rep: 1, ...s }
  })
  // One provider per stage: every setup then runs under the same conditions, and the spend per
  // provider in the status file does not give away the cost of one setup.
  if (new Set(c.setups.map((s) => s.provider)).size > 1) throw new Error('All setups of a stage use the same provider.')
  c.reference ??= c.setups[0].id
  c.providerCaps ??= {}
  return c
}

/** Spend per provider, per stage, and per stage and provider, from the records' reported cost. */
export function ledgerOf(records) {
  const ledger = { total: 0, providers: {}, stages: {} }
  for (const r of records) {
    const cost = r.cost ?? 0
    ledger.total += cost
    if (r.provider) ledger.providers[r.provider] = (ledger.providers[r.provider] ?? 0) + cost
    if (r.stage) ledger.stages[r.stage] = (ledger.stages[r.stage] ?? 0) + cost
  }
  return ledger
}

/** The records of one stage, by setup: the trials, errors of the harness and solved tasks. */
function healthOf(records, stage) {
  const of = {}
  for (const r of records.filter((x) => x.stage === stage.name)) {
    const h = (of[r.setup ?? r.arm] ??= { trials: 0, harnessErrors: 0, agentErrors: 0, solved: 0, usable: 0 })
    h.trials++
    if (r.harnessError) h.harnessErrors++
    else {
      h.usable++
      if (r.closed) h.solved++
      if (r.error) h.agentErrors++
    }
  }
  return of
}

/**
 * Whether the stage must stop before its next block, and why.
 * @param {object[]} records Every record of the folder.
 * @param {object} stage The stage, from stageOf.
 * @param {{blocksDone: number, lastBlock?: object[]}} progress The blocks done, and the records of the last one.
 */
export function stopRule(records, stage, { blocksDone, lastBlock = [] }) {
  const ledger = ledgerOf(records)
  const spent = ledger.stages[stage.name] ?? 0
  if (spent >= stage.stopAt * stage.cap) return { stop: true, why: `the stage spent $${spent.toFixed(2)}, ${Math.round((100 * spent) / stage.cap)}% of its cap of $${stage.cap}` }
  for (const [provider, cap] of Object.entries(stage.providerCaps)) {
    const used = ledger.providers[provider] ?? 0
    if (used >= stage.stopAt * cap) return { stop: true, why: `the provider "${provider}" spent $${used.toFixed(2)}, ${Math.round((100 * used) / cap)}% of its cap of $${cap}` }
  }
  if (lastBlock.length) {
    const errors = lastBlock.filter((r) => r.harnessError).length
    if (errors / lastBlock.length > stage.maxHarnessErrors) return { stop: true, why: `${errors} of ${lastBlock.length} trials of the last block ended on an error of the harness` }
  }
  if (blocksDone >= 2) {
    const health = healthOf(records, stage)
    const ref = health[stage.reference]
    if (ref?.usable) {
      for (const [setup, h] of Object.entries(health)) {
        if (setup === stage.reference || !h.usable) continue
        if (ref.solved / ref.usable - h.solved / h.usable > stage.safetyGap) return { stop: true, why: `the safety rule: the setup "${setup}" solved far fewer tasks than "${stage.reference}"` }
      }
    }
  }
  return { stop: false }
}

/** The status file: spend against the caps and the health of the run, without the comparison. */
export function statusOf(records, stage, { blocksDone, blocks, stopped }) {
  const ledger = ledgerOf(records)
  const health = healthOf(records, stage)
  const money = (x) => `$${(x ?? 0).toFixed(2)}`
  const lines = [
    `# Stage "${stage.name}"`,
    '',
    `Updated ${new Date().toISOString()}. Blocks done: ${blocksDone} of ${blocks}.${stopped ? ` Stopped: ${stopped}.` : ''}`,
    '',
    '| spend | so far | cap | share |',
    '| --- | --- | --- | --- |',
    `| this stage | ${money(ledger.stages[stage.name])} | ${money(stage.cap)} | ${Math.round((100 * (ledger.stages[stage.name] ?? 0)) / stage.cap)}% |`,
    ...Object.entries(stage.providerCaps).map(([p, cap]) => `| provider ${p}, all stages | ${money(ledger.providers[p])} | ${money(cap)} | ${Math.round((100 * (ledger.providers[p] ?? 0)) / cap)}% |`),
    '',
    'The health of the run per setup. Solved tasks and cost per setup are left out on purpose, until the stage has ended.',
    '',
    '| setup | trials | errors of the harness | errors of the agent (time or budget limit, API) |',
    '| --- | --- | --- | --- |',
    ...stage.setups.map((s) => {
      const h = health[s.id] ?? { trials: 0, harnessErrors: 0, agentErrors: 0 }
      return `| ${s.id} | ${h.trials} | ${h.harnessErrors} | ${h.agentErrors} |`
    }),
    '',
  ]
  return lines.join('\n')
}

/** A (setup, task) pair is done when its record is there and did not end on an error of the harness. */
function done(stage, setup, task) {
  const file = join(stage.out, 'harbor', setup.arm, `${taskFile(task.task)}-r${setup.rep}.json`)
  if (!existsSync(file)) return false
  return !JSON.parse(readFileSync(file, 'utf8')).harnessError
}

/**
 * Harbor's agent options for one setup. Claude Code runs the setup with bench/harbor/setup_agent.py,
 * Codex ("agent": "codex") with bench/harbor/codex_setup_agent.py, both from the file of setups. Any
 * other agent runs as Harbor ships it, with no setup.
 */
export function agentOf(stage, setup) {
  const of = ['--ak', `setups=${stage.setupsFile}`, '--ak', `setup=${setup.id}`]
  if (!setup.agent) return ['-a', 'bench.harbor.setup_agent:SetupAgent', ...of, '--ak', `version=${stage.claudeCode}`]
  if (setup.agent === 'codex') return ['-a', 'bench.harbor.codex_setup_agent:CodexSetupAgent', ...of, ...(stage.codex ? ['--ak', `version=${stage.codex}`] : [])]
  return ['-a', setup.agent]
}

/** The Harbor commands of one setup for one block: one per task set. */
export function commandsOf(stage, setup, block, n) {
  const byDataset = new Map()
  for (const t of block) if (!done(stage, setup, t)) byDataset.set(t.dataset, [...(byDataset.get(t.dataset) ?? []), t])
  return [...byDataset.entries()].map(([dataset, list]) => {
    const env = Object.entries(stage.env[setup.provider] ?? {}).flatMap(([k, v]) => ['--ae', `${k}=${expand(v)}`])
    const agent = agentOf(stage, setup)
    // One folder per setup, not per arm: two runs of one arm that start a task set in the same second
    // would otherwise get the same job folder from Harbor, and one would overwrite the other's trials.
    const folder = join(stage.jobs, stage.name, setup.id, `block-${n}`)
    const args = [
      ...stage.commands[setup.provider].slice(1),
      'run', '-d', dataset,
      ...list.flatMap((t) => ['-i', `*${t.task.split('/').pop()}`]),
      '-m', setup.model,
      ...agent,
      ...env,
      '-o', folder, '-n', String(stage.concurrency), '--delete',
      ...(stage.setupTimeoutMultiplier ? ['--agent-setup-timeout-multiplier', String(stage.setupTimeoutMultiplier)] : []),
    ]
    return { program: stage.commands[setup.provider][0], args, folder, tasks: list.map((t) => t.task) }
  })
}

/** The trials at a time of one task set that runs beside the others: at most `concurrency`, at most half its tasks. */
export const perSet = (tasks, concurrency) => Math.max(1, Math.min(concurrency, Math.ceil(tasks / 2)))

/**
 * The commands of one setup and block, made to run at the same time: each gets its trials at a time, its own
 * log, and a start 2.5 seconds after the one before, because Harbor names a job folder by the second it
 * starts and the task sets of a setup share the block's folder.
 */
export function togetherOf(commands, concurrency) {
  return commands.map((c, i) => {
    const args = [...c.args]
    args[args.indexOf('-n') + 1] = String(perSet(c.tasks.length, concurrency))
    const dataset = args[args.indexOf('-d') + 1].split('/').pop()
    return { ...c, args, log: join(c.folder, `harbor-${dataset}.log`), delay: i * 2500 }
  })
}

/** A value of the stage's env: "${env:NAME}" is read from the runner's environment, and remembered for masking. */
const secrets = new Set()
export function expand(value) {
  const m = /^\$\{env:([A-Z0-9_]+)\}$/.exec(String(value))
  if (!m) return String(value)
  const found = process.env[m[1]]
  if (!found) throw new Error(`The stage needs the variable ${m[1]} in the runner's environment.`)
  secrets.add(found)
  return found
}

/** Masks keys in a log: Anthropic and OpenAI keys by their shape, and every value read with ${env:...}. */
export function mask(text) {
  let out = text.replace(/sk-(ant-|proj-)?[A-Za-z0-9_-]{16,}/g, '[key]')
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[key]')
  return out
}

function runCommand({ program, args }, log) {
  return new Promise((resolve) => {
    // bench/harbor/bin comes first in PATH: its "docker" locks the build of a task's image across the
    // Harbor processes of the setups, which Harbor itself does only inside one process.
    const PATH = `${join(ROOT, 'bench', 'harbor', 'bin')}:${process.env.PATH ?? ''}`
    const child = spawn(program, args, { cwd: ROOT, env: { ...process.env, PATH, PYTHONPATH: ROOT, HARBOR_TELEMETRY: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => out.push(d))
    child.on('close', (code) => {
      // A key never reaches the log: Harbor does not print it, and this masks it all the same.
      writeFileSync(log, mask(Buffer.concat(out).toString('utf8')))
      resolve(code)
    })
  })
}

async function main() {
  const f = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) f[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  if (typeof f.config !== 'string') {
    console.error('usage: node bench/harbor-stage.mjs --config <stage.json> [--plan]')
    process.exit(1)
  }
  const stage = stageOf(JSON.parse(readFileSync(f.config, 'utf8')))
  const blocks = blocksOf(stage.tasks, stage.blockSize, stage.seed)
  mkdirSync(stage.out, { recursive: true })
  if (f.plan) {
    blocks.forEach((block, n) => {
      console.log(`block ${n + 1}: ${block.length} tasks`)
      for (const setup of stage.setups) {
        const commands = commandsOf(stage, setup, block, n + 1)
        for (const c of stage.taskSetsTogether ? togetherOf(commands, stage.concurrency) : commands) console.log(`  ${setup.id}: ${c.tasks.length} tasks of ${c.args[c.args.indexOf('-d') + 1]}, ${c.args[c.args.indexOf('-n') + 1]} at a time`)
      }
    })
    return
  }
  let stopped = null
  let blocksDone = 0
  for (const [n, block] of blocks.entries()) {
    const rule = stopRule(readRecords(stage.out), stage, { blocksDone })
    if (rule.stop) {
      stopped = rule.why
      break
    }
    // Every setup runs the block at the same time, each with its own trials at a time.
    await Promise.all(
      stage.setups.map(async (setup) => {
        const into = () => ({ arm: setup.arm, rep: setup.rep, setup: setup.agent && setup.agent !== 'codex' ? null : setup.id, extra: { stage: stage.name, provider: setup.provider, setup: setup.id } })
        if (!stage.taskSetsTogether) {
          for (const c of commandsOf(stage, setup, block, n + 1)) {
            mkdirSync(c.folder, { recursive: true })
            await runCommand(c, join(c.folder, 'harbor.log'))
            importJobs(c.folder, stage.out, into())
          }
          return
        }
        const commands = togetherOf(commandsOf(stage, setup, block, n + 1), stage.concurrency)
        if (!commands.length) return
        await Promise.all(
          commands.map(async (c) => {
            await new Promise((resolve) => setTimeout(resolve, c.delay))
            mkdirSync(c.folder, { recursive: true })
            await runCommand(c, c.log)
          }),
        )
        // Read once all task sets of the setup have ended, so that no trial that still runs is read.
        importJobs(commands[0].folder, stage.out, into())
      }),
    )
    blocksDone = n + 1
    const records = readRecords(stage.out)
    const names = new Set(block.map((t) => t.task))
    const lastBlock = records.filter((r) => r.stage === stage.name && names.has(r.task))
    writeFileSync(join(stage.out, `status-${stage.name}.md`), statusOf(records, stage, { blocksDone, blocks: blocks.length }))
    writeFileSync(join(stage.out, 'ledger.json'), `${JSON.stringify(ledgerOf(records), null, 2)}\n`)
    const after = stopRule(records, stage, { blocksDone, lastBlock })
    if (after.stop) {
      stopped = after.why
      break
    }
  }
  const records = readRecords(stage.out)
  writeFileSync(join(stage.out, `status-${stage.name}.md`), statusOf(records, stage, { blocksDone, blocks: blocks.length, stopped }))
  writeFileSync(join(stage.out, 'ledger.json'), `${JSON.stringify(ledgerOf(records), null, 2)}\n`)
  console.log(stopped ? `Stopped after ${blocksDone} of ${blocks.length} blocks: ${stopped}.` : `Done: ${blocks.length} blocks.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
