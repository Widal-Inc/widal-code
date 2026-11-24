// Finds the session logs on this machine, parses them, and keeps the parsed result in a cache.
//
// A log that has not changed since it was parsed is read from the cache. A log that has changed is
// parsed again from the start. So is a subagent's log of Claude Code when the meta file next to it
// has changed, because the kind of the subagent comes from that file. The cache is in this tool's
// own folder, and nothing here sends anything.
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { config } from './config.mjs'
import { ClaudeParser, metaFile } from './parse-claude.mjs'
import { CodexParser } from './parse-codex.mjs'
import { CoworkParser } from './parse-cowork.mjs'
import { claudeDirs, codexDir, coworkDir, home, realPath } from './paths.mjs'

// Raise this when a parser changes what it writes: older cache files are then parsed again.
const CACHE_VERSION = 14

function logsBelow(dir) {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  } catch {
    return []
  }
}

function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * The Cowork session logs: the .jsonl files directly inside a folder local_<id>. The app keeps
 * those folders two folders below `dir` (<id>/<id>/local_<id>). A session's folder also holds the
 * session's own files (in outputs, for example). Those are not logs, so nothing deeper inside a
 * local_<id> folder is looked at.
 */
function coworkLogs(dir, depth = 0) {
  const out = []
  for (const e of entriesOf(dir)) {
    if (!e.isDirectory()) continue
    const path = join(dir, e.name)
    if (e.name.startsWith('local_')) out.push(...entriesOf(path).filter((f) => f.isFile() && f.name.endsWith('.jsonl')).map((f) => join(path, f.name)))
    else if (depth < 2) out.push(...coworkLogs(path, depth + 1))
  }
  return out
}

/**
 * The size and the time of the meta file next to a subagent's log of Claude Code. Both are
 * undefined for any other log, and when there is no meta file. They are kept with the parsed log,
 * so that a meta file that appears or changes later is noticed while the log stays the same.
 */
function metaState(file, source) {
  if (source !== 'claude' || !file.includes('/subagents/')) return {}
  try {
    const st = statSync(metaFile(file))
    return { metaSize: st.size, metaMtimeMs: st.mtimeMs }
  } catch {
    return {} // No meta file.
  }
}

/**
 * The logs of Claude Code, from every config folder that Widal.Code knows (see claudeDirs in
 * paths.mjs). Two config folders can share their folder projects through a link: it is read once.
 */
function claudeLogs() {
  const seen = new Set()
  const out = []
  for (const dir of claudeDirs({ more: config().claudeDirs })) {
    const projects = join(dir, 'projects')
    const real = realPath(projects)
    if (seen.has(real)) continue
    seen.add(real)
    out.push(...logsBelow(projects))
  }
  return out
}

/**
 * Every session log of the agents this tool reads, with the agent it belongs to. `sources` names
 * the agents to look for, when not all of them: a folder that is not wanted is not listed at all.
 */
export function logFiles(sources = ['claude', 'codex', 'cowork']) {
  const wanted = (source, list) => (sources.includes(source) ? list().map((file) => ({ file, source })) : [])
  return [
    ...wanted('claude', claudeLogs),
    ...wanted('codex', () => logsBelow(join(codexDir(), 'sessions'))),
    ...wanted('cowork', () => coworkLogs(coworkDir())),
  ]
}

export async function parseFile(file, source) {
  const parser = source === 'codex' ? new CodexParser(file) : source === 'cowork' ? new CoworkParser(file) : new ClaudeParser(file)
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) parser.feed(line)
  return parser.result()
}

/**
 * The model calls since `since` (milliseconds), from every log that changed after it.
 * `progress` is called with the number of logs parsed so far and the number to parse.
 * `callsFrom` keeps the calls from an earlier time on, from the same logs. Today's numbers use
 * it: a session's first call of the day is compared with its call before, to see whether the
 * cache had ended in between.
 */
export async function load({ since = 0, sources, progress, callsFrom = since } = {}) {
  const cacheDir = join(home(), 'cache')
  mkdirSync(cacheDir, { recursive: true })
  const todo = []
  const out = { records: [], metas: new Map() }
  for (const { file, source } of logFiles(sources)) {
    let st
    try {
      st = statSync(file)
    } catch {
      continue
    }
    if (st.mtimeMs < since) continue
    const cacheFile = join(cacheDir, `${createHash('sha1').update(file).digest('hex')}.json`)
    let cached
    try {
      cached = JSON.parse(readFileSync(cacheFile, 'utf8'))
    } catch {
      // Not parsed yet.
    }
    const state = metaState(file, source)
    const same = cached?.v === CACHE_VERSION && cached.size === st.size && cached.mtimeMs === st.mtimeMs && cached.metaSize === state.metaSize && cached.metaMtimeMs === state.metaMtimeMs
    if (same) take(out, file, cached)
    else todo.push({ file, source, st, state, cacheFile })
  }
  let done = 0
  for (const t of todo) {
    progress?.(done++, todo.length)
    const parsed = await parseFile(t.file, t.source)
    const entry = { v: CACHE_VERSION, size: t.st.size, mtimeMs: t.st.mtimeMs, ...t.state, ...parsed }
    const tmp = `${t.cacheFile}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(entry))
    renameSync(tmp, t.cacheFile)
    take(out, t.file, entry)
  }
  if (todo.length) progress?.(todo.length, todo.length)
  // A resumed session repeats earlier messages in a new log: a call is counted once, by its id.
  const seen = new Set()
  out.records = out.records
    .filter((r) => r.ts >= callsFrom && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => a.ts - b.ts)
  return out
}

function take(out, file, entry) {
  for (const r of entry.records) out.records.push(r)
  out.metas.set(file, entry.meta ?? {})
}
