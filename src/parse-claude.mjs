// Reads a Claude Code session log and returns one record per model call.
//
// Claude Code writes each session as JSON lines. An assistant message takes one line per content
// block, and each of those lines carries the message's id and its token usage. So a model call is
// one message id, counted once. Between two calls, the lines of type "user" hold the tool results
// and the person's messages that were added to the context. A subagent's session is a file of its
// own in <session>/subagents/. Next to it is a small file, agent-<id>.meta.json, that names the
// kind of the subagent.
//
// Of a shell command (the tool Bash) the name of its program is kept with its result, such as
// "npm" or "git", and nothing else of the command (see program.mjs).
//
// Two signs of how the work went are kept as a count and a flag, never as text. A tool result that
// failed has "is_error": true. When the person interrupts the agent, Claude Code writes a "user"
// line whose text is a fixed marker.
//
// A compaction replaces a long conversation with a summary. Claude Code writes one line of type
// "system" for it, with the numbers of the compaction. Those numbers are kept as facts about the
// session, next to the calls and not as one of them.
//
// The account of each call. Claude Code writes a line of type "session-owner" with the ids of the
// account and of its organisation. It is near the start of a log (in the first 200 bytes on the
// Mac this was checked on, 14 Nov 2026), and it comes again many times further on. A call counts
// to the account of the newest such line before it, and a call before the first line to the
// first one. A subagent's log has no such line: it counts to the account of its session, from
// the start of the session's own log. Older versions of Claude Code (up to 2.1.314 on that Mac)
// wrote no such line. A log without it counts to "unknown", unless its calls went through a
// cloud provider: Amazon Bedrock gives the id of an answer the start "msg_bdrk_", and Google's
// Vertex AI "msg_vrtx_". Nothing in a log tells that a session used an API key.
//
// The log format is internal to Claude Code and changes between versions. This parser reads only
// the fields it needs and skips what it does not know. It also checks the type of each value it
// keeps. A name that is not text, or a count that is not a number, would make every report fail
// for as long as that log is read.
import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { programOf } from './program.mjs'

// Lines of other types are never parsed. Some are very large.
const WANTED = ['"type":"assistant"', '"type":"user"', '"type":"system"', '"type":"attachment"', '"type":"cost-state"', '"type":"session-owner"']

// An id of an account or of an organisation is taken only when it is a plain id: letters, digits
// and dashes. It becomes a part of a key and a file holds it, so nothing else can get in that way.
const ID = /^[A-Za-z0-9-]{1,64}$/
// The start of the id of an answer that came through a cloud provider: Amazon Bedrock, Google's Vertex AI.
const CLOUD_ID = /^msg_(bdrk|vrtx)_/
/** How much of the start of a log is read to find its account. */
export const HEAD = 8192

// The attachments that put text into the context. Others are Claude Code's own bookkeeping.
const CONTEXT_ATTACHMENTS = new Set([
  'file', 'edited_text_file', 'compact_file_reference', 'skill_listing', 'invoked_skills', 'instructions',
  'mcp_instructions_delta', 'deferred_tools_delta', 'agent_listing_delta', 'queued_command', 'hook_additional_context',
])

// The kinds of instruction files that Claude Code puts into a session's start ("instructions").
const INSTRUCTION_KINDS = new Set(['User', 'Project', 'Local', 'Managed', 'AutoMem'])
// A plugin's skill in the list of skills: "<plugin>:<skill>".
const PLUGIN_SKILL = /^([A-Za-z0-9._-]{1,64}):[^:]+$/

/**
 * The standing text that one attachment brings, as `[source, characters]`: each instruction file
 * (CLAUDE.md, AGENTS.md and the files they name, and the automatic memory) by its kind and path,
 * the skills of each plugin in the list of skills, and the text that a hook added. A path in the
 * home folder starts with "~", so that the name of the person's home folder is not kept. Nothing
 * of the text itself is kept.
 */
