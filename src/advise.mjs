// Proposals: changes that would have saved money, worked out by replaying the logs.
//
// A replay takes the model calls as they happened and prices them again as if one thing had been
// different: another cache lifetime, another model, a smaller start. It keeps the tokens as they
// were. So it says what the same work would have cost, not whether the work would have gone the
// same way. Every proposal says what it rests on, how it is done, what can go wrong, and whether
// this tool can apply it.
import { EFFORT_LEVELS, START_TOOLS } from './actions.mjs'
import { COMMANDS, NO_TOOL, READING, analyze, compactionsOf, highEffort, kindOf, lowerEfforts, measures, median, strongModel, totals } from './analyze.mjs'
import { count, day, model, money, pct, plain, project, table, tok, when } from './format.mjs'
import { agentFile } from './install.mjs'
import { priceOf, rates } from './prices.mjs'

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0)
// A setting of Claude Code acts on Claude Code's calls only, not on those of Codex or Cowork. So
// a proposal or a measure that is about such a setting counts only those calls.
const claudeCode = (e) => e.r.s === 'claude'
// The name of a kind of subagent that is safe to print in a command: letters, digits, ".", "_" and "-".
const PLAIN_KIND = /^[A-Za-z0-9._-]+$/
const group = (list, key) => {
  const m = new Map()
  for (const x of list) {
    const k = key(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}
// Sums of dollars are not exact. A share that is right at a limit still counts as reaching it.
const atLeast = (x, limit) => x >= limit - 1e-9
// The sizes of the context, in tokens, at which the replay lets Claude Code compact it on its own.
const COMPACT_POINTS = [200_000, 300_000, 500_000]
// The size that the proposal asks for. "apply autocompact-window" sets it unless another is named.
const COMPACT_POINT = 300_000
const START_CUT = 20_000
const CHEAPER = 'claude-sonnet-5-5'
// A kind of subagent, or the short sessions of a folder, are light work when this share of their cost is light.
const LIGHT_SHARE = 0.6
// A session with this many calls or fewer is short. A folder counts when this share of its sessions is short.
const SHORT_SESSION = 20
const SHORT_SHARE = 0.8
// A lower effort level is compared with only when the person has this many calls of their own at it.
const OWN_CALLS = 200
// The tools proposal needs this many main sessions of Claude Code: with fewer, a tool that was not
// called may just not have been needed yet.
const TOOL_SESSIONS = 20
// The first block of a session: its system prompt, its tool definitions and its first message.
const isStart = (b) => b.label.startsWith('(system prompt')
const inSubagent = (b) => /\/subagents\//.test(b.f)

// The cap on a shell command's output that the proposal asks for, in characters. Claude Code
// gives a failed command an excerpt of about 10,000 characters inline, so a cap of this size does
// not shrink that excerpt. The cap also sets the window of output that Claude Code reads back,
// and the excerpt of a failed command is cut from that window: with a smaller cap, a long failed
// output can show less of itself. "apply bash-output-cap" sets the cap unless another is named.
const BASH_CAP = 10_000
// What Claude gets instead of longer output: a preview of 2,000 characters and the path of the
// file that holds the rest, about 200 characters more.
const BASH_PREVIEW = 2_200

/**
 * @param {object[]} records The model calls, as the parsers return them.
 * @param {{ownFile?: (kind: string) => string | undefined, analyzed?: {calls: object[], blocks: object[]}}} [options]
 *   `ownFile` gives the file of a kind of subagent when the person has one, for the proposals that
 *   name a kind. `analyzed` is what `analyze` gave for the same records, when the caller has it.
 * @returns {{total: number, calls: number, list: object[], all: object[]}} The proposals, largest
 *   saving first. A proposal whose `saving` is null has no amount yet. `list` holds those worth 1%
 *   of the total or more, `all` every one, also those with a saving of 0 or less.
 */
export function proposals(records, { ownFile = agentFile, analyzed } = {}) {
  const { calls, blocks } = analyzed ?? analyze(records)
  const t = totals(calls)
  // Claude Code's subagents only: the settings below do not reach the subagents of Cowork.
  const sub = calls.filter((e) => claudeCode(e) && e.r.agent && e.c.known)
  const list = []

  // A longer cache for subagents. Gaps of 5 to 60 minutes no longer lose the cache, and every
  // cache write of a subagent costs the 1 hour price instead of the 5 minute price.
  let saved = 0
  let extra = 0
  let gaps = 0
  for (const e of sub) {
    const r = rates(e.r)
    let fresh = e.r.w5
    if (e.miss && e.gap > 300e3 && e.gap <= 3600e3) {
      const rewritten = Math.max(0, e.carried - Math.min(e.r.cr, e.carried))
      saved += rewritten * (r.w5 - r.read)
      fresh = Math.max(0, e.r.w5 - rewritten)
      gaps++
    }
    extra += fresh * (r.w1 - r.w5)
  }
  list.push({
    id: 'subagent-cache-1h',
    title: 'Give subagents a 1 hour cache',
    saving: saved - extra,
    evidence: `${count(gaps)} subagent calls came after a wait of 5 to 60 minutes and had lost their cache. Writing their context again cost ${money(saved)}. With a 1 hour cache those are cheap reads. Every other cache write of a subagent then costs the 1 hour price, which is ${money(extra)} more.`,
    how: 'One setting in Claude Code: "subagentPromptCacheTtl": "1h".',
    risk: 'It costs more when subagents work in short bursts and never wait. Whether 1 hour writes count more against a subscription\'s limits is not documented.',
    apply: true,
  })

  // Checking in while waiting keeps the 5 minute cache alive. Each check is a read of the context.
  const kept = calls.filter((e) => e.r.agent && e.keepAlive != null && e.keepAlive < e.waste)
  list.push({
    id: 'subagent-check-in',
    title: 'Subagents check in every 4 minutes while they wait',
    saving: sum(kept, (e) => e.waste - e.keepAlive),
    evidence: `For ${count(kept.length)} waits of 5 minutes to 2 hours, one read of the context every 4 minutes (${money(sum(kept, (e) => e.keepAlive))}) would have cost less than writing it again (${money(sum(kept, (e) => e.waste))}).`,
    how: 'A rule in AGENTS.md or in the subagent definitions: "When you wait for a command or a check that takes more than 4 minutes, do not wait in one go. Look at it at least every 4 minutes." With the 1 hour cache, this only matters for waits of over an hour.',
    risk: 'It depends on the agent following the rule. Each check is a model call.',
    apply: false,
  })

  // A cheaper model for subagents: the same tokens at other prices. The fee for web searches is
  // per search, not per token. It is the same on every model, so it stays in the replayed cost.
  const cheaper = priceOf(CHEAPER)
  const priceAt = (e, p) => (e.r.in * p.in + e.r.w5 * p.in * 1.25 + e.r.w1 * p.in * 2 + e.r.cr * p.read + e.r.out * p.out) / 1e6 + e.c.web
  const costly = sub.filter((e) => {
    const p = priceOf(e.r.m)
    return p && p.out > cheaper.out
  })
  const now = sum(costly, (e) => e.c.total)
  list.push({
    id: 'subagent-model',
    title: 'Run subagents on a cheaper model',
    saving: now - sum(costly, (e) => priceAt(e, cheaper)),
    evidence: `${count(costly.length)} subagent calls ran on a model that costs more than Claude Sonnet 5.5. They cost ${money(now)}. The same tokens at Sonnet 5.5 prices cost ${money(sum(costly, (e) => priceAt(e, cheaper)))}.`,
    how: `One setting in Claude Code: "CLAUDE_CODE_SUBAGENT_MODEL": "${CHEAPER}" in the "env" of its settings, for all subagents. Or "model: ${CHEAPER}" in the file of one kind of subagent.`,
    risk: 'The replay only changes the prices. It says nothing about the quality of the work. Try it on one kind of subagent first and compare the results.',
    apply: true,
  })

  // One kind of subagent on a cheaper model, when most of what that kind costs is reading and
  // searching. A subagent has a context of its own, so its model can differ from the session's
  // without a cache being lost. Subagents whose kind is not logged are one group.
  const modelRisk = 'The replay only changes the prices. It says nothing about the quality of the work.'
  for (const [kind, ofKind] of group(sub, (e) => e.r.at)) {
    const all = sum(ofKind, (e) => e.c.total)
    const reading = sum(ofKind.filter((e) => kindOf(e.r) === READING), (e) => e.c.total)
    const strong = ofKind.filter((e) => strongModel(e.r))
    if (!strong.length || !atLeast(reading, LIGHT_SHARE * all)) continue
    const cost = sum(strong, (e) => e.c.total)
    const replayed = sum(strong, (e) => priceAt(e, cheaper))
    const name = kind ? `"${kind}" subagents` : 'subagents whose kind is not logged'
    // Only a subagent with a file of its own can get a model of its own.
    const file = kind ? ownFile(kind) : undefined
    // A command is printed for a kind only when its name is plain. Any other name could be read
    // in another way by the shell that the command is pasted into.
    const byHand = file && !PLAIN_KIND.test(kind)
    list.push({
      id: 'subagent-model-by-kind',
      kind,
      title: `Run the ${name} on a cheaper model`,
      saving: cost - replayed,
      evidence: `${pct(reading, all)} of what the ${name} cost is reading and searching: ${money(reading)} of ${money(all)}. ${count(strong.length)} of their calls ran on a model that costs more than Claude Sonnet 5.5. They cost ${money(cost)}. The same tokens at Sonnet 5.5 prices cost ${money(replayed)}.`,
      how: file
        ? `One line in the file of that subagent (${file}): "model: ${CHEAPER}". The other subagents keep their model.`
        : `${kind ? `"${kind}" has no file of its own, so it cannot be changed alone` : 'A subagent without a logged kind cannot be changed alone'}. The setting for all subagents does it: "CLAUDE_CODE_SUBAGENT_MODEL": "${CHEAPER}" in the "env" of Claude Code's settings.`,
      risk: `${modelRisk} Compare before and after with: widal measure subagent-model`,
      apply: !byHand,
      byHand: byHand ? 'The name of this kind has other characters than letters, digits, ".", "_" and "-", so no command is printed for it.' : undefined,
      action: 'subagent-model',
      args: file && !byHand ? `--kind ${kind}` : undefined,
      applyNote: file ? undefined : 'This changes all subagents.',
    })
  }

  // A lower effort for simple work: calls that read, searched or ran commands at effort "high" or
  // above. Only Claude Code's calls, because the change this tool can make is a setting of Claude
  // Code. The amount comes only from the person's own calls: for the same model and the same kind
  // of work, what a call wrote above the median of the calls at the next lower effort.
  const simple = calls.filter((e) => e.c.known && claudeCode(e) && typeof e.r.ef === 'string' && [READING, COMMANDS].includes(kindOf(e.r)))
  const high = simple.filter((e) => highEffort(e.r))
  if (high.length) {
    // Output includes the model's thinking.
    const written = (e) => e.r.out
    const outputCost = sum(high, (e) => e.c.out)
    let saving = 0
    let compared = 0
    let largest
    const comparedWith = new Set()
    for (const sameWork of group(simple, (e) => `${e.r.m} ${kindOf(e.r)}`).values()) {
      const byEffort = group(sameWork, (e) => e.r.ef)
      for (const [effort, atEffort] of byEffort) {
        if (!highEffort({ ef: effort })) continue
        const lower = lowerEfforts(effort).find((level) => (byEffort.get(level)?.length ?? 0) >= OWN_CALLS)
        if (!lower) continue
        const usual = median(byEffort.get(lower).map(written))
        const above = sum(atEffort, (e) => Math.max(0, written(e) - usual) * rates(e.r).out)
        saving += above
        compared += atEffort.length
        comparedWith.add(lower)
        if (!largest || above > largest.above) largest = { above, effort, lower, usual, here: median(atEffort.map(written)), m: atEffort[0].r.m, kind: kindOf(atEffort[0].r) }
      }
    }
    // The level to try: the lowest one that the amount was compared with, so that no part of it
    // stays at a higher effort. Without data of the person's own, one level below the effort that
    // most of this output ran at. Only a level that the setting takes.
    const most = [...group(high, (e) => e.r.ef)].map(([effort, l]) => [effort, sum(l, (e) => e.c.out)]).sort((a, b) => b[1] - a[1])[0][0]
    const level = EFFORT_LEVELS.find((l) => comparedWith.has(l)) ?? lowerEfforts(largest?.effort ?? most).find((l) => EFFORT_LEVELS.includes(l)) ?? EFFORT_LEVELS[0]
    const found = `${count(high.length)} calls read, searched or ran commands at effort high or above. Their output, which includes thinking, cost ${money(outputCost)}.`
    const proposal = {
      id: 'effort-lower',
      title: 'Start sessions at a lower effort',
      how: `One setting in Claude Code: "effortLevel": "${level}". New sessions then start at that effort. If they already start that low, the higher effort was set in a session (/effort), or in the file of a subagent or a skill ("effort:"). Lower it there.`,
      risk: 'The setting is for all work, not only for reading and commands. Hard work can go worse at a lower effort.',
      apply: true,
      action: 'effort-default',
      args: `--level ${level}`,
    }
    if (largest) {
      const rest = high.length - compared
      list.push({
        ...proposal,
        saving,
        evidence: `${found} The amount is what they wrote above the median of your own calls at the next lower effort, for the same model and the same kind of work. The largest part: ${model(largest.m)}, ${largest.kind}, with a median of ${count(largest.here)} output tokens per call at ${largest.effort} and ${count(largest.usual)} at ${largest.lower}.${rest ? ` ${count(rest)} of the calls have no lower effort with ${OWN_CALLS} calls of your own, so they are not in the amount.` : ''}`,
        risk: `${proposal.risk} Your calls at the lower effort may have been easier work, so the amount is an estimate.`,
      })
    } else if (outputCost > 0 && outputCost >= 0.01 * t.total) {
      // No amount can be given. The proposal is still shown when the output it is about is 1% of the total or more.
      list.push({ ...proposal, saving: null, evidence: `${found} No data of your own at a lower effort yet. Try it for a week, then run: widal measure effort-default` })
    }
  }

  // A cheaper model for new sessions in a folder where the main sessions are short and mostly
  // read, search and think. Only for new sessions: a switch in a running session sends its whole
  // context to the new model again. Only Claude Code's sessions, because the cheaper model is one
  // of Claude Code's.
  const mainSessions = [...group(calls.filter((e) => !e.r.agent && claudeCode(e)), (e) => e.r.ses).values()]
  for (const [folder, sessions] of group(mainSessions, (session) => session[0].r.cwd)) {
    const short = sessions.filter((session) => session.length <= SHORT_SESSION)
    if (!folder || !atLeast(short.length, SHORT_SHARE * sessions.length)) continue
    const priced = short.flat().filter((e) => e.c.known)
    const all = sum(priced, (e) => e.c.total)
    const light = sum(priced.filter((e) => [READING, NO_TOOL].includes(kindOf(e.r))), (e) => e.c.total)
    const strong = priced.filter((e) => strongModel(e.r))
    if (!strong.length || !atLeast(light, LIGHT_SHARE * all)) continue
    const cost = sum(strong, (e) => e.c.total)
    const replayed = sum(strong, (e) => priceAt(e, cheaper))
    list.push({
      id: 'project-model',
      folder,
      title: `Start new sessions in ${project(folder)} on a cheaper model`,
      saving: cost - replayed,
      evidence: `In ${folder}, ${count(short.length)} of ${count(sessions.length)} main sessions had ${SHORT_SESSION} calls or fewer. ${pct(light, all)} of what those short sessions cost is reading, searching and thinking. Their calls on a model that costs more than Claude Sonnet 5.5 cost ${money(cost)}. The same tokens at Sonnet 5.5 prices cost ${money(replayed)}.`,
      how: `Start new sessions in that folder on Claude Sonnet 5.5: "model": "${CHEAPER}" in the folder's .claude/settings.json, or "claude --model ${CHEAPER}". This applies to new sessions only. A switch in a running session sends its whole context to the new model again.`,
      risk: `${modelRisk} A long or hard task in that folder can need the stronger model.`,
      apply: false,
    })
  }

  // An earlier automatic compaction. Claude Code compacts a context on its own when it reaches
  // the limit of the model, and its setting "autoCompactWindow" puts that point earlier. The
  // replay takes the part of each call's carried context above the point as saved: the same
  // share of what carrying cost on that call. It does so for three points. Only Claude Code's
  // calls count, because the point is a setting of Claude Code.
  const above = (l, point) => sum(l, (e) => (e.carried > point ? (e.carriedCost * (e.carried - point)) / e.carried : 0))
  const carrying = calls.filter(claudeCode)
  const long = carrying.filter((e) => e.carried > COMPACT_POINT)
  const atPoint = above(carrying, COMPACT_POINT)
  list.push({
    id: 'autocompact-window',
    title: `Compact the context earlier, at ${tok(COMPACT_POINT)} tokens`,
    saving: atPoint,
    evidence: `${count(long.length)} calls of Claude Code carried more than ${tok(COMPACT_POINT)} tokens. The part above that cost ${money(atPoint)}: ${money(above(carrying.filter((e) => e.r.agent), COMPACT_POINT))} in subagents and ${money(above(carrying.filter((e) => !e.r.agent), COMPACT_POINT))} in main sessions. The same count for three points: ${COMPACT_POINTS.map((point) => `${money(above(carrying, point))} less at ${tok(point)} tokens`).join(', ')}.`,
    how: `One setting in Claude Code: "autoCompactWindow": ${COMPACT_POINT}. Claude Code then compacts a context on its own when it reaches that many tokens. Without the setting it does so only at the limit of the model.`,
    risk: 'The amount assumes that the work goes on the same with a smaller context. Nobody has measured that. A summary loses detail, and work that misses the detail can take more calls. So measure the change after it is applied: widal measure autocompact-window',
    apply: true,
    args: `--tokens ${COMPACT_POINT}`,
    // The same count for each of the three points, for "widal findings".
    points: COMPACT_POINTS.map((point) => ({ tokens: point, saving: above(carrying, point) })),
  })

  // A cap on the output of shell commands. Claude Code gives Claude a successful command's output
  // inline up to "bashOutputMaxChars" characters (about 30,000 without the setting). Longer output
  // goes to a file, and Claude gets a preview and the file's path instead. The replay takes each
  // result of the shell tool that is longer than the cap, and keeps only the preview's share of
  // what it cost to enter and to carry. Only Claude Code's calls: it is a setting of Claude Code.
  // A failed command gets an excerpt instead of a preview, so its results are not counted.
  const longOutput = blocks.filter((b) => b.s === 'claude' && b.label === 'Bash' && b.known && !b.failed && b.chars > BASH_CAP)
  const longCount = new Set(longOutput.map((b) => `${b.f} ${b.ts} ${b.sig}`)).size
  const longCost = sum(longOutput, (b) => b.entry + b.carry)
  list.push({
    id: 'bash-output-cap',
    title: `Cap the shell output that Claude reads inline at ${count(BASH_CAP)} characters`,
    saving: sum(longOutput, (b) => (b.entry + b.carry) * (1 - BASH_PREVIEW / b.chars)),
    chars: BASH_CAP,
    evidence: `${count(longCount)} ${longCount === 1 ? 'result of a shell command that worked was' : 'results of shell commands that worked were'} longer than ${count(BASH_CAP)} characters. Entering and carried on the later calls, ${longCount === 1 ? 'it' : 'they'} cost ${money(longCost)}. With the cap Claude gets a preview of 2,000 characters and the path of a file instead, and the replay keeps only that share.`,
    how: `One setting in Claude Code: "bashOutputMaxChars": ${BASH_CAP}. Claude Code then gives Claude at most ${count(BASH_CAP)} characters of a successful command's output (about 30,000 without the setting). Longer output goes to a file, and Claude reads it when it needs the rest. It needs Claude Code 2.1.261 or later.`,
    risk: 'Claude reads the file when it needs more of the output, and each read is a tool call with a result of its own. The replay does not count those reads, so the saving is the most it can be. The setting also sets the window of output that Claude Code reads back, and the excerpt of a failed command is cut from that window: with a smaller cap, a long error can show less of its output.',
    apply: true,
    args: `--chars ${BASH_CAP}`,
  })

  // A smaller start: every subagent begins with the system prompt, the tool definitions and the lists of skills and agents.
  const starts = blocks.filter((b) => b.label.startsWith('(system prompt') && /\/subagents\//.test(b.f) && b.tokens > 0)
  list.push({
    id: 'subagent-start',
    title: `Start subagents with ${tok(START_CUT)} tokens less`,
    saving: sum(starts, (b) => (b.entry + b.carry) * Math.min(1, START_CUT / b.tokens)),
    evidence: `${count(starts.length)} subagents each started with about ${tok(median(starts.map((b) => b.tokens)))} tokens before any work. With carrying, that start cost ${money(sum(starts, (b) => b.entry + b.carry))}.`,
    how: 'Give each kind of subagent only the tools it needs ("tools:" in its definition). Turn off plugins and MCP servers that subagents do not use.',
    risk: 'A subagent without a tool it needs fails or works around it.',
    apply: false,
  })

  // Built-in tools that no session called: each one's definition is in the start of every main
  // session, written to the cache on the first call and read again on every later call. The replay
  // keeps the tools' share of what each start cost to enter and to carry. Only Claude Code's main
  // sessions: a subagent's tools are set apart from these. The sizes are those measured on one
  // version of Claude Code (START_TOOLS in actions.mjs).
  const ccCalls = calls.filter(claudeCode)
  const called = new Set(ccCalls.flatMap((e) => (e.r.tools ?? []).map(([name]) => name)))
  const mainStarts = blocks.filter((b) => b.s === 'claude' && isStart(b) && !inSubagent(b) && b.tokens > 0)
  const sessions = new Set(mainStarts.map((b) => b.ses)).size
  const unused = Object.entries(START_TOOLS).filter(([, t]) => !t.called.some((name) => called.has(name)))
  if (unused.length && sessions >= TOOL_SESSIONS) {
    const cut = sum(unused, ([, t]) => t.tokens)
    const names = unused.map(([name]) => name)
    const startCost = sum(mainStarts, (b) => b.entry + b.carry)
    list.push({
      id: 'tools-unused',
      title: `Leave out ${count(names.length)} built-in ${names.length === 1 ? 'tool' : 'tools'} that no session called`,
      saving: sum(mainStarts, (b) => (b.entry + b.carry) * Math.min(1, cut / b.tokens)),
      tools: names,
      evidence: `In ${count(sessions)} main sessions of Claude Code, no call used ${names.join(', ')}. Their definitions are in the start of every session, about ${tok(cut)} tokens of a start of about ${tok(median(mainStarts.map((b) => b.tokens)))}. Entering and carried on the later calls, the starts cost ${money(startCost)}, and the replay keeps the tools' share of that.`,
      how: `Deny those tools in Claude Code's settings: "permissions": { "deny": [${names.map((n) => `"${n}"`).join(', ')}] }. New sessions then start without their definitions. The sizes were measured on Claude Code 2.1.331, and other versions can differ.`,
      risk: `A session that needs one of these tools can no longer call it${names.includes('Task') ? ': without "Task" there are no subagents' : ''}. Undo it when that happens. Compare before and after with: widal measure tools-unused`,
      apply: true,
      args: `--tools ${names.join(',')}`,
    })
  }

  // A proposal shows only when its saving is above 0 and at least 1% of the total. One without an amount comes last.
  const shown = list.filter((p) => p.saving === null || (p.saving > 0 && p.saving >= 0.01 * t.total))
  return { total: t.total, calls: calls.length, list: shown.sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0)), all: list }
}

/**
 * Was the change that a proposal asks for applied? `state` is what is kept about the proposal's
 * action. The action for the model of subagents keeps a list of what it changed: all subagents
 * (an entry without a kind), or single kinds. A change for all subagents covers every kind.
 */
function isApplied(proposal, state) {
  if (!state) return false
  const changes = state.before?.changes
  return !changes || changes.some((c) => c.kind === undefined || c.kind === proposal.kind)
}

/**
 * The proposals as text. `applied` maps the id of an applied action to when it was applied and
 * what it found before. `ownFile` is passed on to `proposals`.
 */
export function adviseReport(records, { days, applied = {}, ownFile }) {
  const p = proposals(records, { ownFile })
  if (!p.total) return `No priced model calls in the last ${days} days.`
  const out = [
    `Proposals from a replay of the last ${days} days: ${money(p.total)} at list prices, ${count(p.calls)} model calls.`,
    'A replay prices the same calls again with one thing changed. The amounts overlap, so they do not add up.',
    '',
  ]
  if (!p.list.length) out.push('Nothing was found that would have saved 1% or more.')
  p.list.forEach((x, i) => {
    // The action that makes the change has the proposal's id, unless the proposal names another.
    const action = x.action ?? x.id
    const lines = [
      `${i + 1}. ${x.title}: ${x.saving === null ? 'no amount yet' : `${money(x.saving)} less, ${pct(x.saving, p.total)} of the total`}`,
      `   Why:  ${x.evidence}`,
      `   How:  ${x.how}`,
      `   Risk: ${x.risk}`,
      isApplied(x, applied[action]) ? `   Applied on ${day(applied[action].at)}. See: widal measure ${action}. Take it back: widal undo ${action}`
        : x.apply ? `   Apply: widal apply ${action}${x.args ? ` ${x.args}` : ''}${x.applyNote ? `. ${x.applyNote}` : ''}` : `   Apply: by hand. ${x.byHand ?? 'This tool does not change it.'}`,
    ]
    // A proposal names a kind of subagent, a model or a folder. Those names come from a log or a
    // meta file. Each of these is one line, so it is printed without control characters: a name
    // cannot add a line or change the terminal.
    out.push(...lines.map(plain), '')
  })
  return out.join('\n')
}

/**
 * The proposals as data ("widal advise --json"), for the pane in Claude Code, the largest saving
 * first. Each has the change that applies it, with its arguments as a list, or null when it is
 * made by hand, and whether that change is applied. Names that come from a log or a meta file are
 * without control characters. `applied` and `ownFile` are as for `adviseReport`.
 */
export function adviseData(records, { days, applied = {}, ownFile }) {
  const p = proposals(records, { ownFile })
  return {
    days,
    total: p.total,
    calls: p.calls,
    proposals: p.list.map((x) => {
      const action = x.action ?? x.id
      const on = isApplied(x, applied[action])
      return {
        id: x.id, title: plain(x.title), saving: x.saving, share: x.saving === null || !p.total ? null : x.saving / p.total,
        action: x.apply || on ? action : null,
        // The arguments are words without spaces: a kind of subagent is printed only when its name is plain.
        args: x.apply && x.args ? x.args.split(' ') : [],
        applied: on, appliedAt: on ? applied[action].at : null, note: x.applyNote ?? null,
      }
    }),
  }
}

/**
 * Before and after an applied change, for subagent calls: how much of their cache writing used
 * the 1 hour cache, how often a wait of 5 to 60 minutes lost the cache, and what that cost.
 */
export function measureCache(records, at) {
  return cacheSides(analyze(records).calls, at)
}

function cacheSides(calls, at) {
  const side = (list) => {
    const sub = list.filter((e) => claudeCode(e) && e.r.agent && e.c.known)
    const lost = sub.filter((e) => e.miss && e.gap > 300e3 && e.gap <= 3600e3)
    const w5 = sum(sub, (e) => e.r.w5)
    const w1 = sum(sub, (e) => e.r.w1)
    const per = (x) => (sub.length ? (1000 * x) / sub.length : 0)
    return { calls: sub.length, hour: w5 + w1 ? w1 / (w5 + w1) : 0, lost: per(lost.length), lostCost: per(sum(lost, (e) => e.waste)), cost: per(sum(sub, (e) => e.c.total)) }
  }
  return { before: side(calls.filter((e) => e.r.ts < at)), after: side(calls.filter((e) => e.r.ts >= at)) }
}

// "Before" is this many days before a change was applied. "After" is from then on.
const BEFORE_DAYS = 14
// The calls that a change acts on, by the id of the change: Claude Code's calls only, because
// each of these is a setting of Claude Code. Any other change is measured on all calls.
const MEASURED = {
  'subagent-cache-1h': ['Subagent calls', (e) => claudeCode(e) && !!e.r.agent],
  'subagent-model': ['Subagent calls', (e) => claudeCode(e) && !!e.r.agent],
  'effort-default': ['Main session calls', (e) => claudeCode(e) && !e.r.agent],
  'autocompact-window': ['Main session calls', (e) => claudeCode(e) && !e.r.agent],
  'bash-output-cap': ['Calls of Claude Code', claudeCode],
  'tools-unused': ['Main session calls', (e) => claudeCode(e) && !e.r.agent],
}

/**
 * The kinds of subagent that "apply subagent-model" changed, as a list of names. Undefined when it
 * changed all subagents, or when nothing is kept about what it changed. `before` is what is kept
 * about the applied change.
 */
function changedKinds(before) {
  const changes = before?.changes
  if (!Array.isArray(changes) || !changes.length || changes.some((c) => c.kind === undefined)) return undefined
  return changes.map((c) => c.kind)
}

/** A list of names in words: "a", "a" and "b", or "a", "b" and "c". */
const quoted = (names) => {
  const all = names.map((n) => `"${plain(n)}"`)
  return all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : all[0]
}
// The after side must be this large before the closing sentence compares anything.
const ENOUGH_CALLS = 500
const ENOUGH_SESSIONS = 20

/**
 * The closing sentence of a comparison. `before` and `after` are the measures of the two sides,
 * as `measures` in analyze.mjs gives them.
 */
export function verdict(before, after) {
  if (after.calls < ENOUGH_CALLS || after.sessions < ENOUGH_SESSIONS) return 'Too early to judge.'
  if (!before.calls) return `Nothing to compare with: there are no such calls in the ${BEFORE_DAYS} days before the change.`
  // How much a rate went up, as a part of what it was before. From nothing to something is a rise without limit.
  const rise = (was, is) => (was > 0 ? (is - was) / was : is > 0 ? Infinity : 0)
  const cheaper = -rise(before.cost, after.cost)
  const worse = Math.max(rise(before.errors, after.errors), rise(before.fixRounds, after.fixRounds))
  // The small number keeps a change of exactly 5%, 10% or 25% on the side the rule names.
  if (cheaper >= 0.05 - 1e-9 && worse <= 0.1 + 1e-9) return 'Cheaper, and the work looks the same.'
  if (cheaper > 0 && worse > 0.25 + 1e-9) return 'Cheaper, but the work looks worse.'
  return 'No clear difference.'
}

/**
 * Before and after an applied change, as text: what the calls that the change acts on cost, and
 * signs of how the work went. `at` is when the change was applied. "Before" is the 14 days
 * before that. `before` is what is kept about the applied change. It says which kinds of
 * subagent "subagent-model" changed: when it changed single kinds, only their calls are measured.
 * `metas` is what `load()` gives next to the calls. It holds the compactions of the sessions,
 * which the measure of "autocompact-window" counts.
 */
export function measureReport(records, { id, at, before: keptBefore, metas }) {
  let [label, acts] = MEASURED[id] ?? ['All calls', () => true]
  const kinds = id === 'subagent-model' ? changedKinds(keptBefore) : undefined
  if (kinds) {
    const all = acts
    label = `Calls of the ${quoted(kinds)} subagents`
    acts = (e) => all(e) && kinds.includes(e.r.at)
  }
  const calls = analyze(records).calls.filter((e) => e.r.ts >= at - BEFORE_DAYS * 86400e3)
  const out = [`${id}, applied on ${when(at)}. ${label} before and after.`, '']

  if (id === 'subagent-cache-1h') {
    const m = cacheSides(calls, at)
    const row = (text, f) => [text, f(m.before), f(m.after)]
    out.push(table([
      ['', 'before', 'after'],
      row('Subagent calls', (s) => count(s.calls)),
      row('Share of cache writes with the 1 hour cache', (s) => `${Math.round(100 * s.hour)}%`),
      row('Lost caches after a wait of 5 to 60 minutes, per 1,000 calls', (s) => s.lost.toFixed(1)),
      row('Cost of those lost caches, per 1,000 calls', (s) => money(s.lostCost)),
      row('All cost, per 1,000 calls', (s) => money(s.cost)),
    ], [1, 2]), '')
    out.push(m.after.calls < 500
      ? `Too early to judge: only ${count(m.after.calls)} subagent calls since the change. Look again after a few days of normal work.`
      : m.after.hour < 0.5 ? 'The 1 hour cache is not in use for most subagent writes. Check that the setting is still there and that sessions were started after the change.'
      : 'The work before and after is not the same work, so read the last line with care. The lines on lost caches are the ones this change acts on.')
    out.push('', 'The same calls: what they cost, and signs of how the work went.', '')
  }

  if (id === 'autocompact-window') {
    // What an earlier automatic point acts on: how often a main session is compacted, how large
    // its context is by then, and what carrying the context costs. A subagent's compaction is
    // left out, as its calls are.
    const mine = compactionsOf(metas).filter((c) => !c.agent && c.ts >= at - BEFORE_DAYS * 86400e3)
    const main = calls.filter((e) => e.c.known && acts(e))
    const side = (on) => {
      const list = main.filter((e) => on(e.r.ts))
      const compacted = mine.filter((c) => on(c.ts))
      const sessions = new Set(list.map((e) => e.r.ses)).size
      return {
        compactions: compacted.length,
        perSession: sessions ? compacted.length / sessions : 0,
        size: compacted.length ? median(compacted.map((c) => c.pre)) : undefined,
        carrying: list.length ? (1000 * sum(list, (e) => e.carriedCost)) / list.length : 0,
      }
    }
    const m = { before: side((ts) => ts < at), after: side((ts) => ts >= at) }
    const row = (text, f) => [text, f(m.before), f(m.after)]
    out.push(table([
      ['', 'before', 'after'],
      row('Compactions', (s) => count(s.compactions)),
      row('Compactions, per session', (s) => s.perSession.toFixed(1)),
      row('Size before a compaction, median', (s) => (s.size === undefined ? 'none' : `${tok(s.size)} tokens`)),
      row('Carrying cost, per 1,000 calls', (s) => money(s.carrying)),
    ], [1, 2]), '')
    out.push(m.after.compactions
      ? 'An earlier automatic point shows as more compactions per session, a smaller size before a compaction and a lower carrying cost. The work before and after is not the same work, so read these lines with care.'
      : 'No main session was compacted since the change. Look again after a few days of normal work.')
    out.push('', 'The same calls: what they cost, and signs of how the work went.', '')
  }

  if (id === 'tools-unused') {
    // What leaving out tools acts on: the size of the start of each main session.
    const starts = analyze(records).blocks.filter((b) => b.s === 'claude' && isStart(b) && !inSubagent(b) && b.tokens > 0 && b.ts >= at - BEFORE_DAYS * 86400e3)
    const side = (on) => starts.filter((b) => on(b.ts)).map((b) => b.tokens)
    const [was, is] = [side((ts) => ts < at), side((ts) => ts >= at)]
    out.push(table([
      ['', 'before', 'after'],
      ['Main sessions', count(was.length), count(is.length)],
      ['Start of a session, median', was.length ? `${tok(median(was))} tokens` : 'none', is.length ? `${tok(median(is))} tokens` : 'none'],
    ], [1, 2]), '')
    out.push(is.length ? 'Leaving out tools shows as a smaller start. The first message is part of the start too, so read the line with care.' : 'No main session started since the change. Look again after a few days of normal work.')
    out.push('', 'The same calls: what they cost, and signs of how the work went.', '')
  }

  const measured = calls.filter((e) => e.c.known && acts(e))
  const before = measures(measured.filter((e) => e.r.ts < at))
  const after = measures(measured.filter((e) => e.r.ts >= at))
  const row = (text, f) => [text, f(before), f(after)]
  const rate = (x) => x.toFixed(1)
  // Codex's log does not say which command failed, so its rounds of fixing cannot be counted. With
  // only Codex calls the line is left out. The last line says what is missing.
  const codex = measured.filter((e) => e.r.s === 'codex').length
  const rounds = codex < measured.length || !measured.length
  out.push(table([
    ['', 'before', 'after'],
    row('Calls', (s) => count(s.calls)),
    row('Sessions', (s) => count(s.sessions)),
    row('Cost, per 1,000 calls', (s) => money(s.cost)),
    row('Cost, per session', (s) => money(s.costPerSession)),
    row('Calls, per session', (s) => rate(s.callsPerSession)),
    row('Tool errors, per 1,000 calls', (s) => rate(s.errors)),
    ...(rounds ? [row('Rounds of fixing, per 1,000 calls', (s) => rate(s.fixRounds))] : []),
    row('Interrupts by you, per 1,000 calls', (s) => rate(s.interrupts)),
    row('Repeated tool calls, per 1,000 calls', (s) => rate(s.repeats)),
  ], [1, 2]), '')
  out.push(`${rounds ? 'A round of fixing: a command failed, then files were changed, then the same command ran again. ' : ''}A repeated tool call: the same tool with the same input, 4 times or more in one session.`, '')
  out.push(verdict(before, after))
  out.push(`These are signs, not proof. The work before and after is not the same work, and no measure shows for sure that a change was right.${codex ? ' Missing: rounds of fixing for Codex, because its log does not say which command failed.' : ''}`)
  return out.join('\n')
}
