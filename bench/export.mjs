// Writes the runs of a benchmark folder as records that may be shared, one per line.
//
//   node bench/export.mjs --out <folder> [--to <file>] [--send]
//
// The file is <folder>/records.jsonl unless --to names another one. bench/record.mjs says what a
// record holds. Runs that do not count (a "void" reason) are left out.
//
// Nothing is sent without --send. With it, the same records also go to the Widal.Code board that
// this computer is linked to (bench/send.mjs).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBoard } from '../src/board.mjs'
import { ARMS } from './arms.mjs'
import { flags, outDir, paths, readJson, runsOf } from './lib.mjs'
import { publicRecord } from './record.mjs'
import { sendRecords } from './send.mjs'

const f = flags()
const out = outDir(f)
const P = paths(out)
const to = typeof f.to === 'string' ? f.to : join(out, 'records.jsonl')

const records = []
// Only the benchmark's own arms: the runs of an arm from an arms file are never exported.
for (const arm of ARMS) {
  // A run from before the settings were kept in its record gets them from the arm's settings file.
  const kept = readJson(P.settings(arm.id))
  for (const run of runsOf(out, arm.id)) records.push(publicRecord(run, run.settings ?? kept))
}
writeFileSync(to, records.map((record) => `${JSON.stringify(record)}\n`).join(''))
console.log(`${records.length} records are in ${to}`)
if (f.send === true) {
  const result = await sendRecords(records, readBoard())
  console.log(result.text)
  if (!result.ok) process.exitCode = 1
}
