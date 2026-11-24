// Changes this tool can make to Claude Code, each with a way back.
//
// An action changes one thing in ~/.claude/settings.json, or one line in the file of one of the
// person's own subagents. The file is copied to this tool's backup folder first. What the action
// found before it changed anything is kept in ~/.widal/actions.json, so that "undo" puts
// back exactly that. One action, keep-warm, also turns a setting of this tool on, and off again.
//
// "undo" puts a value back only while the setting still holds what the action set. A value that
// the person changed after that is theirs: it stays, and "undo" says so.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, saveConfig } from './config.mjs'
import { day } from './format.mjs'
import { agentFile, agentLine, hasFrontMatter, hookSet, read, setAgentLine, setEnvSetting, setEventHook, setSetting, settingsFile, write } from './install.mjs'
import { hours, keepWarmConfig } from './keep-warm.mjs'
import { claudeDir, home } from './paths.mjs'

const stateFile = () => join(home(), 'actions.json')

/** The applied actions: id to { at, before }. */
export function applied() {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    return {}
  }
}

function save(state) {
  mkdirSync(home(), { recursive: true })
  const tmp = `${stateFile()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, stateFile())
}

// The model that this tool sets for subagents unless another is named, and the setting that holds it.
const CHEAPER = 'claude-sonnet-5-5'
const SUBAGENT_MODEL = 'CLAUDE_CODE_SUBAGENT_MODEL'

/**
 * Built-in tools of Claude Code that a session can do without, with the tokens each one adds to the
 * start of every session: what a session's first call carried less when the tool was denied alone
 * ("permissions.deny": ["<name>"]). Measured on 24 Nov 2026 with Claude Code 2.1.331 and no other
 * settings. Most built-in tools are deferred and add only their name (about 6 tokens), so they are not
 * here. Tools that everyday work needs (Bash, Read, Edit, Write, Grep, Glob) are never proposed, and
 * neither are ToolSearch and Skill: denying them makes the start larger. The subagent tool is denied
 * as "Task" and appears as "Agent" in the logs of newer versions.
 */
export const START_TOOLS = {
  Task: { tokens: 2926, called: ['Task', 'Agent'] },
  Workflow: { tokens: 2064, called: ['Workflow'] },
  ScheduleWakeup: { tokens: 1695, called: ['ScheduleWakeup'] },
  ReportFindings: { tokens: 907, called: ['ReportFindings'] },
  ListAgents: { tokens: 646, called: ['ListAgents'] },
  WebFetch: { tokens: 635, called: ['WebFetch'] },
  SendMessage: { tokens: 202, called: ['SendMessage'] },
  WebSearch: { tokens: 141, called: ['WebSearch'] },
}

/** The tools that "--tools" names, checked: a list of names from START_TOOLS, at least one. */
function toolsArg(args) {
  const names = String(args?.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  const unknown = names.filter((t) => !Object.hasOwn(START_TOOLS, t))
  if (!names.length || unknown.length) throw new Error(`--tools takes a list of these tools, with commas and no spaces: ${Object.keys(START_TOOLS).join(', ')}.`)
  return [...new Set(names)]
}

/** The effort levels that Claude Code's "effortLevel" setting takes, lowest first. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh']

/** What "apply subagent-model" was asked to change: one kind of subagent, or all (no kind), and the model. */
function subagentTarget({ kind, model = CHEAPER }) {
  if (!/^[\w.:@/[\]-]+$/.test(model)) throw new Error(`"${model}" is not the name of a model. A name looks like this: ${CHEAPER}`)
  if (kind !== undefined && !agentFile(kind)) {
    throw new Error(`"${kind}" has no file of its own in ${join(claudeDir(), 'agents')}, and a built-in kind cannot be changed on its own: use the default for all subagents (widal apply subagent-model).`)
  }
  return { kind, model }
}

/** Is a kind of subagent, or are all subagents (no kind), set to this model now? */
const subagentModelIs = ({ kind, model }) =>
  kind === undefined ? read().env?.[SUBAGENT_MODEL] === model : agentLine(agentFile(kind), 'model') === `model: ${model}`

/** The level that "apply effort-default" was asked to set. */
function effortLevel({ level = 'medium' }) {
  if (!EFFORT_LEVELS.includes(level)) throw new Error(`--level is one of ${EFFORT_LEVELS.join(', ')}`)
  return level
}

/** The cap that "apply keep-warm" was asked to set: the hours without the person after which keep-warm stops. */
function capHours({ 'cap-hours': cap = '3' }) {
  if (!/^\d+(\.\d+)?$/.test(cap) || !(Number(cap) > 0) || Number(cap) > 24) throw new Error('--cap-hours is a number of hours, above 0 and at most 24.')
  return Number(cap)
}

/**
 * The size that "apply autocompact-window" was asked to set: the tokens in the context at which
 * Claude Code compacts it on its own. Claude Code takes a whole number from 100000 to 1000000.
 */
function compactTokens({ tokens = '300000' }) {
  if (!/^\d+$/.test(tokens) || Number(tokens) < 100_000 || Number(tokens) > 1_000_000) throw new Error('--tokens is a whole number from 100000 to 1000000.')
  return Number(tokens)
}

/**
 * The cap that "apply bash-output-cap" was asked to set: how many characters of a successful shell
 * command's output Claude gets inline. Claude Code takes 4000 to 128000 (its documentation of the
 * setting "bashOutputMaxChars").
 */
function capChars({ chars = '10000' }) {
  if (!/^\d+$/.test(chars) || Number(chars) < 4000 || Number(chars) > 128_000) throw new Error('--chars is a whole number from 4000 to 128000.')
  return Number(chars)
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** A value of the settings in words, for a sentence: as it stands in the file, or "not set". */
const inWords = (value) => (value === undefined ? 'not set' : JSON.stringify(value))

/**
 * Puts one setting of Claude Code back to what it was before a change, but only while it still
 * holds what the change set. `now` is the value as it is, `set` what the change set, and `old`
 * what was there before. `write` puts `old` back. `what` names the setting in a sentence.
 *
 * A value that is neither of the two was changed after the change, by the person or by another
 * tool. It stays as it is, and one sentence about it is added to `notPutBack`. A value that is
 * already what it was before needs nothing.
 */
function putBack({ what, now, set, old, write, notPutBack }) {
  if (sameValue(now, set)) write()
  else if (!sameValue(now, old)) notPutBack.push(['setting', `${what} was not put back, because it was changed after this tool set it: it is ${inWords(now)} now, and it was ${inWords(old)} before the change.`])
}

/** Puts one top-level key of Claude Code's settings back, as `putBack` says. */
const putSettingBack = (key, set, old, notPutBack) =>
  putBack({ what: `"${key}" in Claude Code's settings`, now: read()[key], set, old, write: () => setSetting(key, old), notPutBack })

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A copy of the "permissions" of Claude Code's settings, to change. It fails with one plain sentence when "permissions" is not an object. */
function permissionsOf(s) {
  if (s.permissions !== undefined && !isObject(s.permissions)) throw new Error(`"permissions" in ${settingsFile()} is not an object, so this tool does not change it.`)
  return { ...s.permissions }
}

/** Puts "permissions" back into settings `s` after an undo: an object that this tool added and that is empty now goes again. */
function keepPermissions(s, p, hadNone) {
  if (hadNone && !Object.keys(p).length) delete s.permissions
  else s.permissions = p
}

/** The deny rules that keep Claude Code from reading .env files, private keys and AWS credentials. */
export const SECRET_DENY = ['Read(./.env)', 'Read(./.env.*)', 'Read(**/*.pem)', 'Read(**/id_rsa*)', 'Read(**/.aws/credentials)']

/** The days that "apply transcript-days" was asked to set. */
function transcriptDaysArg({ days = '7' }) {
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365) throw new Error('--days is a whole number of days from 1 to 365.')
  return Number(days)
}