export function standingOf(a, homeDir = process.env.HOME ?? '') {
  if (a.type === 'instructions' && Array.isArray(a.files)) {
    return a.files.filter((f) => isObject(f) && INSTRUCTION_KINDS.has(f.type) && text(f.path) && typeof f.content === 'string')
      .map((f) => [`${f.type} ${homeDir && f.path.startsWith(`${homeDir}/`) ? `~${f.path.slice(homeDir.length)}` : f.path}`, f.content.length])
  }
  if (a.type === 'skill_listing' && typeof a.content === 'string') {
    const byPlugin = new Map()
    for (const line of a.content.split('\n')) {
      const m = /^- ([^:\s]+:[^:\s]+):/.exec(line)
      const plugin = m && PLUGIN_SKILL.exec(m[1])?.[1]
      if (plugin) byPlugin.set(plugin, (byPlugin.get(plugin) ?? 0) + line.length + 1)
    }
    return [...byPlugin].map(([plugin, chars]) => [`plugin ${plugin}`, chars])
  }
  if (a.type === 'hook_additional_context') {
    const event = [a.hookEvent, a.hookName].find((n) => typeof n === 'string' && /^[A-Za-z]{1,40}$/.test(n)) ?? 'other'
    return [[`hook ${event}`, JSON.stringify(a.content ?? '').length]]
  }
  return []
}

// What Claude Code writes when the person interrupts the agent: "[Request interrupted by user]",
// or the same with " for tool use" before the bracket closes.
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/

// A count that is not a number is taken as 0, so that it cannot turn a sum into text or into "not a number".
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A value when it is text that is not empty, else undefined. */
const text = (v) => (typeof v === 'string' && v ? v : undefined)

const textSize = (content) => {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const b of content) {
    if (typeof b === 'string') n += b.length
    else if (b?.type === 'text' && typeof b.text === 'string') n += b.text.length
    else if (b?.type === 'tool_result') n += textSize(b.content)
  }
  return n
}

/**
 * What a tool result adds to the context: `[tool, characters, signature, program, failed]`. The
 * signature is that of the tool call (see below), so that the result of a repeated call can be
 * found. The program is there for a shell command only, else null when `failed` follows. `failed`
 * is 1 for a result that Claude Code marked as an error, and is left out otherwise. A result
 * whose call is not known is `['(unknown tool)', characters]`.
 */
export function resultEntry(use, size, program, failed = false) {
  if (!use) return ['(unknown tool)', size]
  const entry = [use[0], size, use[1]]
  if (program !== undefined || failed) entry.push(program ?? null)
  if (failed) entry.push(1)
  return entry
}

/** The meta file next to a subagent's log: agent-<id>.meta.json for agent-<id>.jsonl. */
export const metaFile = (file) => file.replace(/\.jsonl$/, '.meta.json')

/**
 * The kind of a subagent, for example "Explore" or the name of one of the person's own subagents.
 * Claude Code writes it as "agentType" into the meta file next to the subagent's log. The log
 * itself does not name it. Undefined when there is no meta file or it names no kind.
 */
export function subagentKind(file) {
  try {
    const kind = JSON.parse(readFileSync(metaFile(file), 'utf8')).agentType
    return typeof kind === 'string' && kind ? kind : undefined
  } catch {
    return undefined
  }
}

/** The account key of a "session-owner" line, `{ key, orgId }`, or undefined when its account id is not a plain id. */
function ownerOf(d) {
  if (typeof d?.accountUuid !== 'string' || !ID.test(d.accountUuid)) return undefined
  return { key: `claude:${d.accountUuid}`, orgId: typeof d.organizationUuid === 'string' && ID.test(d.organizationUuid) ? d.organizationUuid : undefined }
}

/**
 * The account of a session, from the start of its log: at most the first `bytes` bytes are read.
 * Gives `{ key, orgId, complete }`. The key is "claude:<account id>" from the first
 * "session-owner" line, else "cloud" when an answer came through a cloud provider, else
 * "unknown". `complete` says that a later look cannot find more: the line or a cloud answer was
 * found, the log is at least `bytes` long, or it has an answer already (Claude Code writes the
 * line before the first answer). A log that is not there, or is not a file, gives no key: a pipe
 * is never opened, because that would wait for its other end.
 */
export function accountInHead(file, bytes = HEAD) {
  let text
  let size
  try {
    if (!statSync(file).isFile()) return { key: undefined, complete: false }
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(bytes)
      size = readSync(fd, buf, 0, bytes, 0)
      text = buf.toString('utf8', 0, size)
    } finally {
      closeSync(fd)
    }
  } catch {
    return { key: undefined, complete: false }
  }
  // A read that filled the buffer can end in the middle of a line. That line is not used.
  const lines = text.split('\n')
  if (size === bytes) lines.pop()
  let cloud = false
  let answered = false
  for (const line of lines) {
    try {
      if (line.includes('"type":"session-owner"')) {
        const owner = ownerOf(JSON.parse(line))
        if (owner) return { ...owner, complete: true }
      } else if (!cloud && line.includes('"type":"assistant"')) {
        const id = JSON.parse(line).message?.id
        answered = true
        cloud = typeof id === 'string' && CLOUD_ID.test(id)
      }
    } catch {
      // A line that is broken, or not in the shape this reader knows.
    }
  }
  if (cloud) return { key: 'cloud', complete: true }
  return { key: 'unknown', complete: size === bytes || answered }
}

