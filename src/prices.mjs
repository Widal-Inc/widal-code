// List prices in US dollars per million tokens, and the cost of one model call.
//
// A provider bills four kinds of tokens on each call:
//   - input that is not in its cache (full price),
//   - input written to its cache (Anthropic: 1.25 times the input price for a 5 minute cache,
//     2 times for a 1 hour cache),
//   - input read from its cache (a small part of the input price),
//   - output, which includes the model's thinking.
// Sources: Anthropic's and OpenAI's pricing and prompt caching documentation, read on 2026-11-12. A file
// ~/.widal/prices.json replaces or adds entries. A model with no entry has no cost: the
// reports then show its tokens and say that the price is unknown.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { home } from './paths.mjs'

const opus = { in: 5, out: 25, read: 0.5 }
const BUILT_IN = {
  'claude-fable-5-2': { in: 8, out: 40, read: 0.2 },
  'claude-mythos-5-2': { in: 8, out: 40, read: 0.2 },
  'claude-fable-5-1': { in: 10, out: 50, read: 0.25 },
  'claude-mythos-5-1': { in: 10, out: 50, read: 0.25 },
  'claude-fable-5': { in: 10, out: 50, read: 1 },
  'claude-mythos-5': { in: 10, out: 50, read: 1 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2 },
  'claude-opus-5': opus,
  'claude-opus-4-8': opus,
  'claude-opus-4-7': opus,
  'claude-opus-4-6': opus,
  'claude-opus-4-5': opus,
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.1 },
  'claude-sonnet-5': { in: 2, out: 10, read: 0.2 },
  'claude-sonnet-4-6': { in: 3, out: 15, read: 0.3 },
  'claude-sonnet-4-5': { in: 3, out: 15, read: 0.3 },
  // Above 100,000 prompt tokens Claude Haiku 5.5 costs five times as much, and so does its cache read
  // ($0.05). From Anthropic's pricing page, read on 2026-11-25. Two test calls above 100,000 tokens
  // gave the same cost here as in Claude Code's own count.
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, longOver: 100_000, long: { in: 0.5, out: 2.5, read: 0.05 } },
  'claude-haiku-4-5': { in: 1, out: 5, read: 0.1 },

  // OpenAI, from its API pricing page, read on 2026-11-12. From GPT-5.6 on, input written to the
  // cache costs 1.25 times the input price (the 30 minute cache): that is `w5` here. Above 272,000
  // input tokens, input costs twice as much and output one and a half times.
  // GPT-6.2, from OpenAI's announcement "Introducing GPT-6.2 Astra and Sol", read on 2026-11-22.
  'gpt-6.2-astra': openai(8, 0.4, 40),
  'gpt-6.2-sol': openai(2, 0.1, 10),
  'gpt-6-astra': openai(10, 1, 50),
  'gpt-6.1-sol': openai(2, 0.1, 10),
  'gpt-6.1-terra': openai(1, 0.05, 5),
  'gpt-6-sol': openai(2, 0.2, 10),
  'gpt-6-luna': openai(0.1, 0.01, 0.5),
  'gpt-5.6-sol': openai(4, 0.4, 20), // A promotional price until 2026-11-30, as the page says.
  'gpt-5.6-terra': openai(2, 0.2, 12),
  'gpt-5.6-luna': openai(0.2, 0.02, 1.2),
  'gpt-5.5': openai(5, 0.5, 30, 1),
}

function openai(input, read, out, write = 1.25) {
  const p = { in: input, read, out, w5: input * write, w1: input * write }
  return { ...p, longOver: 272_000, long: { in: input * 2, read: read * 2, out: out * 1.5, w5: p.w5 * 2, w1: p.w1 * 2 } }
}

/** Anthropic's fee for one web search request made by the model, in dollars. */
export const WEB_SEARCH_FEE = 0.01

let table
function prices() {
  if (table) return table
  table = { ...BUILT_IN }
  try {
    Object.assign(table, JSON.parse(readFileSync(join(home(), 'prices.json'), 'utf8')))
  } catch {
    // No file of the user's own prices.
  }
  return table
}

/** The price entry for a model id, also when the id carries a date or a provider prefix. */
export function priceOf(model) {
  if (!model) return undefined
  const t = prices()
  const id = model.replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.|global\.anthropic\.)/, '').replace(/[-@]\d{8}(-v\d+:\d+)?$/, '')
  if (Object.hasOwn(t, id)) return t[id]
  const key = Object.keys(t).filter((k) => id.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return key ? t[key] : undefined
}

/**
 * The per-token prices of one call, in dollars per token: uncached input, cache write (5 minutes and
 * 1 hour), cache read and output. `undefined` when the model has no price.
 */
export function rates(call) {
  let p = priceOf(call.m)
  if (!p) return undefined
  const prompt = call.in + call.w5 + call.w1 + call.cr
  // `sum` marks tokens added up over many calls: the size of one prompt is then unknown, and the
  // standard price is used.
  if (p.long && prompt > p.longOver && !call.sum) p = p.long
  // Fast mode is twice the standard price on the models that have it. The cache prices double with
  // it: the cache multipliers apply on top of the fast mode price (Anthropic's pricing page, read on
  // 2026-11-25).
  const x = (call.sp === 'fast' ? 2 : 1) / 1e6
  return { in: p.in * x, w5: (p.w5 ?? p.in * 1.25) * x, w1: (p.w1 ?? p.in * 2) * x, read: p.read * x, out: p.out * x }
}

/** What one call cost, split by what was paid for. `known` is false when the model has no price. */
export function cost(call) {
  const r = rates(call)
  if (!r) return { known: false, in: 0, write: 0, read: 0, out: 0, think: 0, web: 0, total: 0 }
  const c = {
    known: true,
    in: call.in * r.in,
    write: call.w5 * r.w5 + call.w1 * r.w1,
    read: call.cr * r.read,
    out: call.out * r.out,
    think: (call.th ?? 0) * r.out,
    web: (call.web ?? 0) * WEB_SEARCH_FEE,
  }
  c.total = c.in + c.write + c.read + c.out + c.web
  return c
}
