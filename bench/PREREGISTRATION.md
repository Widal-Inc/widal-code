# Pre-registration: Widal.Code benchmark, version 1

Written on 22 Nov 2026, before the pilot and before any result of version 1 was seen. It fixes the
questions, the measures, the analysis and the rules for stopping and for leaving trials out. Any
change after this date is listed at the end, with its date and its reason. Every result is
published, whatever it shows.

## Questions

1. Does Widal.Code lower the cost of a task against the baseline, and by how much?
2. Does Widal.Code keep the share of tasks solved? It may fall by at most 3 points.
3. Does Widal.Code add anything beyond the largest single change it proposes? In version 0.1 almost
   all of the saving came from one change, the lower effort level.
4. Which of Widal.Code's proposals save money, which do nothing, and which cost quality, and how far
   was each predicted saving from the measured one?
5. What do three other open source tools that promise a lower token cost do against the same
   baseline, and which savings do they find that Widal.Code misses?

## Tasks

The 301 tasks in `bench/harbor/v1-tasks.json`, picked with the seed 20261122 from four public task
sets in Harbor's registry: SWE-rebench July 2026 (all 111), the SWE-rebench leaderboard from March
2026 on (80 at random of 110), SWE-bench Pro in its version with GitHub blocked (15 per language for
Python, Go, JavaScript and TypeScript, one repository after another), and Terminal-Bench 2.1 (all 31
software engineering and debugging tasks and 19 others at random). A task whose reference solution
fails Harbor's oracle check is left out before the pilot and listed in the report.

In every container GitHub is blocked by the same step, for every setup.

## Setups