/**
 * The actions. `apply` makes the change and returns what was there before. `undo` gets that back.
 * `bin` is the path of this tool's command, for the hooks. `undo` also gets a list. For each
 * thing that it did not put back it adds an entry to it, ["file" or "setting", one sentence],
 * and goes on with the rest.
 *
 * An action with `options` takes arguments, so it can be applied again with other arguments. Its
 * `apply` gets the arguments and the "before" of the earlier applies, and returns the "before" to
 * keep. Its `inPlace` gets the same two. Without arguments it says whether everything that was
 * applied is still there. Its `done` says what an apply did, and its `back` what an undo put back.
 */
export const ACTIONS = {
  'subagent-cache-1h': {
    what: 'Sets "subagentPromptCacheTtl": "1h" in Claude Code\'s settings, so that subagents keep their cache for 1 hour instead of 5 minutes.',
    note: 'New sessions use it. Check the effect with: widal measure subagent-cache-1h',
    apply: () => ({ value: setSetting('subagentPromptCacheTtl', '1h') }),
    undo: (before, bin, notPutBack = []) => putSettingBack('subagentPromptCacheTtl', '1h', before?.value, notPutBack),
    inPlace: () => read().subagentPromptCacheTtl === '1h',
  },
  'model-switch-cost': {
    what: 'Adds a hook to Claude Code that runs before a change of model. It shows what the switch costs, and asks first when the cost is $0.50 or more.',
    note: 'Claude Code can only ask when you type /model with a name. For the model picker it shows the cost and goes on.',
    apply: (bin) => {
      setEventHook('PreModelSwitch', `${bin} hook model-switch`, true)
      return {}
    },
    undo: (before, bin) => setEventHook('PreModelSwitch', `${bin} hook model-switch`, false),
    inPlace: () => hookSet('PreModelSwitch', 'model-switch'),
  },
  'cold-start-warn': {
    what: 'Adds a hook to Claude Code that runs when you send a prompt. When the session\'s cache has ended and its context is large, it says once what that cost: the tokens that were sent again, or the dollars when you pay by the token.',
    note: 'It only warns: it never stops or changes a prompt. It needs this tool\'s status line, which saves when each cache ends. "Large" is the --min of "widal nudge": 100,000 tokens unless you changed it.',
    apply: (bin) => {
      setEventHook('UserPromptSubmit', `${bin} hook cold-start`, true)
      return {}
    },
    undo: (before, bin) => setEventHook('UserPromptSubmit', `${bin} hook cold-start`, false),
    inPlace: () => hookSet('UserPromptSubmit', 'cold-start'),
  },
  'subagent-model': {
    what: `Sets the model that subagents run on: ${CHEAPER}, or the one that --model names. Without --kind it sets "${SUBAGENT_MODEL}" in the "env" of Claude Code's settings, for all subagents. With --kind <name> it sets "model:" in the file of that one subagent.`,
    note: 'New sessions use it. Check the effect with: widal measure subagent-model',
    options: ['--kind', '--model'],
    apply: (bin, args, earlier) => {
      const { kind, model } = subagentTarget(args)
      const changes = earlier?.changes ?? []
      // No "env" in the settings at all: undo then takes out the "env" that this apply adds.
      const noEnv = kind === undefined && read().env === undefined
      const old = kind === undefined ? setEnvSetting(SUBAGENT_MODEL, model) : setAgentLine(agentFile(kind), 'model', `model: ${model}`)
      // Applied before for the same kind: keep the first "old", so that undo still goes all the way back.
      const first = changes.find((c) => c.kind === kind)
      return { changes: first ? changes.map((c) => (c === first ? { ...c, model } : c)) : [...changes, { kind, old, model, ...(noEnv && { noEnv }) }] }
    },
    undo: (before, bin, notPutBack = []) => {
      for (const c of [...(before?.changes ?? [])].reverse()) {
        if (c.kind === undefined) {
          putBack({
            what: `"${SUBAGENT_MODEL}" in the "env" of Claude Code's settings`, now: read().env?.[SUBAGENT_MODEL], set: c.model, old: c.old,
            write: () => setEnvSetting(SUBAGENT_MODEL, c.old, c.noEnv), notPutBack,
          })
          continue
        }
        const file = agentFile(c.kind)
        // A subagent's file that is gone needs nothing put back.
        if (!file) continue
        const was = c.old === undefined ? 'it had no "model:" line before the change' : `its line before the change: "${c.old}"`
        // The line is put back only while it still is what this tool set. A file without front
        // matter goes on to the try below, which says why it cannot be put back.
        const line = agentLine(file, 'model')
        if (hasFrontMatter(file) && line !== `model: ${c.model}`) {
          // A line that is already as it was before needs nothing.
          if (line !== c.old) notPutBack.push(['file', `${file} was not put back, because its "model:" line was changed after this tool set it: ${line === undefined ? 'it has none now' : `it is "${line}" now`} (${was}).`])
          continue
        }
        try {
          setAgentLine(file, 'model', c.old)
        } catch (e) {
          // The file cannot be changed any more, mostly because its front matter was taken out by
          // hand. That must not keep the other changes from being put back.
          const why = /has no front matter/.test(e.message) ? 'it has no front matter any more' : `it could not be changed: ${e.message}`
          notPutBack.push(['file', `${file} was not put back, because ${why} (${was}).`])
        }
      }
    },
    inPlace: (args, before) => {
      const changes = before?.changes ?? []
      if (!args) return changes.every(subagentModelIs)
      const target = subagentTarget(args)
      return changes.some((c) => c.kind === target.kind) && subagentModelIs(target)
    },
    back: 'The model of your subagents is set as it was before it.',
    done: (args) => {
      const { kind, model } = subagentTarget(args)
      return kind === undefined
        ? `Set "${SUBAGENT_MODEL}" to ${model} in the "env" of Claude Code's settings. All subagents run on that model.`
        : `Set "model: ${model}" in ${agentFile(kind)}. The subagent "${kind}" runs on that model.`
    },
  },
  'effort-default': {
    what: `Sets "effortLevel" in Claude Code's settings: the effort that sessions start with. The level is medium, or the one that --level names (${EFFORT_LEVELS.join(', ')}).`,
    note: 'New sessions use it. Check the effect with: widal measure effort-default',
    options: ['--level'],
    apply: (bin, args, earlier) => {
      const level = effortLevel(args)
      const value = setSetting('effortLevel', level)
      // Applied before with another level: keep the first value, so that undo still goes all the way back.
      return earlier ? { ...earlier, level } : { value, level }
    },
    undo: (before, bin, notPutBack = []) => putSettingBack('effortLevel', before?.level, before?.value, notPutBack),
    inPlace: (args, before) => read().effortLevel === (args ? effortLevel(args) : before?.level),
    done: (args) => `Set "effortLevel" to ${effortLevel(args)} in Claude Code's settings.`,
  },
  'keep-warm': {
    what: 'An experiment. Adds a hook to Claude Code that runs after each answer. When nobody types and the cache of the session is about to end, it wakes the session with one short turn, so that the cache lasts another hour. Each wake spends some of your plan\'s limit while you are away (money, when you pay by the token). It stops after 3 hours without you, or after the hours that --cap-hours names.',
    note: 'It is an experiment, and it spends your plan\'s limit while you are away: it can cost more than it saves. It stops after the cap. It leaves a session alone when its cache lasts 5 minutes, when its context is small, and while a plan limit is yellow or red. It needs this tool\'s status line with a refresh timer ("widal connect"). Check the effect with: widal measure keep-warm',
    options: ['--cap-hours'],
    apply: (bin, args) => {
      // The cap is checked first, so that a bad one changes nothing.
      const cap = capHours(args)
      // The hook waits in the background for up to an hour: the cache lasts that long.
      setEventHook('Stop', `${bin} hook keep-warm`, true, 3600, { asyncRewake: true })
      const cfg = config()
      saveConfig({ ...cfg, keepWarm: { ...cfg.keepWarm, on: true, capHours: cap } })
      return { capHours: cap }
    },
    undo: (before, bin) => {
      setEventHook('Stop', `${bin} hook keep-warm`, false)
      // A hook that still waits looks at this setting when its wait is over, and then does nothing.
      const cfg = config()
      saveConfig({ ...cfg, keepWarm: { ...cfg.keepWarm, on: false } })
    },
    inPlace: (args) => {
      const k = keepWarmConfig()
      return hookSet('Stop', 'keep-warm') && k.on === true && (!args || k.capHours === capHours(args))
    },
    back: 'The hook is out of Claude Code, and keep-warm is off.',
    done: (args) => `Added a hook to Claude Code that runs after each answer, and turned keep-warm on. It wakes an idle session shortly before its cache ends, for up to ${hours(capHours(args))} without you.`,
  },
  'compact-keep': {
    what: 'Adds a hook to Claude Code that runs before every compaction, automatic or by hand. It gives Claude Code a short text that says what the summary has to keep: the text that "widal compact-keep" shows.',
    note: 'It only adds that text to the instructions for the summary. It never stops a compaction, and it reads nothing of the session. Set your own text with: widal compact-keep "<text>"',
    apply: (bin) => {
      setEventHook('PreCompact', `${bin} hook compact-keep`, true)
      return {}
    },
    undo: (before, bin) => setEventHook('PreCompact', `${bin} hook compact-keep`, false),
    inPlace: () => hookSet('PreCompact', 'compact-keep'),
  },
  'autocompact-window': {
    what: 'Sets "autoCompactWindow" in Claude Code\'s settings: the size of the context, in tokens, at which Claude Code compacts it on its own. Without the setting that is the limit of the model. The size is 300000, or the one that --tokens names (100000 to 1000000).',
    note: 'A compaction replaces the conversation with a summary, and a summary loses detail. Nobody has measured whether the work goes on the same with a smaller context. New sessions use it. Check the effect with: widal measure autocompact-window',
    options: ['--tokens'],
    apply: (bin, args, earlier) => {
      const tokens = compactTokens(args)
      const value = setSetting('autoCompactWindow', tokens)
      // Applied before with another size: keep the first value, so that undo still goes all the way back.
      return earlier ? { ...earlier, tokens } : { value, tokens }
    },
    undo: (before, bin, notPutBack = []) => putSettingBack('autoCompactWindow', before?.tokens, before?.value, notPutBack),
    inPlace: (args, before) => read().autoCompactWindow === (args ? compactTokens(args) : before?.tokens),
    done: (args) => `Set "autoCompactWindow" to ${compactTokens(args)} in Claude Code's settings. Claude Code compacts a context on its own when it reaches that many tokens.`,
  },
  'bash-output-cap': {
    what: 'Sets "bashOutputMaxChars" in Claude Code\'s settings: how many characters of a successful shell command\'s output Claude gets inline. The size is 10000, or the one that --chars names (4000 to 128000). Without the setting it is about 30,000. Longer output goes to a file, and Claude gets a preview of 2,000 characters and the file\'s path.',
    note: 'It needs Claude Code 2.1.261 or later, and then Claude Code no longer reads BASH_MAX_OUTPUT_LENGTH. Claude reads the file when it needs the rest of an output, and each such read is a tool call. Check the effect with: widal measure bash-output-cap',
    options: ['--chars'],
    apply: (bin, args, earlier) => {
      const chars = capChars(args)
      const value = setSetting('bashOutputMaxChars', chars)
      // Applied before with another size: keep the first value, so that undo still goes all the way back.
      return earlier ? { ...earlier, chars } : { value, chars }
    },
    undo: (before, bin, notPutBack = []) => putSettingBack('bashOutputMaxChars', before?.chars, before?.value, notPutBack),
    inPlace: (args, before) => read().bashOutputMaxChars === (args ? capChars(args) : before?.chars),
    done: (args, before) => {
      const lines = [`Set "bashOutputMaxChars" to ${capChars(args)} in Claude Code's settings. Claude gets at most that many characters of a successful command's output inline.`]
      // A value the person had set: say what it was, and how to get it back.
      if (before?.value !== undefined) lines.push(`It was ${inWords(before.value)} before. widal undo bash-output-cap puts that back.`)
      // Claude Code does not read BASH_MAX_OUTPUT_LENGTH while the setting is there. Only a number is printed.
      const env = read().env?.BASH_MAX_OUTPUT_LENGTH
      const shown = (v) => (/^\d{1,9}$/.test(String(v)) ? ` to ${v}` : '')
      if (env !== undefined) lines.push(`BASH_MAX_OUTPUT_LENGTH is set${shown(env)} in the "env" of Claude Code's settings. Claude Code ignores it while "bashOutputMaxChars" is set.`)
      else if (process.env.BASH_MAX_OUTPUT_LENGTH) lines.push(`BASH_MAX_OUTPUT_LENGTH is set${shown(process.env.BASH_MAX_OUTPUT_LENGTH)} in your environment. Claude Code ignores it while "bashOutputMaxChars" is set.`)
      return lines.join('\n')
    },
  },
  // The fixes of the security checks. Each is shown with the finding it fixes (see rules.mjs).
  'no-bypass': {
    what: 'Sets "permissions.disableBypassPermissionsMode" to "disable" in Claude Code\'s settings, and takes out "skipDangerousModePermissionPrompt". Bypass mode, in which every tool call runs without a question, can then no longer start.',
    note: 'New sessions use it. A session that runs in bypass mode now keeps it until it ends.',
    apply: () => {
      const s = read()
      const p = permissionsOf(s)
      const before = { mode: p.disableBypassPermissionsMode, skip: s.skipDangerousModePermissionPrompt, noPermissions: s.permissions === undefined }
      p.disableBypassPermissionsMode = 'disable'
      s.permissions = p
      delete s.skipDangerousModePermissionPrompt
      write(s)
      return before
    },
    undo: (before, bin, notPutBack = []) => {
      const s = read()
      const p = permissionsOf(s)
      let changed = false
      putBack({
        what: '"permissions.disableBypassPermissionsMode" in Claude Code\'s settings', now: p.disableBypassPermissionsMode, set: 'disable', old: before?.mode, notPutBack,
        write: () => {
          if (before?.mode === undefined) delete p.disableBypassPermissionsMode
          else p.disableBypassPermissionsMode = before.mode
          changed = true
        },
      })
      putBack({
        what: '"skipDangerousModePermissionPrompt" in Claude Code\'s settings', now: s.skipDangerousModePermissionPrompt, set: undefined, old: before?.skip, notPutBack,
        write: () => {
          s.skipDangerousModePermissionPrompt = before.skip
          changed = true
        },
      })
      if (!changed) return
      keepPermissions(s, p, before?.noPermissions)
      write(s)
    },
    inPlace: () => {
      const s = read()
      return s.permissions?.disableBypassPermissionsMode === 'disable' && s.skipDangerousModePermissionPrompt === undefined
    },
    back: 'Bypass mode can start again, as before.',
  },
  'deny-secret-files': {
    what: `Adds deny rules to "permissions.deny" in Claude Code's settings, so that Claude Code does not read .env files, private keys and AWS credentials: ${SECRET_DENY.join(', ')}. The other rules stay.`,
    note: 'Open sessions pick it up when Claude Code reads its settings again. A rule that was there already stays when you undo this.',
    apply: () => {
      const s = read()
      const p = permissionsOf(s)
      if (p.deny !== undefined && !Array.isArray(p.deny)) throw new Error(`"permissions.deny" in ${settingsFile()} is not a list, so this tool does not change it.`)
      const added = SECRET_DENY.filter((r) => !p.deny?.includes(r))
      const before = { added, noDeny: p.deny === undefined, noPermissions: s.permissions === undefined }
      p.deny = [...(p.deny ?? []), ...added]
      s.permissions = p
      write(s)
      return before
    },
    undo: (before) => {
      const s = read()
      const p = permissionsOf(s)
      if (!Array.isArray(p.deny)) return
      const added = new Set(before?.added ?? [])
      const rest = p.deny.filter((r) => !added.has(r))
      if (rest.length === p.deny.length) return
      if (before?.noDeny && !rest.length) delete p.deny
      else p.deny = rest
      keepPermissions(s, p, before?.noPermissions)
      write(s)
    },
    inPlace: () => {
      const deny = read().permissions?.deny
      return Array.isArray(deny) && SECRET_DENY.every((r) => deny.includes(r))
    },
    back: 'The deny rules that this tool added are out. Your other rules stay.',
  },
  'tools-unused': {
    what: 'Adds the tools that --tools names to "permissions.deny" in Claude Code\'s settings, so that new sessions start without their definitions. The other rules stay.',
    note: 'New sessions start without those tools. A session that needs one of them can no longer call it. Check the effect with: widal measure tools-unused',
    options: ['--tools'],
    apply: (bin, args, earlier) => {
      const tools = toolsArg(args)
      const s = read()
      const p = permissionsOf(s)
      if (p.deny !== undefined && !Array.isArray(p.deny)) throw new Error(`"permissions.deny" in ${settingsFile()} is not a list, so this tool does not change it.`)
      const added = tools.filter((t) => !p.deny?.includes(t))
      const found = { noDeny: p.deny === undefined, noPermissions: s.permissions === undefined }
      p.deny = [...(p.deny ?? []), ...added]
      s.permissions = p
      write(s)
      // Applied before with other tools: keep what the first apply found, and add to what was added.
      if (earlier) return { ...earlier, added: [...new Set([...(earlier.added ?? []), ...added])], tools: [...new Set([...(earlier.tools ?? []), ...tools])] }
      return { added, tools, ...found }
    },
    undo: (before) => {
      const s = read()
      const p = permissionsOf(s)
      if (!Array.isArray(p.deny)) return
      const added = new Set(before?.added ?? [])
      const rest = p.deny.filter((r) => !added.has(r))
      if (rest.length === p.deny.length) return
      if (before?.noDeny && !rest.length) delete p.deny
      else p.deny = rest
      keepPermissions(s, p, before?.noPermissions)
      write(s)
    },
    inPlace: (args, before) => {
      const tools = args ? toolsArg(args) : before?.tools ?? []
      const deny = read().permissions?.deny
      return Array.isArray(deny) && tools.length > 0 && tools.every((t) => deny.includes(t))
    },
    done: (args) => `Added ${toolsArg(args).join(', ')} to "permissions.deny" in Claude Code's settings. New sessions start without ${toolsArg(args).length === 1 ? 'that tool' : 'those tools'}.`,
    back: 'The tools that this tool denied are allowed again. Your other rules stay.',
  },
  'transcript-days': {
    what: 'Sets "cleanupPeriodDays" and "desktopSessionCleanupPeriodDays" in Claude Code\'s settings to 7 days, or to the days that --days names (1 to 365). Claude Code then deletes session transcripts that are older, also those of desktop and Cowork sessions.',
    note: 'Claude Code deletes the older transcripts at the start of a session, without a message, and /resume no longer shows those sessions. Widal.Code\'s reports read the same transcripts: after this they see that many days at most.',
    options: ['--days'],
    apply: (bin, args, earlier) => {
      const days = transcriptDaysArg(args)
      const s = read()
      const value = { cleanup: s.cleanupPeriodDays, desktop: s.desktopSessionCleanupPeriodDays }
      if (s.cleanupPeriodDays !== days || s.desktopSessionCleanupPeriodDays !== days) {
        s.cleanupPeriodDays = days
        s.desktopSessionCleanupPeriodDays = days
        write(s)
      }
      // Applied before with other days: keep the first values, so that undo still goes all the way back.
      return earlier ? { ...earlier, days } : { ...value, days }
    },
    undo: (before, bin, notPutBack = []) => {
      putSettingBack('cleanupPeriodDays', before?.days, before?.cleanup, notPutBack)
      putSettingBack('desktopSessionCleanupPeriodDays', before?.days, before?.desktop, notPutBack)
    },
    inPlace: (args, before) => {
      const days = args ? transcriptDaysArg(args) : before?.days
      const s = read()
      return s.cleanupPeriodDays === days && s.desktopSessionCleanupPeriodDays === days
    },
    done: (args) => `Set "cleanupPeriodDays" and "desktopSessionCleanupPeriodDays" to ${transcriptDaysArg(args)} in Claude Code's settings. Claude Code deletes transcripts that are older than ${transcriptDaysArg(args)} days.`,
  },
}

