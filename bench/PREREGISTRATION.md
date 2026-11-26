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

## Correction, 23 Nov 2026: a larger runner, and a longer limit for the agent's setup

Neither change below alters a setup, a task, a measure or a stop rule. The code that the stages run stays
pinned to commit 9f58453, the commit the main stage started on, because the setup "widal-on" uploads that
checkout into every container.

**A larger runner.** The main stage ran slowly on a machine with 16 processors. When a test process
crashed in a container, the host wrote and compressed a core dump, and these used about 7 of the 16
processors. Core dumps were turned off on the host (`kernel.core_pattern` set to `|/bin/false`). A
crashing process ends the same way with or without a core dump, in every setup. The chain was stopped at
01:06 UTC and the runner was moved to an m7i.8xlarge (32 processors, 123 GB of memory), the largest the
account's limit allows. The 16 trials that the stop cut off ($1.64) are set aside and count in no result.
The 55 that had finished are kept. On the larger machine the main stage runs three trials at a time per
setup again. It started again at 01:08 UTC.

**A longer limit for the agent's setup.** The main stage stopped itself after 8 of its 10 blocks at
12:11 UTC, because 54 of the last block's 250 trials ended on an error of the harness. Five tasks
(fix-ocaml-gc, path-tracing, regex-log, langchain4j-5328 and langchain4j-5367) failed in all ten setups
at the agent's setup, which had a limit of 12 minutes. Harbor installs Node.js and npm before it installs
Claude Code, which is 667 packages on these tasks' plain Ubuntu 24.04 images, and all ten setups did that
at the same moment. Alone, the same install takes under 2 minutes on the runner, and 15 downloads of the
packages at once took 10 seconds, so the unpacking of the packages in ten containers at once is the slow
part. The setup runs before the agent and spends nothing, so its limit was raised to 30 minutes (Harbor's
`--agent-setup-timeout-multiplier` 5) for this and every later stage. The quality stage had started at
12:11 UTC. It was stopped at 12:19 UTC: its 47 finished trials are kept, and the 12 it cut off ($0) are
set aside. The main stage started again at 12:20 UTC. It runs again only the trials that ended on an
error of the harness, then its last two blocks, and the quality stage follows it.

## Change 3, 23 Nov 2026, before any result of a finished stage was seen

None of the changes below alters a setup, a task, a measure or a stop rule of a stage.

**The OpenAI stages run beside the chain, paid from another balance.** The stages "openai-sol" and
"openai-astra" (change 2) were to run after every other stage, on OpenAI credits that were applied for.
Nils gave an API key of the Vane organization on 23 Nov 2026, which has a balance of about $2,500, so
the two stages started at 17:01 UTC beside the main stage instead. Their caps stay as in change 2: $400
per model and $900 for OpenAI in all. To leave the chain untouched, they use their own checkout of the code
(at origin/main), their own file of setups and their own folder of records, and run two trials at a time
per setup. Their tasks are the 100 tasks of the Opus stage, picked with the same seed. The report sets
them next to the Opus stage when both are done.

**Two failed starts, at no cost.** The first start failed at once, because both stages wrote the file of
setups at the same moment and left it unreadable. The stage files are now made one after the other. The
second start failed before Codex ran: Harbor's Codex install loads nvm from `$HOME/.nvm`, but nvm's
installer puts it in `$XDG_CONFIG_HOME/nvm` when that is set, as in some task images (widal-code PR 21
links the two). Neither start spent anything. Their jobs and records are set aside and count in no result,
and the stages started again at 17:11 UTC.

**A higher cap for the Anthropic API key.** The caps of the Anthropic stages add up to $1,960, more than
the key's cap of $1,500 over all stages (with a stop at 90%, $1,350), so the last stages would have been
cut off. With Nils's approval the cap of the API key is raised to $2,100 (a stop at $1,890) for every stage
that starts from now on. The cap of each stage stays as it was. The chain's later stages get the new cap from a local
edit of `bench/harbor-make-stage.mjs` in the runner's checkout at 9f58453, because the chain's script
cannot be edited while it runs. The main stage's file was made earlier and keeps $1,500, which it does not
come near (it ends near $430).

## Correction, 23 Nov 2026: a faster disk, and more trials at a time in the quality stage

