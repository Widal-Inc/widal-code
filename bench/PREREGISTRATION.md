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