All setups run Claude Code 2.1.330 through Harbor 0.27.0 with `bench/harbor/setup_agent.py`: the
permission mode "dontAsk" with the same list of allowed tools, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`
(the API organization of the run refuses Claude Code's context management), no auto memory, and a
budget per session of $4 on Sonnet 5.5 and $15 on Fable 5.2.

| Stage | Model | Setups |
| --- | --- | --- |
| Pilot, 40 tasks | Sonnet 5.5 | baseline twice, Widal.Code |
| Main, all tasks the budget allows (at least 150) | Sonnet 5.5 | baseline, Widal.Code, the three other tools |
| Attribution, 100 of the main tasks | Sonnet 5.5 | each change Widal.Code proposed, alone |
| Fable, 100 of the main tasks | Fable 5.2 | baseline at effort xhigh, effort high alone, Widal.Code |

- **Baseline:** Claude Code's default settings for the model (no effort level set), no tool. On the
  Fable stage: effort xhigh.
- **Widal.Code:** made as a person would use it. The baseline's sessions of the pilot are read with
  `widal advise --json` and `widal findings`; every proposal Widal.Code can apply itself is applied
  with `widal apply`; its hooks are on. The proposals and their predicted savings are committed to
  this repository before the main stage starts. Nobody adds or removes a proposal by hand.
- **The three other tools:** each set up as its own install sets it up, with its telemetry off. Their
  names, versions and settings are in the report.

## Order

The tasks of a stage are shuffled with the seed 20261122 and run in blocks of 25. Every setup of the
stage runs every task of a block, side by side, before the next block starts (`bench/harbor-stage.mjs`).
All setups of a stage use the same provider.

## Measures

- **Main:** the cost of the tasks as the ratio of the totals against the baseline, on the tasks both
  ran; and the share of tasks solved. A task is solved when its reward from Harbor's verifier is 1.
- **Also:** the cost per solved task, the wall time (within a stage only), output tokens, turns, the
  tasks solved by one side only, and the results per task set, per language and per month in which
  the task was created.
- Cost is what Claude Code reports at list prices, subagents included. Widal.Code's own computation
  from the logs and the providers' bills are set against it in the report.

## Analysis

- Intervals: 95%, from resampling the tasks with replacement, 10,000 draws, seed 1 (`bench/stats.mjs`).
- Sign test on the cost of each task against the baseline.
- Question 1 is answered yes when the interval of the cost ratio lies below 1.
- Question 2 is answered yes when the lower end of the 95% interval of the difference in the share
  solved (Widal.Code minus baseline, paired by task) is above minus 3 points.
- Question 3 compares Widal.Code with its largest single change on the attribution stage, both ways.
- No result is called a difference when its interval includes no change.

## What is left out, and what counts

- A trial that ended on an error of the harness before the agent spent anything is left out and
  listed. It is run once more when the stage is run again.
- A session that reached its time limit or its budget, or ended on an error of the agent or the API,
  counts as not solved, in every setup alike.

## Stop rules

- A stage stops at 90% of its cap, and every stage stops when a provider reached 90% of its cap
  ($1,500 on the API key, $1,500 on Bedrock).
- A stage stops when more than 10% of a block's trials ended on an error of the harness, until the
  cause is found.
- Safety: a setup that solved 20 points fewer tasks than the baseline after two blocks is stopped and
  reported as such.
- During a stage only the spend and the health of the run are looked at, never the comparison
  between the setups.

## Changes after 22 Nov 2026

### Change 1, 22 Nov 2026, during the pilot and before any comparison of it was seen

Why: a review of this plan against the published standards for agent benchmarks (Zhu et al. 2025,
Kapoor et al. 2024, Miller 2024, Bjarnason et al. 2026; the review is in Widal's company repository,
`research/2026-11-22-benchmark-review.md`) found five gaps, and Nils asked for only the newest models.
While the pilot ran, only its spend and health were looked at, as the stop rules say. These changes
replace the parts of the plan above that they name; everything else stays.

1. **The 40 pilot tasks count in no comparison.** Widal.Code's setup is made from the baseline's pilot
   sessions, so every main, quality, attribution and model stage leaves the pilot's tasks out
   (`bench/harbor-make-stage.mjs --exclude-from`). The pilot still measures the noise between two runs.
2. **Every task runs twice per setup** in the main and quality stages and in the model stages for
   Haiku 5.5 and Opus 5.5. Fable 5.2 runs once, for cost. Runs are paired by task and run number, and
   every interval resamples the tasks and then the runs inside each task (`clusteredRatio`,
   `clusteredSolvedDifference` in `bench/stats.mjs`). The sign test uses each task's mean.
3. **Question 2 gets enough tasks.** A quality stage on Sonnet 5.5 adds the 644 tasks of
   `bench/harbor/v1-tasks-extra.json` (seed 20261123: 185 more of SWE-bench Pro, 420 more of the
   SWE-rebench leaderboard, the 39 other Terminal-Bench 2.1 tasks), after the same oracle check, with
   the baseline and Widal.Code only. Question 2 is answered on the main and quality stages together.
   The margin stays 3 points. If fewer tasks pass the oracle or the budget stops the stage early, the
   report states the margin the tasks reached (the half-width of the interval) and answers question 2
   only against that margin.
4. **One primary measure per question, and a correction for several comparisons.** Question 1: the
   ratio of total cost, Widal.Code against the baseline, main stage. Question 2: the paired difference
   in the share solved, main and quality stages. Question 5: the ratio of total cost of each other tool
   against the baseline, with the sign test's chance corrected by Holm's method over the ranked tools.
   Every other number is exploratory and is labelled so.
5. **The proxy tool is reported, not ranked.** This API organization refuses the proxy's tool search, so
   the proxy runs with its tool search turned off, without one of its savings. It is in a table of its
   own with no rank and no Holm chance (`bench/harbor.mjs report --unranked`).

**Models: only the newest.** All Claude stages run on Claude Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable
5.2, and the OpenAI stage on GPT-6.2 Astra and GPT-6.2 Sol. No older model is used anywhere. All
Claude models run with their 1M context window, which is their default.

| Stage | Model | Setups | Tasks | Runs |
| --- | --- | --- | --- | --- |
| Pilot (done) | Sonnet 5.5 | baseline twice, Widal.Code | 40 | 1 |
| Main | Sonnet 5.5 | baseline, Widal.Code, the three other tools (the proxy tool unranked) | all that passed the oracle, minus the pilot's | 2 |
| Quality | Sonnet 5.5 | baseline, Widal.Code | the extra tasks that pass the oracle | 2 |
| Attribution | Sonnet 5.5 | each change Widal.Code proposed, alone | 100 of the main tasks | 2 |
| Haiku 5.5 | Haiku 5.5 | baseline; Widal.Code made from Haiku's own pilot sessions | 150 of the main tasks | 2 |
| Opus 5.5 | Opus 5.5 | baseline; Widal.Code made from Opus's own pilot sessions | 100 of the main tasks | 2 |
| Fable 5.2 | Fable 5.2 | baseline at effort xhigh; effort high alone; Widal.Code made from Fable's own pilot sessions | 80 of the main tasks | 1 |
| OpenAI | GPT-6.2 Astra and Sol, in Codex | each model alone (no Widal.Code setup for Codex) | 100 of the main tasks | 2 |

Each model stage first runs its own baseline on the 40 pilot tasks, once, and makes Widal.Code's setup
from those sessions, as a person on that model would; those pilot runs count in no comparison. The
OpenAI stage starts only when an OpenAI API key is stored for the runner, with a cap of its own ($500).
The Bedrock cap stays: Claude 5 models on Bedrock run only once AWS lifts this account's quota of 0
tokens per minute for them (requested on 22 Nov 2026), as a second run of the model stages on the same
tasks. The stages run in the order of the table, and the API cap stops the later ones first.

**Cost of a trial that reports none.** Harbor's Codex agent leaves the cost empty for a model its price
list does not know. Such a trial is priced from its tokens at Widal.Code's list prices (`costOf` in
`bench/harbor.mjs`, `costSource: "tokens"`), with input that is not read from the cache priced as
uncached input.

## Recorded before the main stage, 22 Nov 2026

The pilot ran from 20:00 to 22:40 UTC on 22 Nov 2026, with no errors of the harness or the agent, for
$18.45 on the API key. These files were written by code from the pilot's records and are committed before
the main stage starts:

- `bench/harbor/v1-pilot/widal-on.proposals.json`: what `widal advise --json` proposed from the
  baseline's 67 pilot sessions, with the predicted saving of each proposal, and what `widal apply`
  changed. Its SHA-256 is `fe31385aa0ba08198860a972ab2779eb8ceecee63ae0045e25ddb9bf2938d70f`. It holds
  one proposal: cap the shell output that Claude reads inline at 10,000 characters, predicted to save
  $0.11 of $9.90 (1%). `widal-on.advise.txt` is the same advice as text.
- `bench/harbor/v1-pilot/oracle-dropped.json`: the 12 of the 301 tasks whose reference solution did not
  pass Harbor's oracle check (6 environments of SWE-rebench July 2026 that did not start, and 6 tasks
  whose solution failed its own tests). 289 tasks remain, 40 of them the pilot's.

The pilot's report was read after these files were made and before the main stage started. No part of
the plan changed after it. The only edit in this commit to the text above replaces the other tools'
names with their roles. The report names them, with their versions and settings.

## Correction, 22 Nov 2026, after the first start of the main stage

Two faults of the stage runner were found after the section above was written. Neither changes the plan.

- **Two runs of one setup shared a job folder.** The pilot's two baseline runs wrote into the same folder
  per block. Once in each block both started a task set in the same second, Harbor gave them the same job
  folder, and 13 of the first run's 40 trials were lost. The import also read the whole folder for each
  run, so 32 of the second run's trials were filed as the first run's. Widal.Code's proposals are not
  affected: `widal advise` read the 67 sessions that remained, and all of them are baseline sessions of the
  pilot. The noise between two runs is measured on the 27 tasks that kept both runs. The ledger counts only
  the trials it could read, so the spend of the 13 lost trials is missing from it. The providers' bills are
  set against the ledger in the report.
- **The first start of the main stage failed in the harness.** It began at 23:00 UTC with ten setups of
  three trials each at once. Ten Harbor processes built the same task images at the same time, and the
  builds and the setup of the agent failed: 62 of the first 74 trials ended on an error of the harness. It
  was stopped at 23:32 UTC. All of its trials are set aside and listed in the report with their spend,
  and the stage starts again from the first block.

The fix (widal-code PR 17): every setup has job folders of its own, the import files a trial only under
the setup that ran it and never replaces a finished trial with a failed one, builds of one task image are
locked across Harbor's processes, and Harbor gets twice its usual time to set up the agent. The main
stage runs two trials at a time per setup instead of three.


## Correction, 23 Nov 2026: Docker ran out of network addresses

The second start of the main stage, at 23:42 UTC on 22 Nov, failed in the harness too. Each trial runs in
a Docker network of its own, and Docker's default address pools hold about 30 networks. The networks left
by the stopped first start, the 20 trials of the main stage and the oracle check of the extra tasks took
them all, and 175 trials could not start their container. None of them reached the agent or spent money.
The stage was stopped at 00:00 UTC on 23 Nov. Its 175 records were removed (all were errors of the harness,
with no cost), its job folders were set aside, and Docker was given an address pool of 256 networks
(`default-address-pools` 10.210.0.0/16 in /24 networks). The stage started again at 00:03 UTC from the
first block. The plan did not change.

## Change 2, 23 Nov 2026, before any result of the main stage was seen

Two stages are added after the stages of change 1. They run on the same 100 tasks as the Opus 5.5 stage
(the same sample, picked with the same seed), so that each arm can be set against that stage's baseline.

| Stage | Model | Setups | Tasks | Runs | Cap |
| --- | --- | --- | --- | --- | --- |
| Opus 5.5, fast mode | Opus 5.5 | the Opus baseline with fast mode on (Claude Code's `--fast-mode on`) | the Opus stage's 100 | 1 | $150 |
| OpenAI | GPT-6.2 Sol, then GPT-6.2 Astra, in Codex | each model alone | the Opus stage's 100 | 2 each | $400 each, $900 for OpenAI in all |

**Fast mode.** The Claude API runs Claude Opus 5.5 faster in fast mode, at twice the price ($8 and $40 per
million input and output tokens). The question is what it buys in time per task, and whether it changes
how many tasks are solved. The report gives the cost ratio and the time ratio to the Opus baseline, from
the trials' own reported cost and time. A session's budget is doubled to $16, so that the budget stops no
more sessions than in the baseline. A test request on 22 Nov 2026 with the benchmark's API key came back
with `"speed": "fast"`.

**Codex under the same rules.** `bench/harbor/codex_setup_agent.py` runs a setup of the file of setups in
Codex. It runs the setup's commands, so GitHub is blocked in the container and the block is checked into
`network-check.txt`, as for Claude Code. It turns web search off, as Claude Code's setups have no web tool,
and it refuses a field that only Claude Code reads. Codex has no limit on the spend of one session, so only
the stage's cap limits it. The OpenAI setups are copies of the baseline with only what Codex reads. Neither
model has a Widal.Code setup, because Widal.Code reads only Claude Code's sessions, so they are reported
next to the Claude baselines and not ranked. They run only when an OpenAI API key is stored for the runner. Widal applied for $1,000 of OpenAI credits on 23 Nov 2026, which sets the OpenAI cap at $900 (the runner stops at 90% of it). If the key is not there when the Claude stages end, the runner stops, and the OpenAI stages run when it is started again with the key stored.

**Two fixes for trials that report no cost**, which are Codex's trials:
- A trial that ended on an error is an error of the harness only when it spent nothing. This used the
  cost the agent reported, so every Codex trial that ended on an error (a time limit, for example) would
  have been counted as an error of the harness and run again. It now uses the cost priced from tokens.
- A trial's tokens are the sum of many calls. Priced as one call, the sum crossed OpenAI's long-prompt
  limit (272,000 tokens), and the trial was priced at twice the input price. Sums are now priced at the
  standard price.