Neither change below alters a setup, a task, a measure, a cap or a stop rule.

**A faster disk.** When the quality stage started at 17:54 UTC, the runner spent most of its time waiting
for its disk (a load of 116, with 69% of the processors' time waiting on input and output). The runner's
disk was raised to 16,000 operations per second and 1,000 MB/s at 18:01 UTC, while the stage ran.

**Eight trials at a time per setup in the quality stage.** Nils asked for the quality stage to end sooner.
At 22:00 UTC it had finished 6 of its 26 blocks in about 4 hours and spent $69.32 of its $400 cap, and the
runner's processors were 80% idle. The chain was stopped at 22:01 UTC, two minutes after block 7 started.
The 653 trials that had finished are kept, and the 19 that the stop cut off ($0.86) are set aside and count
in no result. The stage file was left as it was except for the number of trials at a time, which went from 5
to 8 per setup, so the stage runs 32 trials at a time and the OpenAI stages beside it run 8. The main stage
ran 30 at a time beside the same 8. The chain started again at 22:02 UTC with a script that begins at the
quality stage, so the main stage does not run again. As after the main stage's restart, the quality stage
first runs again the trials of blocks 1 to 6 that ended on an error of the harness (none of them spent
anything), then goes on from block 7.

The four setups of a block run at the same time with the same number of trials at a time, so the trials
that are compared ran under the same load. Cost and tasks solved are measured per trial. Time is the one
measure that the load changes, which is one more reason why the time comparisons count for less than cost
and tasks solved.

## Correction, 23 Nov 2026: the task sets of a block run at the same time

This change alters no setup, task, measure, cap or stop rule either.

Eight trials at a time did not make the quality stage much faster, because the runner ran a setup's task
sets one after the other. A block of 25 tasks holds two or three task sets (swe-rebench, SWE-bench Pro and
Terminal-Bench), and each task set waited for its slowest task before the next one started, so at 22:46 UTC
only 9 trial containers ran on the 32 processors. With the option `taskSetsTogether` of
`bench/harbor-stage.mjs`, the task sets of a setup run at the same time, each with at most the stage's trials
at a time and at most half its tasks at once, so that a block waits for its slowest task once. In the quality
stage that is at most 52 trials at once at the start of a block. The chain was stopped at 22:53 UTC, when
block 8 started and before any of its trials had run, so no trial was cut off, and it started again at once.
The runner's checkout stays at 9f58453, so the runner uses a copy of the new block loop outside the checkout
that imports everything else from `bench/harbor-stage.mjs` at 9f58453.

The quality stage from block 8 and the Haiku, Opus and Fable stages run their task sets at the same time. The
attribution stage has about ten setups, so it keeps running its task sets one after the other, which keeps
the number of trials at once near what the main stage ran. As before, all setups of a block run at the same
time under the same load.

## Correction, 23 Nov 2026: the verifier ran with GitHub blocked

The setups block GitHub in the container's `/etc/hosts` for the whole session, so that the agent cannot fetch
the upstream fix. The block was still in place when Harbor's verifier ran next in the same container. The
verifier of Terminal-Bench downloads uv from GitHub, so it failed, and the trial counted as not solved whatever
the agent did. The oracle check ran without the block, so it did not show this. It was found at about 23:45
UTC on 23 Nov 2026, by reading the verifiers' output.

- **Affected.** In the main stage, all 350 verifier runs of 35 Terminal-Bench tasks, in every setup. In the
  quality stage, the 40 verifier runs of 10 Terminal-Bench tasks in blocks 1 to 9. No verifier of swe-rebench
  or SWE-bench Pro was affected.
- **Fix.** The setup agent saves the task's `/etc/hosts` before the setup's own steps and puts it back when
  the session ends, also after an error or a timeout. The session runs with the block as before, and the
  verifier sees the container as the task set it up, as in the oracle check. The runner's checkout stays at
  9f58453 and got this one file at 23:52 UTC, before quality block 10 started. Every later block and stage
  uses it. The setup "widal-on" uploads the checkout into its containers, so they now also hold this file and
  the edit of change 3, which the agent does not use.
- **Analysis.** The verifier runs after the session, so the cost, the time and every other measure of the
  session stand for the affected trials. A task whose verifier could not reach GitHub is left out of every
  measure of tasks solved, in all setups, like a task that failed in the harness in all setups. In the main
  stage that leaves 212 of 247 tasks for tasks solved. In the quality stage it leaves out the 10 Terminal-Bench
  tasks of blocks 1 to 9. Running the 35 tasks of the main stage again in its ten setups would cost about $74
  (what they cost the first time). They are not run again unless Nils decides so.

## Correction, 24 Nov 2026: the 35 Terminal-Bench tasks of the main stage run again

- **What Nils decided.** On 24 Nov 2026, after the correction above, Nils decided to run the 35 Terminal-Bench
  tasks of the main stage again instead of leaving them out of tasks solved.
- **How.** A stage "main-tb" ran those 35 tasks in all 10 setups of the main stage (5 arms, 2 runs each), in one
  block, 2 trials at a time per setup, from 01:08 to 03:48 UTC, with a cap of $100. It used the same file of
  setups, the same Claude Code version and the same seed, with the verifier fix in place (`setup_agent.py` puts
  back `/etc/hosts` when the session ends). Its records were written apart, in `/opt/bench/v1-tb`, and cost
  $62.44.
- **Analysis.** For each of the 35 tasks, the record of each setup and run in the rerun replaces the main stage's
  record of that setup and run. The main stage's report is made from those records (`/opt/bench/v1-main-final`),
  and the earlier reports are kept as `report-main-original.md` and `report-main-excluded.md`. No trial of the
  rerun's tests failed to reach GitHub. One task, torch-pipeline-parallelism, failed in the harness in 9 of its
  10 runs, so with the two teleport tasks the main stage counts 246 tasks.
- **Quality.** The quality report pools these main records with the quality stage's, as the pre-registration says.
  In the quality stage, the 10 Terminal-Bench tasks of blocks 1 to 9 still count in no solved number.
- **Not changed.** The setups, the tasks, the measures and the stop rules. The rerun ran on a later day than the
  rest of the main stage, with all setups side by side as before.

## Change 4, 24 Nov 2026: a second runner, the current Widal.Code for Fable, and a stage "current"

Nils asked on 24 Nov 2026 to finish version 1 sooner and to make the remaining stages teach us something
about the Widal.Code we have now.

- **A second runner.** A copy of the first runner (made from an image of it at about 15:50 UTC, with no reboot)
  started at 16:23 UTC. It runs Fable (pilot and stage, with the same setups, tasks, budgets and caps as
  `model fable` in `v1-chain.sh`) and Claude Opus 5.5 in fast mode (as in `v1-after.sh`) beside the first
  runner, which goes on with Haiku and Opus and stops its chain after the Opus stage, so that no stage runs
  twice. The two runners do not see each other's spend, so the cap of the API key is checked by adding both.
- **The current Widal.Code for Fable.** The pinned Widal.Code (9f58453) proposed only the shell output cap for
  Sonnet and Haiku, which made no measurable difference to cost. Fable's Widal.Code setup is made by the
  current Widal.Code instead (`bench/harbor-widal.mjs` at main, b043880), from the Fable pilot's baseline
  sessions, as before. The stage runner, the tasks and the baseline are unchanged.
- **A stage "current".** The current Widal.Code against its own baseline in the same stage, on Claude Sonnet
  5.5, on 100 tasks held out from the pilot (the same seed as the Opus stage), two runs each, cap $100. Its
  Widal.Code setup was made from the 67 sessions of the Sonnet pilot's baseline: `tools-unused` (Task,
  Workflow, ScheduleWakeup, ReportFindings, ListAgents, SendMessage and WebSearch denied, an estimated 9.6% of
  cost) and the shell output cap. The primary measure is the cost ratio against `cur-baseline`, with the
  share solved as a check, as in the main stage.