// The account of each session that subagents' logs belong to. A session can have hundreds of
// subagents, so the start of its log is read once in a run. Only an answer that a later look
// cannot change is kept.
const sessionHeads = new Map()
function sessionHead(file) {
  if (sessionHeads.has(file)) return sessionHeads.get(file)
  const head = accountInHead(file)
  if (head.complete) sessionHeads.set(file, head)
  return head
}

export class ClaudeParser {
  /** @param {string} file The path of the session log. */
  constructor(file) {
    this.file = file
    // A subagent's log is below <session>/subagents/, also when a workflow started it
    // (<session>/subagents/workflows/...). Its spend belongs to that session.
    const at = file.indexOf('/subagents/')
    this.agent = at >= 0 ? basename(file, '.jsonl') : undefined
    this.kind = at >= 0 ? subagentKind(file) : undefined
    this.session = at >= 0 ? basename(file.slice(0, at)) : basename(file, '.jsonl')
    // The account: of the newest "session-owner" line, of the first one, and of the session that
    // a subagent's log belongs to, from the start of the session's own log.
    this.account = undefined
    this.firstAccount = undefined
    this.parent = at >= 0 ? sessionHead(`${file.slice(0, at)}.jsonl`) : undefined
    this.orgs = new Map()
    this.cloud = false
    this.records = []
    this.byId = new Map()
    this.toolUse = new Map()
    this.programs = new Map()
    this.pending = []
    this.standing = []
    this.errors = 0
    this.interrupted = false
    this.afterCompact = false
    this.cwd = undefined
    this.costState = undefined
    this.compactions = []
  }

  /** Takes the next line of the log. It never throws: a line it cannot read is skipped. */
  feed(line) {
    if (!WANTED.some((w) => line.includes(w))) return
    try {
      const d = JSON.parse(line)
      if (text(d.cwd) && !this.cwd) this.cwd = d.cwd
      if (d.type === 'assistant') this.#assistant(d)
      else if (d.type === 'user') this.#user(d)
      else if (d.type === 'attachment') this.#attachment(d)
      else if (d.type === 'system' && d.subtype === 'compact_boundary') {
        this.afterCompact = true
        this.#compaction(d)
      }
      else if (d.type === 'cost-state') this.costState = { total: d.totalCostUSD, models: d.modelUsage }
      else if (d.type === 'session-owner') {
        const owner = ownerOf(d)
        if (!owner) return
        this.account = owner.key
        this.firstAccount ??= owner.key
        if (owner.orgId) this.orgs.set(owner.key, owner.orgId)
      }
    } catch {
      // A line that is still being written, broken, or not in the shape this reader knows.
    }
  }

