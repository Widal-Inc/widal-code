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

None yet.