## Change 5, 25 Nov 2026: a stage "confirm" for the unused tools

The stage "current" found the current Widal.Code 11% cheaper than its baseline (95% interval -22% to +2%),
cheaper on 75 of 99 tasks. Because the interval still reaches a small increase, Nils asked on 25 Nov 2026 for
one more stage of the same size before `tools-unused` counts as proven.

- **Tasks.** 100 tasks that passed the oracle, sampled with a new seed (20261125), with the tasks of the pilot
  and of the stage "current" excluded, so no task of "current" is run again.
- **Setups, fixed before the stage.** `conf-baseline` is the baseline. `conf-widal-on` is a copy of
  `cur-widal-on` with no new run of `widal advise`: the same seven tools denied, the same shell output cap,
  the same Widal.Code (b043880). Claude Sonnet 5.5, two runs each, budget $4 per session, cap $100 for the
  stage (Nils allowed a little more if needed).
- **Runner.** The second runner, with the baseline and Widal.Code setups of one run number at the same time,
  as in the rerun of "current" (two setups at once instead of four, which caused start timeouts).
- **Primary measure.** The cost ratio of `conf-widal-on` against `conf-baseline` in this stage alone. The
  saving counts as proven when the upper end of its 95% interval is below 1.
- **Check.** The share solved may fall by at most 3 points, as in question 2; if the interval is wider, the
  report states the margin the tasks reached.