/** The arguments of an action as an object: ["--kind", "x"] gives { kind: "x" }. Fails on an argument the action does not take. */
function options(id, args, allowed) {
  const found = {}
  for (let i = 0; i < args.length; i += 2) {
    const [name, value] = [args[i], args[i + 1]]
    if (!allowed.includes(name)) throw new Error(`${id} does not take "${name}". It takes: ${allowed.map((a) => `${a} <value>`).join(', ')}`)
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value after it.`)
    found[name.slice(2)] = value
  }
  return found
}

/** Applies an action. `args` are the arguments that followed its name on the command line. Returns the lines to print. */
export function apply(id, bin, now = Date.now(), args = []) {
  const action = ACTIONS[id]
  if (!action) throw new Error(`There is no action "${id}". The actions are: ${Object.keys(ACTIONS).join(', ')}`)
  const state = applied()
  const asked = action.options ? options(id, args, action.options) : undefined
  if (state[id] && action.inPlace(asked, state[id].before)) return [`${id} is already applied.`]
  const before = action.apply(bin, asked, state[id]?.before)
  // An earlier apply that somebody changed by hand: keep the first "before", so that undo still goes all the way back.
  // An action with options has added to its earlier "before" itself.
  if (!state[id]) state[id] = { at: now, before }
  else if (action.options) state[id].before = before
  save(state)
  return [action.done?.(asked, before) ?? action.what, action.note, `Take it back with: widal undo ${id}`]
}

/** Takes an applied action back. Returns the lines to print. */
export function undo(id, bin) {
  const action = ACTIONS[id]
  if (!action) throw new Error(`There is no action "${id}". The actions are: ${Object.keys(ACTIONS).join(', ')}`)
  const state = applied()
  if (!state[id]) return [`${id} was not applied by this tool, so there is nothing to take back.`]
  const notPutBack = []
  action.undo(state[id].before, bin, notPutBack)
  delete state[id]
  save(state)
  if (notPutBack.length) {
    // How many of a kind were not put back, in words: "one file", "2 settings".
    const count = (kind) => {
      const n = notPutBack.filter(([k]) => k === kind).length
      return n === 0 ? [] : [n === 1 ? `one ${kind}` : `${n} ${kind}s`]
    }
    return [`${id} is taken back, except for ${[...count('file'), ...count('setting')].join(' and ')}.`, ...notPutBack.map(([, sentence]) => sentence)]
  }
  return [`${id} is taken back. ${action.back ?? "Claude Code's settings are as they were before it."}`]
}

/** One line per action: applied or not. */
export function actionsStatus() {
  const state = applied()
  return Object.keys(ACTIONS).map((id) => [id, state[id] ? `applied on ${day(state[id].at)}${ACTIONS[id].inPlace(undefined, state[id].before) ? '' : ', but no longer in the settings'}` : 'not applied'])
}

export const hasState = () => existsSync(stateFile())