  #assistant(d) {
    const m = d.message
    const u = m?.usage
    // A line whose id or model is not text, or whose usage is not an object, is not an answer in
    // the shape this reader knows. It is skipped, so that no value of another type gets into a record.
    if (!text(m?.id) || !text(m.model) || !isObject(u) || m.model === '<synthetic>') return
    let r = this.byId.get(m.id)
    if (!r) {
      r = {
        s: 'claude', f: this.file, ses: this.session, agent: this.agent, at: this.kind, cwd: text(d.cwd) ?? this.cwd,
        br: text(d.gitBranch), ts: Date.parse(d.timestamp) || 0, id: m.id, m: m.model, ef: d.effort,
        in: 0, w5: 0, w1: 0, cr: 0, out: 0, th: 0, web: 0, tools: [], add: this.pending, acct: this.account,
      }
      if (CLOUD_ID.test(m.id)) this.cloud = true
      if (this.afterCompact) r.ac = true
      // The standing text that came in before this call (see standingOf).
      if (this.standing.length) {
        r.st = this.standing
        this.standing = []
      }
      // What happened before this call: tool results that failed, and an interrupt by the person.
      if (this.errors) r.err = this.errors
      if (this.interrupted) r.intr = 1
      this.pending = []
      this.afterCompact = false
      this.errors = 0
      this.interrupted = false
      this.byId.set(m.id, r)
      this.records.push(r)
    }
    // Every line of a message repeats its usage. The last one is complete.
    const split = isObject(u.cache_creation) ? u.cache_creation : undefined
    r.in = num(u.input_tokens)
    r.cr = num(u.cache_read_input_tokens)
    r.w1 = num(split?.ephemeral_1h_input_tokens)
    r.w5 = split ? num(split.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens)
    r.out = Math.max(r.out, num(u.output_tokens))
    r.th = Math.max(r.th, num(u.output_tokens_details?.thinking_tokens))
    r.web = num(u.server_tool_use?.web_search_requests)
    if (text(u.speed) && u.speed !== 'standard') r.sp = u.speed
    for (const b of Array.isArray(m.content) ? m.content : []) {
      // A tool call whose name is not text is not one this reader knows. Its result, if one
      // comes, counts as the result of an unknown tool.
      if (b?.type !== 'tool_use' || !text(b.name) || this.toolUse.has(b.id)) continue
      // The same tool with the same input has the same signature: this finds repeated calls.
      const sig = createHash('sha1').update(b.name).update(JSON.stringify(b.input ?? null)).digest('hex').slice(0, 8)
      const use = [b.name, sig]
      this.toolUse.set(b.id, use)
      // Of a shell command only the name of its program is kept, never the command (see program.mjs).
      if (b.name === 'Bash') this.programs.set(b.id, programOf(b.input?.command))
      r.tools.push(use)
    }
  }

  #user(d) {
    // The summary that replaced the old context is counted as the new context's start, not here.
    if (d.isCompactSummary) return
    // Text that Claude Code put in for the agent (a skill's instructions, for example), not typed by the person.
    const typed = d.isMeta ? '(skills and instructions loaded)' : '(your messages)'
    const content = d.message?.content
    if (typeof content === 'string') {
      if (INTERRUPTED.test(content)) this.interrupted = true
      if (content.length) this.pending.push([typed, content.length])
      return
    }
    for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === 'tool_result') {
        const use = this.toolUse.get(b.tool_use_id)
        this.pending.push(resultEntry(use, textSize(b.content), this.programs.get(b.tool_use_id), b.is_error === true))
        if (b.is_error === true) {
          this.errors++
          // The tool call is marked too: a third item, 1, after its name and signature.
          if (use) use[2] = 1
        }
      } else if (b?.type === 'text' && text(b.text)) {
        if (INTERRUPTED.test(b.text)) this.interrupted = true
        this.pending.push([typed, b.text.length])
      }
    }
  }

  /**
   * Keeps the facts of one compaction: when it was, what started it ("auto" or "manual"), the
   * tokens in the context before and after it, and the seconds it took. With them go the session,
   * its folder, and the subagent when the log is one of a subagent.
   *
   * A line whose "compactMetadata" does not have all of these in the shape this reader knows is
   * not kept. Its numbers could not be trusted, and one wrong number would spoil a median.
   */
  #compaction(d) {
    const m = d.compactMetadata
    // Claude Code writes the time as text. A number would be read as a date too, and a wrong one.
    const ts = text(d.timestamp) ? Date.parse(d.timestamp) : NaN
    const amount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    if (!isObject(m) || !Number.isFinite(ts) || (m.trigger !== 'auto' && m.trigger !== 'manual')) return
    if (!amount(m.preTokens) || m.preTokens === 0 || !amount(m.postTokens) || !amount(m.durationMs)) return
    this.compactions.push({
      ts, trigger: m.trigger, pre: m.preTokens, post: m.postTokens, sec: m.durationMs / 1000,
      ses: this.session, agent: this.agent, cwd: text(d.cwd) ?? this.cwd,
    })
  }

  #attachment(d) {
    const a = d.attachment
    if (!a || !CONTEXT_ATTACHMENTS.has(a.type)) return
    this.pending.push([`(attached: ${a.type})`, JSON.stringify(a).length])
    this.standing.push(...standingOf(a))
  }

  /**
   * What the file gave: the calls, and what is kept about the session next to them. That is
   * Claude Code's own cost figure for the session if it wrote one, the session's compactions, and
   * the organisation id of each account in the log.
   *
   * A call that came before the first "session-owner" line counts to the first account in the
   * log. In a log without such a line, the calls count to the account of the session that a
   * subagent belongs to, else to "cloud" or "unknown".
   */
  result() {
    const parent = this.parent?.key !== 'unknown' ? this.parent?.key : undefined
    const fallback = this.firstAccount ?? parent ?? (this.cloud ? 'cloud' : 'unknown')
    for (const r of this.records) r.acct ??= fallback
    if (this.parent?.orgId) this.orgs.set(this.parent.key, this.parent.orgId)
    return { records: this.records, meta: { costState: this.costState, compactions: this.compactions, orgs: Object.fromEntries(this.orgs) } }
  }
}