- **Secondary.** The two stages together ("current" and "confirm", about 200 tasks), reported, not used for
  the decision.

## Correction, 25 Nov 2026: what the runs taught the harness

None of the changes below changes a measure of a finished stage. They alter no setup, task, measure or cap, and no
number of a stage that has ended. They put into the harness what the runs of 22 to 25 Nov 2026 did by hand, or with
a copy of the block loop outside the checkout. They are covered by tests with made-up trial folders and a made-up
Harbor. No stage has run with them yet.

- **The run numbers of a block run one after another.** The setups of one run number run a block at the same time,
  and then the setups of the next run number do. Four setups at once caused start timeouts in the stage "current",
  so its rerun and the stage "confirm" ran this way, with a copy of the block loop (change 5).
  `bench/harbor-stage.mjs` now does this itself. A setup and the reference setup of the same run number still run
  at the same time, under the same load. The stage option `runNumbersTogether` starts every setup of a block at
  once, as before.
- **The limit for the agent's setup is 30 minutes by default.** The correction of 23 Nov 2026 raised it for every
  later stage, and each stage file then had to set `setupTimeoutMultiplier` to 5. The default was 2 (12 minutes)
  and is now 5. The setup runs before the agent and spends nothing.
- **A trial that the usage limit ended is an error of the harness.** When the model account reaches its usage
  limit, the API refuses every session, whatever the setup. Such a trial says nothing about a setup. Its record now
  has the error "UsageLimitReached", counts in no number, and the trial runs again when the stage runs again, like
  every other error of the harness. This holds also when the session had spent something before it was refused. The
  error is read from the last lines of the agent's own output and from Harbor's error, not from what the model or a
  tool wrote. The stage finishes the block, stops, and gives the usage limit as the reason. In the runs of 24 Nov
  2026 the stages were stopped by hand at the usage limit, and such a trial was marked by hand. A record of a trial
  that finished is still never replaced by one that ended on an error of the harness, so reading the trials of a
  finished stage again changes no number of it.
- **The runner waits for Docker, and tries a failed download of the tasks again.** Before the first block the
  runner waits until Docker answers `docker info`, for at most 5 minutes, and ends with an error when it does not.
  The Fable pilot did not wait for Docker. A Harbor command that fails because the download of its tasks did not
  reach the server ("ApiConnectionError") starts again, at most twice, and only when it had made no trial, so that
  no session runs twice. Both happen before a trial starts.
- **An API key is no longer on a command line.** Harbor passes the variables of a command to `docker compose exec`
  on its command line, so the process list of the runner showed the API key while a session ran.
  `bench/harbor/setup_agent.py` now writes the variables that hold a key to a file in the container, which each
  command reads first, and removes the file when the session ends. The session gets the same variables as before.
  This covers the sessions of Claude Code. A key that a stage gives with Harbor's `--ae`, as the Codex stages do,
  is still on a command line.
- **A stage needs its own baseline.** `bench/harbor-make-stage.mjs` refuses to write a stage whose reference setup
  is not among its setups, or whose reference has fewer runs than another setup, and names the setup that is
  missing. It also refuses a setup that runs another model than the reference, unless the stage is made to compare
  models (`--compare-models`). The reference is the setup named with `--reference`, or else the first one called
  "baseline" or with an id that ends in "-baseline". The stage "opus-fast" had one setup and no baseline of its
  own. The stage files that exist are not changed.

