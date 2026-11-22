# The outcome benchmark

This benchmark answers one question: does Widal.Code lead to better outcomes, or only to lower
numbers? It runs real Claude Code sessions on a set of tasks, checks each result with tests that
the agent never sees, and compares the same tasks with different models, efforts, and with
Widal.Code on.

It starts real sessions with your own sign-in. A full run with the commands below is 78 sessions.
The first full run, with Sonnet and Haiku three times each (`--reps 3`), was 130 sessions and $64
at list prices (on a subscription that is API value: it counts against the plan's limits). With
the arms side by side it took about 1 hour. The sessions together ran for 3.9 hours.

## What it measures

**The outcome of a task**

| number | what it is |
|---|---|
| Closed | Every hidden check of the task passes, and the tests that the project had at the start still pass. |
| Quality score | The share of the task's hidden checks that pass. |
| Agent cost | What Claude Code reports for the session, at list prices. |
| Cost per closed task | The agent cost of all runs of an arm, divided by the tasks it closed. The runs that failed are paid too. |
| Time | The seconds from the start of the session to its end. |
| Value of a closed task | The minutes an engineer needs for the task by hand, times the hourly rate. An estimate. |
| Net value | The value of the closed tasks, minus the agent cost, minus the time a person needs to look at every result. |
| Work left for a person | The minutes of the tasks that stayed open. |

The hourly rate (`--rate`, $100) and the minutes to look at a result (`--review`, 5) are
assumptions. The minutes per task are estimates in `tasks.mjs`. The counts, costs and times are
measured.

**Whether Widal.Code's numbers are right**

| number | what it is |
|---|---|
| Cost match | Widal.Code's cost of each session against the cost that Claude Code reports itself. |
| Ticket match | Each run works on a branch that names a ticket. The session must count to that ticket. |

**Whether Widal.Code's directions are right**

| number | what it is |
|---|---|
| Proposals | What `widal advise` proposes from the baseline's sessions, and how many of them the tool can apply itself. |
| Expected against measured saving | The saving a proposal names, against the cost of the same tasks after `widal apply`. |
| Outcome after the change | Tasks closed before and after. A saving that closes fewer tasks is not a saving. |
| Signs against quality | Widal.Code's own signs (tool errors, rounds of fixing, repeated calls) next to the measured quality of each arm. |
| Best case per task | The cheapest arm that closes each task. It shows what a model choice per task could reach. |

**What the automation costs and whether it can be taken back**

| number | what it is |
|---|---|
| Hook time | How long each of Widal.Code's hooks ran in the sessions. |
| Undo | Whether `widal undo` puts the settings back exactly. |
| Measure | What `widal measure` says about each change after the runs. |

## The tasks

Thirteen issues for a small sample project (`project/`, a command line tool with no packages). Each
has hidden checks in `checks/` and a reference solution in `solutions/`. The test
`test/bench.test.mjs` proves for every task that it is open at the start, that the project's own
tests pass at the start, and that its reference solution closes it.

| task | kind | by hand |
|---|---|---|
| t1 | bug fix, easy | 15 min |
| t2 | bug fix, medium | 45 min |
| t3 | bug fix with many rules | 45 min |
| t4 | feature, medium | 40 min |
| t5 | feature, harder | 60 min |
| t6 | investigation: two wrong reports, cause not named | 45 min |
| t7 | refactoring | 30 min |
| t8 | documentation | 15 min |
| h1 | hard: a small query language with a long specification (29 checks) | 180 min |
| h2 | hard: ISO 8601 week numbers, a rule that the issue only names | 60 min |
| h3 | hard: a speed problem with two causes, on a file of 200,000 rows | 45 min |
| s1 | questions about the code, with three subagents that only read | 45 min |
| s2 | the same as t2, in a project whose test command prints 75,000 characters first | 45 min |

The last two have a kind of waste built in, so that `widal advise` has something to find.

A task can start from a changed project. The files in `variants/<name>/` are put over the sample
project (`variant` in `tasks.mjs`): s2 gets its long test output that way, and h3 its slow code. A
task can also replace a text in a file (`edits`): h2 does that, so that the project's test does not
forbid the feature the task adds.

## The arms

An arm is one way to run the tasks (`arms.mjs`): Fable 5.2 at effort xhigh (the baseline), Fable
5.2 at effort low, Opus 5.5, Sonnet 5.5, Haiku 5.5, and the baseline with Widal.Code on.

"Widal.Code on" means: `widal advise` reads the baseline's sessions, `widal apply` runs for every
proposal that the tool can apply itself, and Widal.Code's hooks run in the sessions.

More arms run only when `--arms` names them:

| arm | what it is | tasks |
|---|---|---|
| `fable-high`, `fable-medium`, `fable-max` | The baseline at the other effort levels, so that the cost of each effort level can be read. | all |
| `opus-low`, `opus-medium`, `opus-high`, `opus-max` | Opus 5.5 at the other effort levels. | all |
| `sonnet-low`, `sonnet-medium`, `sonnet-high`, `sonnet-max` | Sonnet 5.5 at the other effort levels. | all |
| `haiku-low`, `haiku-medium`, `haiku-high`, `haiku-xhigh`, `haiku-max` | Haiku 5.5 at each effort level. The arm `haiku` sets no level. | all |
| `opus-widal-on`, `sonnet-widal-on` | Opus 5.5 and Sonnet 5.5 at effort xhigh with Widal.Code on. The tool advises from the runs of `opus-xhigh` or `sonnet-xhigh`. | all |
| `fable-sub-sonnet` | The baseline with one change alone: subagents run on Sonnet 5.5. | s1 |
| `fable-cap` | The baseline with one change alone: command output is cut at 10,000 characters. | t2, s2 |

The last two run only the tasks that their change acts on (`only` in `arms.mjs`). They show what
one of Widal.Code's changes does without the others.

Each of the four models has an arm at every effort level: low, medium, high, xhigh and max. Claude
Code's `effortLevel` setting does not take `max`, so an arm at max starts its sessions with
`--effort max` (`effort` in `arms.mjs`).

## Run it

Give a folder outside any git repository. The steps can be stopped and started again: a run that
has a record is skipped.

```
node bench/run.mjs --out <folder>                      # the five plain arms
node bench/widal-on.mjs --out <folder>                 # advise from the baseline, apply, set up the hooks
node bench/run.mjs --out <folder> --arms widal-on      # the same tasks with Widal.Code on
node bench/widal-on.mjs --out <folder> --undo          # measure, take the changes back, check the settings
node bench/report.mjs --out <folder>                   # the results
```

For Widal.Code on another model, name the arm: `node bench/widal-on.mjs --out <folder> --arm
opus-widal-on`, after `opus-xhigh` has run, and then `node bench/run.mjs --out <folder> --arms
opus-xhigh,opus-widal-on --round 2 --paired`.

Useful flags of `run.mjs`: `--arms a,b`, `--tasks t1,t2`, `--reps 3` (each task several times),
`--budget 6` (dollars per session), `--minutes 30` (time limit per session), and `--lane b` (a
second work folder, so that a second command can run other tasks of the same arm at the same
time).

**Compare the time of two arms only in a paired round.** Without `--paired`, an arm that ends
early leaves the others alone, so the arms do not run under the same load, and a session takes
longer when more sessions run next to it. With `--paired`, a task starts in all arms at the same
moment, and the next task starts when all of them have ended. `--round 2` runs one more round of
the tasks, with records of their own, in place of `--reps`:

```
node bench/run.mjs --out <folder> --arms fable-xhigh,widal-on,fable-high,fable-medium --round 2 --paired
```

The report sets each arm of a paired round against the baseline of the same round, for cost and
for time, and adds a sign test: how likely such a split of the tasks is when the arm makes no
difference. Cost can be compared in any round, because it comes from the token counts.

A paired round does not need the baseline. In a round without it, the report sets each arm against
the arm at effort xhigh with no other change, so a round of one model's arms is read against that
model at effort xhigh. Give each group of arms that runs side by side a round number of its own:
the report takes all arms with paired runs in round 4 as one group.

```
node bench/run.mjs --out <folder> --arms sonnet-xhigh,sonnet-low,sonnet-medium,sonnet-high,sonnet-max,sonnet-widal-on --round 4 --paired
```

For each model with arms at more than one effort level, the report has a table of the levels: the
tasks closed, the cost, the cost as a share of effort xhigh on the same tasks, the time, the turns
and the output tokens. For each arm with Widal.Code on, it shows what the tool proposed from the
runs of the arm it starts from, what it applied, and the same tasks before and after.

## Run another tool on the same tasks

`--arms-file <file>` adds arms from a JSON file. An arm there is the way to run another tool on the
same tasks, next to the baseline and in the same paired round:

```
node bench/run.mjs --out <folder> --arms-file <file> --arms fable-xhigh,widal-on,<id> --round 3 --paired
node bench/report.mjs --out <folder> --arms-file <file>
```

```json
[{ "id": "other-tool", "number": 21, "name": "Fable 5.2 xhigh, with the other tool",
   "settings": { "model": "claude-fable-5-2", "effortLevel": "xhigh", "env": { "TOOL_DATA": "${out}/tool-data" } },
   "pluginDir": "${dir}/plugin", "tools": ["Bash(tool:*)"], "path": ["${dir}/bin"],
   "systemPrompt": "What the tool's install would add to a person's own instructions." }]
```

`${out}` is the folder of the benchmark run and `${dir}` the folder of the file. Set the tool up
as its own install would, and give it a data folder inside `${out}`, so that it writes nothing
into your own home. Run one task first and check that the tool acted (its own counters, or the
session's record), because an arm in which the tool did nothing reads like "no effect". The runs
of such an arm are in the report, and never in the records that may be shared.

## Run issues of another project

`--tasks-file <file>` runs the tasks of a JSON file in place of the benchmark's own. Such a task is
an issue of another project, for example a finished ticket of your own codebase:

- the session starts in a copy of a folder that holds the project as it was before the fix;
- the task text is the ticket;
- the hidden checks are test files of the project, for example the tests of the real fix. They
  come into the work folder only when the session has ended.

A task is closed when every test in its `expect` list passes and no test that passed at the start
fails now. Test files of the start that the session changed are put back before the tests run, so
a session cannot pass by changing a test. The checks of a task, and so its quality, are the
expected tests that fail at the start (the `failing` list). Many tests of a real fix pass before
the fix already, and they earn nothing: they count as tests that must still pass.

```
node bench/run.mjs --out <new folder> --tasks-file <file> --arms fable-xhigh --round 1 --paired
node bench/report.mjs --out <new folder> --tasks-file <file>
```

```json
{ "set": "shop-issues",
  "tasks": [{
    "id": "p1", "number": 1, "slug": "count", "kind": "bug fix", "minutes": 20,
    "promptFile": "${dir}/texts/p1.md", "version": "the commit before the fix",
    "start": "${dir}/start/p1", "folder": "shop",
    "tools": ["Bash(npm test:*)", "Bash(git diff:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(grep:*)"],
    "hidden": { "files": "${dir}/hidden/p1", "expect": "${dir}/hidden/p1.expect.json",
                "failing": "${dir}/hidden/p1.failing.json",
                "command": ["npx", "vitest", "run", "test/count.test.ts", "--reporter=json", "--outputFile=${report}"] },
    "still": { "passing": "${dir}/start/p1.passing.json", "tests": "\\.test\\.ts$",
               "command": ["npx", "vitest", "related", "${changed}", "--run", "--reporter=json", "--outputFile=${report}"] }
  }] }
```

`${dir}` is the folder of the file. The two commands write their report in the JSON form of Jest
and Vitest to `${report}`. `${changed}` stands for the files the session changed, so the second
command runs only the tests that those files reach. `expect`, `failing` and `passing` are lists
of tests as "file > name": the hidden tests that pass on the real fix, the ones of them that fail
at the start, and the tests of the project that pass at the start.
`useTasks` in `tasks.mjs` describes every field, and `passingNow` in `other.mjs` makes such a list.

Before you use a finished ticket as a task, check three things:

- **The hidden tests are fair.** They must use only files and names that the code had before the
  fix, and they must not check the wording of the code. Otherwise a correct fix that picked
  another name fails.
- **The task proves itself.** Score a copy of the start: it must be open. Score a copy with the
  real fix: it must be closed (`node bench/other.mjs --tasks-file <file> <task id> <work folder>`).
- **The start folder holds nothing a session must not see.** Make it from the commit before the
  fix without the git history, with the packages installed, without a `.env` file, and without
  the project's own Claude Code settings, hooks and MCP file.

A session in another project gets the shell commands that the task names in `tools`, and no other
shell command. It gets no variable of your environment whose name says key, token, secret,
password or credential, and none that starts with `AWS_`. Use a new folder for `--out`: one
folder holds the runs of one set of tasks. The runs of a tasks file are in the report, and never
in the records that may be shared.

## Keep and share the records

```
node bench/export.mjs --out <folder>                   # writes <folder>/records.jsonl
```

This writes one line per run, in a form that may leave the computer (`record.mjs`): the task, the
arm and its settings, the versions of Claude Code, Widal.Code and Node, the outcome, the cost, the
time and the token counts per model. It holds no folder, no branch, no session id and no text of a
session, of a check or of an error. Every text in a record must have a strict form (an id, a model
name, a version, a day), and a run with any other text gives an error and no record.

Each record has a `taskHash`: 16 characters of a hash of the issue text, the project as the task
starts with it, and the hidden checks. Two records with the same hash are the same test, also when
they come from different computers. A record holds only for the versions it names.

Without `--send` the command sends nothing.

```
node bench/export.mjs --out <folder> --send            # also sends the records to your board
```

With `--send`, the same records go to the Widal.Code board that this computer is linked to
(`widal board login`), with that link's token and to no other address. The board keeps them, and
Widal reads the records of all teams together, per task and setting, without the name of a team or
a computer: the same test on many computers shows whether a result holds outside one setup. The
board refuses a record that holds anything but the fields above, and a record it has already is not
stored again. No page of the board shows the records. An admin who deletes the team's data on the
board deletes the team's records too. Nothing in this benchmark sends a record on its own.

A run that must not count (for example because the task was wrong when it ran) stays in the
folder with a `"void"` reason in its record. The report leaves it out of the outcomes, and still
checks its cost and ticket.

## What it does on your computer

- Each session runs in a new git repository inside the folder you give, with the sample project.
- A session gets a short list of allowed tools (`TOOLS` in `arms.mjs`): reading and editing files,
  the test command, node, and a few reading commands. There is no person to ask, so Claude Code
  refuses every other tool call. No permission is bypassed.
- A session reads none of your own Claude Code settings, plugins, MCP servers or memory. It uses
  your sign-in only.
- Widal.Code runs with a home, a tool folder and a Claude Code folder of its own inside the folder
  you give. It sees only the benchmark's sessions. Your own Widal.Code setup, your settings and
  your board are neither read nor changed.
- Claude Code writes the logs of the sessions to its own folder, as for any session.
- With a tasks file, each session runs in a copy of the other project's folder, and the project's
  test commands run there. The project's own instructions for agents (`CLAUDE.md`, `AGENTS.md`)
  are read, because they are part of the work. Its tests run with the network that your computer
  has, so use a project whose unit tests need no live system.
- A session may read files outside its own folder, and the folder of the benchmark holds what
  earlier runs left. The report therefore says how many of the lines that two runs of one task
  added are the same. A high share between different arms would be a sign of copying.

## Limits

- One small project in one language. The results say little about a large codebase. A tasks file
  with issues of your own codebase is the way to measure there.
- A finished ticket scores a session against the tests of one real fix. A good fix that made
  another choice than the real one can fail them, so read the open tasks before you count them.
- The tasks say exactly what is wanted. In the first full run every arm closed every task, also
  the three hard ones. So this set shows what a setup costs for the same outcome, and whether a
  change breaks something. It does not yet show where a cheaper model stops being good enough.
  That needs tasks from a larger codebase, with issues that leave things open.
- Most arms run each task once. The same arm can close a task in one run and miss it in the next,
  and the cost of one task differs from run to run (the report's section on run to run difference
  gives the spread). So a small difference between two arms on one task means nothing. Use `--reps`
  or `--round` to see the spread.
- The times of the first full run were not measured under the same load: the baseline ran next to
  four other arms, and the arm with Widal.Code on ran alone. Only a paired round compares time.
- The hidden checks test what the issue asks for. They do not judge style or design.
- The dollar value of a closed task rests on the estimates above.