## Change 6, 25 Nov 2026: a stage "lean" for the skill tool, on two models

The stage "confirm" found the setup with the seven unused tools left out 11% cheaper than its baseline on
Claude Sonnet 5.5 (95% interval -20% to -1%, cheaper on 78 of 100 tasks), with the same share solved (0.0
points, -7.0 to +7.0). By the rule of change 5 `tools-unused` counts as proven on Sonnet 5.5, and Widal.Code
0.3.2 applies it by default. Two questions are open, and Nils asked on 25 Nov 2026 for a cheap test of them
and for a report that holds up before anything is published:

1. Claude Code's skill tool is part of every request, and no session of this benchmark has called it. Does
   leaving it out as well keep the result, and does the whole setup cost less than Claude Code's default?
2. Does that hold on Claude Haiku 5.5, where no stage has run these setups?

**What was seen before this change was written.** A test on 20 tasks ("lean-pilot", about $11, not
registered) ran six setups once on Sonnet 5.5 and Haiku 5.5: the default, eight tools left out (the seven and
the skill tool), and eight tools left out with another effort level. It was run to see that the setups work.
When this change was written, at 16:25 UTC on 25 Nov 2026, the last 11 of its sessions were still running, and
116 sessions had been read. In those 116 the eight tools were gone from every session that left them out, and
no session of any setup called one of the eight tools. In the 59 sessions of the first 10 tasks, the first
request of a session was about 13,000 tokens smaller with the tools left out (median 33,314 against 20,529 on
Sonnet 5.5, 34,437 against 21,352 on Haiku 5.5). The cost sums per setup were seen as well, for the first 10
tasks in full and for the second 10 in part. With 20 tasks they decide nothing: the test counts in no result
of this stage, its numbers are reported as a test, and its 20 tasks are left out of this stage. The noise of
the stages "confirm" and "haiku" was also looked at, to size this stage.

- **Setups, fixed before the stage.** Settings only, with no plugin, no hook and no shell output cap, so the
  stage measures the tools alone. (The stage "confirm" ran the seven tools together with Widal.Code's plugin
  and its shell output cap.)
  - `base`: Claude Code's default settings, as the baseline of every stage.
  - `tools7`: Task, Workflow, ScheduleWakeup, ReportFindings, ListAgents, SendMessage and WebSearch denied
    in the settings (`permissions.deny`), which is what Widal.Code 0.3.2 applies by default.
  - `skill`: the same seven and Skill denied.

  Sonnet 5.5 runs `base` and `skill` (`lean-s-base`, `lean-s-skill`). Haiku 5.5 runs all three
  (`lean-h-base`, `lean-h-tools7`, `lean-h-skill`). Claude Code 2.1.330, one run per setup, and the session
  budgets of the earlier stages ($4 on Sonnet 5.5, $2 on Haiku 5.5).
- **Tasks.** Of the 269 tasks that passed the oracle and were not in the test, 150 are drawn with the seed
  20261127, each task set with its share (56, 41, 29 and 24). Haiku 5.5 runs the 150. Sonnet 5.5 runs 65 of
  those 150, drawn the same way (24, 18, 13 and 10). Most of these tasks ran in earlier stages. That gives no
  setup an advantage here, because no setup is made from sessions: the two lists of tools were fixed before
  the stage, and every setup of a model runs the same tasks. The setups and both lists of tasks, as written
  on the runner before the stage started, are in `bench/harbor/v1-lean/stage.json`.
- **Order and runner.** The second runner. The tasks are shuffled with the stage's seed and run in blocks of
  25. The setups of a model run each block side by side, as in "confirm", and the two models run at the same
  time (`lean-sonnet` and `lean-haiku`, each with its own records and its own cap). The last sessions of the
  test were still running on that runner when the stage started, which loads every setup alike. The stage
  runs with the code the stage "confirm" ran with (the runner's checkout at 9f58453 with its local changes, and
  the copy of the block loop), not with the harness changes of the correction of 25 Nov 2026, which have not
  run in a real container yet.
- **Size, and what it can show.** The API account has a monthly usage limit, and by our own records about $65
  to $75 of it is left, so the stage is sized to about $36 (caps: $24 for Sonnet 5.5, $20 for Haiku 5.5).
  From the earlier stages (the standard deviation of a task's log cost ratio between two setups, each run
  once, was 0.33 on Sonnet 5.5 and 0.48 on Haiku 5.5), the 95% intervals are expected to be about 7 points
  wide to each side for the cost of a typical task and about 11 to 14 points for the ratio of the totals, on
  each model. The share solved will be known to about 10 points on Sonnet 5.5 and 8 points on Haiku 5.5.
- **Primary measure, per model.** The cost ratio of `skill` against `base`, as the ratio of the totals, like
  in every stage before. The saving counts as proven on a model when the upper end of its 95% interval is
  below 1. A statement about both models needs both intervals below 1, so two tests need no correction.
- **Named secondary measure.** The cost of a typical task: the geometric mean of the per-task cost ratios
  with its 95% interval (`typicalRatio` in `bench/stats.mjs`). The ratio of the totals moves with a few long
  sessions (in "confirm" 10 of 100 tasks held 29% of the baseline's cost, in "haiku" 10 tasks held 36%), and
  the typical task does not. The report gives both and says which is which. A saving that only the typical
  task shows is reported as "a typical task costs less", never as a lower bill.
- **Check.** The difference in the share solved, `skill` minus `base`, per model and for both models
  together. This stage is too small for the margin of 3 points, so the report states the margin the tasks
  reached, as change 1 says. The safety rule of 20 points stands.
- **Secondary, reported, not used for the decision.**
  - On Haiku 5.5: `tools7` against `base`, and `skill` against `tools7`. From the token counts the skill
    tool is about half the size of the seven tools together, so it is expected to be worth about 5% of cost,
    which is less than this stage can tell from chance. An interval that includes no change is reported as
    "not shown", not as "no saving".
  - What explains a saving: the prompt tokens of the first request of each session, the requests per session
    and the output tokens, per setup.
  - The calls of a tool that was left out, per setup, and how often `base` called one of the eight tools.
  - Haiku 5.5 against Sonnet 5.5 in the setup `base`, on the 65 tasks both ran.
  - The results per task set.
- **What the stage cannot show.** No task of this benchmark has a skill, so the stage cannot measure what a
  person loses when the model can no longer pick a skill by itself. A check on 25 Nov 2026 (Claude Code
  2.1.331, Haiku 5.5, one project skill) found that a skill the person types still runs with the skill tool
  denied, and that a skill the model would have to pick itself does not: the model no longer knows that it
  exists. The sessions are short (in "confirm" the median was 43 seconds), and the API organization of this
  benchmark needs Claude Code's experimental betas turned off, which makes the start of a session larger than
  on a person's own sign-in. Both change the saving in percent that a person would see.
- **Decision rule, set before the stage.** Widal.Code adds the skill tool to the tools it proposes to leave
  out only when all of these hold: the primary measure holds on both models; on neither model is the share
  solved by `skill` lower than by `base` with an interval that excludes no change; on Haiku 5.5 `skill` does
  not cost more than `tools7` in the ratio of the totals; and no session of `base` called the skill tool.
  Otherwise the default stays as it is in 0.3.2. Nothing is published and no default changes before Nils has
  read the report.
- **The usage limit.** A session that ends on the account's usage limit ("You have reached your specified API
  usage limits") is not a result. A guard on the runner stops both models at the first such session, and the
  tasks of the blocks that were running then are left out in every setup.

## Correction, 26 Nov 2026: the disk cleanup is part of the stage runner, and removes images only

This changes no measure, setup, task or cap, and no number of a stage that has ended.

A few hundred task images fill the runner's disk, so since 23 Nov 2026 a script on the runner removed what
Docker did not use whenever the disk was more than 70% full. The script was not in this repository, and it
removed everything unused: images, the build cache, and also networks. Harbor makes the network of a task a
moment before its container, so a cleanup could remove the network of a trial that was starting.

In the stage "lean" this ended four trials, all on Haiku 5.5: apache pulsar 25793 in all three setups and
matrixone 24632 in `skill`. They started between 20:47:04 and 20:49:39 UTC on 25 Nov 2026, inside the cleanup
that ran from 20:46:37 to 20:51:57 UTC, and ended with "network not found". One more trial, on Sonnet 5.5 in
`skill`, failed in `docker compose` at 17:11:40 UTC, a minute before the cleanup of 17:12:43 UTC was written
to the log. That one is likely the same cause and is not proven. All five are errors of the harness: they
spent nothing, count in no number of the stage, and are listed in its report. After the stage ended, the script
on the runner was changed by hand to remove images and the build cache only (21:32 UTC on 25 Nov 2026).

From now on the cleanup is code of this repository. A stage file turns it on with `diskCleanup`
(`--disk-cleanup` in `bench/harbor-make-stage.mjs`), and `bench/harbor-stage.mjs` then looks at the disk
every two minutes while the stage runs. Above the limit it removes Docker's build cache and the images that
no container uses, and nothing else: no network, no container and no volume. It writes the start and the end
of each cleanup to `disk-cleanup-<stage>.log` beside the records, so that the report of a stage can set every
error of the harness against the cleanups. The script on the runner is turned off before the next stage
starts, and every later stage file sets `diskCleanup`. The cleanup is covered by tests with a made-up Docker
and a made-up disk. No stage has run with it yet.

What stays possible: Docker does not remove an image that a container uses, but a trial that starts in the
same seconds as a cleanup may have to build or pull its image again, which costs time and no money.

## Change 7, 26 Nov 2026: a stage "effort" for the effort level low, on Claude Sonnet 5.5

Widal.Code's advice proposes to start sessions at a lower effort level (`widal advise`, the proposal
"Start sessions at a lower effort"), and no number of this benchmark stands behind that proposal for Claude
Sonnet 5.5. No registered stage has compared two effort levels on Sonnet 5.5: the stages on Sonnet 5.5 set no
level, and the stage on Claude Fable 5.2 compared xhigh with high. Nils asked on 25 Nov 2026 for this stage
to be prepared, and it does not start before he says so. The question:

On Claude Sonnet 5.5, does a session at the effort level low cost less than a session at the level that
Claude Code starts with, and does it solve as many tasks?

**What was seen before this change was written.**

- The test of 25 Nov 2026 ("lean-pilot", 20 tasks, not registered) ran Sonnet 5.5 with eight tools left out
  at Claude Code's own effort level and at the level low. Low cost 27.9% less in the ratio of the totals (95%
  interval -47.4% to -7.5%), cost less on 16 of the 20 tasks, and both solved 13 of 20, with one task solved
  by each side only. With 20 tasks that decides nothing. The test counts in no result of this stage, and its
  20 tasks are left out. The standard deviation of a task's log cost ratio between the two setups was 0.47,
  which is used below to size the stage.
- The stage "lean" had ended and its report was read: the setup `lean-s-base` (Claude Code's default
  settings on Sonnet 5.5) cost $0.156 per task on 65 tasks.
- Which level Claude Code starts with was read from the session files that the stage "lean" kept. Every
  request of a session records its effort level there, and all 641 requests of the 65 sessions of
  `lean-s-base` ran at medium. So in this stage "Claude Code's default" means medium, on Claude Code 2.1.330.

The plan:

- **Setups, fixed before the stage.** Settings only, with no plugin, no hook and no tool left out, so the
  stage measures the effort level alone. Both are in `bench/harbor/v1-effort/setups.json`.
  - `effort-base`: Claude Code's default settings and no effort level set. It is the setup `lean-s-base` of
    the stage "lean" under another name.
  - `effort-low`: the same, started with the effort level low. Nothing else differs.

  Sonnet 5.5, Claude Code 2.1.330, one run per setup, and the session budget of the earlier stages ($4).
- **Tasks.** 125 tasks, drawn with the seed 20261201 from the 269 tasks of `bench/harbor/v1-tasks.json` that
  passed the oracle and were not in the test: 45 of swe-rebench 07-2026, 35 of the swe-rebench leaderboard,
  24 of SWE-bench Pro and 21 of Terminal-Bench 2.1. Most of them ran in earlier stages, which gives neither
  setup an advantage, because no setup is made from sessions and both run the same tasks. The stage file is
  `bench/harbor/v1-effort/stage.json`, written by `bench/harbor-make-stage.mjs` on the runner on 26 Nov 2026.
- **Order and runner.** The second runner. The tasks are shuffled with the stage's seed and run in blocks of
  25. Both setups run each block side by side, so that they share the load of the machine, with the task
  sets of a block at the same time and at most 3 trials at a time per task set. The stage is started by
  `bench/harbor/v1-effort/run.sh` from a checkout of this repository at the commit of this change, and the
  script starts nothing when a file of the checkout differs from that commit. It is the first stage that
  runs with the stage runner of this repository as it is, and no longer with a copy of the block loop on
  the runner. The disk cleanup of the correction of 26 Nov 2026 is on, above 70%.
- **Size, and what it can show.** From the costs of the stage "lean" per task set, `effort-base` is expected
  to cost about $19 and `effort-low` about $14, so about $33 in all. The cap is $40, and the stage runner
  starts no new block once $36 are spent. With 125 tasks the 95% intervals are expected to be about 8 points
  wide to each side for the cost of a typical task, and about 8 to 12 points for the ratio of the totals. In
  the test and in the stage "lean", two setups on Sonnet 5.5 differed in whether a task was solved on 8% to
  10% of the tasks, so the share solved is expected to be known to about 5 to 7 points to each side. The
  stage can show a saving of the size the test saw. It can show a loss of solved tasks of about 8 to 10
  points or more, and it cannot show that less than 3 points are lost.
- **Primary measure.** The cost ratio of `effort-low` against `effort-base`, as the ratio of the totals, like
  in every stage before. The saving counts as proven when the upper end of its 95% interval is below 1.
- **Named secondary measure.** The cost of a typical task: the geometric mean of the per-task cost ratios
  with its 95% interval. A saving that only the typical task shows is reported as "a typical task costs
  less", never as a lower bill.
- **Check.** The difference in the share solved, `effort-low` minus `effort-base`, with its 95% interval.
  The report states the margin the tasks reached, as change 1 says, and names the tasks that only one side
  solved. The safety rule of 20 points stands.
- **Control.** The effort level of every request, read from the session files of every trial. Every session
  of `effort-base` must have run at medium and every session of `effort-low` at low. A session with a
  request at another level is named in the report.
- **Secondary, reported, not used for the decision.** The output tokens, the input tokens, the requests per
  session, the session time and the cost per solved task, per setup. The sessions that ended on a limit (the
  time limit of a task or the session budget), per setup. The results per task set.
- **Analysis.** `bench/harbor/v1-effort/analyze.mjs`, committed with this change, prints every number named
  here. It was run on the records of the test, whose numbers were known, to see that it reads real records
  and session files, and it gave the test's numbers. `run.sh` runs it when the stage has ended. While the
  stage runs, only the status file is looked at, which holds spend and health and no comparison.
- **What the stage cannot show.** It runs one model and one version of Claude Code, and it compares low
  with medium only. The tasks are short and have hidden tests (in `lean-s-base` the median session took 54
  seconds), and long or hard work may lose more at a lower effort than these tasks do. No person takes part
  in a session, so the stage does not measure whether a person has to ask again more often at a lower
  effort. A person who has set another level than medium sees another saving. The API organization of this
  benchmark needs Claude Code's experimental betas turned off, which changes the saving in percent that a
  person would see.
- **Decision rule, set before the stage.** Widal.Code changes no default from this stage, whatever it
  shows. When the saving is proven, the share solved is not lower with an interval that excludes no change,
  and the control holds, the advice may state the measured saving and the measured interval of the share
  solved, for Sonnet 5.5 and with what the stage cannot show. Otherwise the advice stays as it is. A default
  of low would need a stage that knows the share solved to 3 points, which is about 350 to 450 pairs of
  sessions and more than this benchmark's 269 tasks give in one run. Nothing is published and no default
  changes before Nils has read the report.
- **The usage limit.** The API account reaches its monthly usage limit after about $20 to $40 more, by our
  own records, and a key at its limit stays blocked until 00:00 UTC on 1 Dec 2026. So the stage starts after
  that time. A session that ends on the usage limit is not a result: the stage runner stops after the first
  block with such a session, and those sessions count in no number.
