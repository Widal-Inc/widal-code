<img src="assets/widal-code.svg" alt="The Widal W mark" width="120">

# Widal.Code

Widal.Code shows what the AI coding agents on your machine spend, and what the spend pays for. It reads the session logs of Claude Code, Codex and Cowork. Nothing leaves the machine, unless you link it to your team's Widal.Code board (see "The Widal.Code board"). In Claude Code it also shows your plan's limits in the status line, warns you before a cache ends, says when to compact the context, proposes a cheaper model or effort level, and can hold a limit. It checks the agents' settings, what they did and the code they changed for security risks (see "Security and compliance").

The project is called Widal.Code. Its command is `widal`, and its folder on your machine is `~/.widal`. It was called Kestrel until 17 Nov 2026: see "Coming from Kestrel".

Status: version 0.3.1, started on 2026-11-12. So far it has run on macOS only. No dependencies, Node 22 or newer. Made by Widal, Inc. Free and open source under the MIT licence (see "Licence").

## What it looks like

The screenshots use made-up data: invented projects and two weeks of invented sessions. Nothing in them comes from a real computer.

**The status line in Claude Code.** The model and effort level, the context, how long the prompt cache stays warm, the plan's limits and how fast they fill, the task in progress and the other sessions.

![The status line that Widal.Code adds to Claude Code](docs/images/statusline.png)

**Every agent session on this computer, now** (`widal top`). Which session works, which waits for you, how warm each cache is, and what each one spent today.

![widal top: the open sessions of Claude Code and Codex](docs/images/top.png)

**What the dollars paid for** (`widal summary`). The dollars by account, day, project and model: spend for an account that pays by the token, API value for one on a subscription. The plans with their price, and the share that paid for carrying context and for lost caches. (The picture shows an earlier version of this report.)

![widal summary: the spend of the last 7 days](docs/images/summary.png)

**Changes that would have saved money** (`widal advise`). Each one comes from a replay of your own logs, with the reason, the setting, the risk and the command that applies it.

![widal advise: the first two proposals](docs/images/advise.png)

**Security risks of your agents** (`widal check`). Each finding names the controls it touches in the frameworks you turn on, and the command that fixes it where there is one.

![widal check: the open security findings](docs/images/check.png)

## Install as a plugin

Type these three commands in Claude Code:

```
/plugin marketplace add Widal-Inc/widal-code
/plugin install widal@widal
/widal:connect
```

The first two add the plugin from this repo. The third one sets the tool up. It does five things, and says each one:

- It copies the tool to `~/.widal/app/`. Claude Code keeps a plugin's files in a folder that changes with every update, so Claude Code's settings must not point there.
- It makes the link `~/.widal/bin/widal` to that copy. Claude Code's settings call the tool through this link.
- It links the command to `~/.local/bin/widal`, so that you can type `widal`. That folder has to be on your PATH. Another program at that path stays as it is (see "Another program named widal" below).
- It sets Claude Code's status line in `~/.claude/settings.json`, with a refresh every 30 seconds. A copy of the file is saved in `~/.widal/backup/` first. Another tool's status line is kept.
- It adds the three hooks of the security checks to the same file: at the start of a session, at the end of a turn, and before a shell command (see "Security and compliance").

Widal.Code needs Node 22 or newer. The setup says so when your Node is older.

**What the plugin brings.**

- **Ten commands.** `/widal:connect`, `/widal:report` (the last 7 days, as `widal summary` shows it), `/widal:findings` (as `widal findings` shows it), `/widal:session` (the latest session, as `widal session` shows it), `/widal:compactions`, `/widal:advise`, `/widal:doctor`, `/widal:hud` followed by what you want to change in the status line, and `/widal:open` and `/widal:settings`, which open the Widal.Code pane. The first seven show the tool's output as it is.
- **A command typed with `!`.** In Claude Code, `!widal findings` runs the command in the session's shell at once, and shows its output as it is. It needs the command on your PATH, which the setup puts there. Any report works this way, for example `!widal summary --days 30`.
- **A pane.** The Widal.Code pane beside the chat, with the sessions that run now, the spend, the settings as checkboxes and the open security findings. See "The Widal.Code pane".
- **A skill.** When you ask what your agents spend, where the tokens go or how to spend less, Claude runs the report that fits and passes on the numbers. A prompt that is only a command, such as `widal findings`, makes Claude run that command and show its output as it is. Claude never opens a session log itself: the tool reads the logs and prints only numbers.
- **Seven hooks.** Three are hooks that you can also add with `widal apply`: the text a summary has to keep at a compaction, the warning when a prompt goes to a session whose cache has ended, and the cost of a change of model. Three start the security checks and ask before a push while a high risk is open. The seventh keeps the copy in `~/.widal/app/` at the plugin's version. See "The plugin's hooks".

The commands, the skill, the hooks and the pane work before the setup too. Only the warning for a sent prompt needs the status line, which saves when each cache ends.

## Install in the Claude desktop app

The desktop extension answers questions about your agents' spend in a chat in the Claude desktop app. It needs no terminal and no Claude Code. Download [`widal-code.mcpb`](https://github.com/Widal-Inc/widal-code/releases/latest/download/widal-code.mcpb) from the newest release, and drag it onto **Settings**, **Extensions** in the app. See [docs/desktop.md](docs/desktop.md).

The extension is also listed in the official MCP Registry as `io.github.Widal-Inc/widal-code`.

## In the Claude desktop app

- **The Code tab** is Claude Code. It reads the same `~/.claude/settings.json` and runs the same hooks. So what `widal connect` and `widal apply` set works there too.
- **Cowork**, the agent mode of the app, can add the same plugin. It loads the plugin's commands, its skill and its hooks. That is why the plugin carries the hooks: Cowork does not read `~/.claude/settings.json`. Cowork does not install a plugin that has a top-level `bin/` folder, so the command's files are in `cli/`.
- **The status line:** whether it shows in the desktop app is not known yet.
- The reports read the logs of the Cowork sessions that ran on this computer, with or without the plugin.

## The plugin's hooks

The plugin carries seven of this tool's hooks, so that they also run where Claude Code's settings are not read:

| Hook | When it runs | What it does | The same hook in the settings |
|---|---|---|---|
| `compact-keep` | Before a compaction | Gives Claude Code the text that a summary has to keep (see "Compaction") | `widal apply compact-keep` |
| `cold-start` | When you send a prompt | Says what the prompt cost, when the session's cache had ended (see "Before a cache ends") | `widal apply cold-start-warn` |
| `model-switch` | Before a change of model | Shows what the switch costs, and asks first from $0.50 (see "Before a cache ends") | `widal apply model-switch-cost` |
| `check-settings` | When a session starts | Starts the check of the settings in the background (see "Security and compliance"). On a computer linked to a Widal.Code board, it also starts a sync with the board when the last one is 10 minutes old (see "The Widal.Code board"). | `widal connect` |
| `check-turn` | When an agent's turn ends | Starts the checks of what the agent did and of the code it changed in the background. On a computer linked to a Widal.Code board, it also starts a sync with the board, as above. | `widal connect` |
| `push-gate` | Before a shell command | Asks you first before a push while a high risk is open in the repository | `widal connect` |
| `load-gate` | Before a subagent or a workflow starts | Holds the subagent in a queue while the computer's CPU or memory is busy, and refuses it if the computer stays busy (see "Too many agents at once") | none: plugin only |

- **A hook never acts twice.** Claude Code runs a plugin's hook next to the same hook in the settings. So the plugin's hook first looks at `~/.claude/settings.json`. When the settings hold this tool's own hook for the same event, the plugin's hook does nothing: the one in the settings is in charge. A settings file that cannot be read counts as one without the hook.
- **You can turn each one off.** `widal hooks` shows, for each of the seven, whether it runs and from where: Claude Code's settings, the plugin, or off. `widal hooks off cold-start` turns the plugin's hook off, and `widal hooks on cold-start` turns it on again. The choice is kept in `~/.widal/config.json`. The hooks are on until you turn them off.
- **Where Node is missing, they print nothing.** Each hook's command looks for `node` first, and always ends without an error. On any error a hook prints nothing. The one exception is the hook before a compaction: it then gives the default text.
- **The keep-warm experiment is not in the plugin.** Add it with `widal apply keep-warm`.
- **The sync with the board is not a part of the security checks.** `check-settings` and `check-turn` start it also while you turned them off with `widal hooks off`. Only a linked computer syncs: stop it with `widal board logout`.
- **An eighth hook keeps the copy fresh.** At the start of each session it compares the version of the copy in `~/.widal/app/` with the plugin's version. When they differ, it copies the plugin's files over the copy. When they agree, it reads two small files and does nothing else. It also moves an install from before the change of name to the new name, once (see "Coming from Kestrel"). It prints nothing, because what a hook prints at the start of a session goes to Claude.

## The Widal.Code pane

Inside Claude Code, Widal.Code can show a pane beside the chat. In a narrow terminal it sits above the prompt. The pane comes with the plugin. It is a mod: a part of a plugin that Claude Code runs itself, with buttons and tabs (see Anthropic's documentation of mods at code.claude.com).

Two commands open it:

- `/widal:open` opens it on the tab Now.
- `/widal:settings` opens it on the tab Settings.

Where no pane can show, the same commands print text instead. `/widal:settings` prints the settings, with the `widal settings set` commands that change them. `/widal:open` prints `widal top --once --no-names`. That is the case in `claude -p`, in the Agent SDK, and in a Claude Code older than 2.1.287.

**Where it works:** in the terminal with Claude Code 2.1.287 or newer, in the Code tab of the Claude desktop app, and in VS Code (the extension from version 2.1.299). In VS Code the buttons have no keys: click them.

**The four tabs.** Press the digit of a tab to show it. The pane has the keyboard when a command opened it. Otherwise press Ctrl+X then Tab, or click it. Esc closes the pane.

| Tab | What it shows | What each button does |
|---|---|---|
| `1: Now` | The sessions on this computer, as `widal top` shows them. They are read again every 5 seconds while the pane is open. | Each row is a button. It opens the details of that session: project, tool, ticket, state, context, cache with the minutes left, tokens today, agents that run, the task (only while names are on), and for Claude Code the command that resumes it, `claude --resume <id>`. `b: Back` goes back to the list. |
| `2: Spend` | Today and the last 7 days, at list prices: spend for what is paid by the token, API value for what runs on a subscription, both apart when they mix. The dollars of each account and the price of its plan, when `widal accounts` is there. The top 3 proposals of `widal advise`. | `Apply <name>` asks once more: "Apply <name>? It changes Claude Code's settings, with a backup." Then `y: Yes, apply` runs `widal apply <name>`, and `n: No` does nothing. An applied change has `Undo <name>`, which runs `widal undo <name>`. `r: Read again` reads the tab again. |
| `3: Settings` | Every setting of `widal settings` in its group: the status line, the hints, the security frameworks and the checks (see "Settings" below). | A row with `[x]` or `[ ]` turns its setting on or off, through `widal settings set`. The layout of the status line moves to its other value. A value with more than two choices is a list to pick from. `Healthcare set`, `Life sciences set` and `Fintech set` switch their frameworks on. `[ ] For this project` makes the frameworks those of the session's folder. A field for each account takes a new label, through `widal accounts label`. `u: Undo the last change` runs `widal settings undo`. |
| `4: Security` | At the top: the frameworks that are on, the open findings by severity, and the sentence that Widal.Code checks technical controls and does not certify anything. Then one row per open finding, the most severe first: its severity, title, where it is, and the controls of the frameworks that are on. They come from `widal check --json`, for the session's folder. | A row opens the finding's detail: all its fields, its fix command, and when it was first and last seen. `f: Fix` is there when Widal.Code can make the fix. It asks once: "Apply <name>? It changes Claude Code's settings, with a backup." Then `y` runs `widal apply <name>`, and the fix gets `Undo <name>`. `h: Hand to the agent` asks once: "Send this finding to Claude in this session? It uses tokens." Then `y` sends one prompt in the session (see below). `b: Back` goes back to the list. `r: Run checks for this folder` runs `widal check --run` and reads the findings again. |

- The Spend tab replays the logs, as `widal advise` does, so it can take a while the first time. It is read once each time the pane opens.
- The pane runs Widal.Code's own command from the plugin's folder, with a list of arguments and no shell. When a run fails, the pane shows one plain line that says why.
- What the pane shows is for your screen only. The two commands give Claude nothing to read.
- **Hand to the agent is the only button that uses tokens.** After you say yes, it sends this prompt in the session: "Widal.Code found: <title> in <where>. Controls: <controls>. Please fix it, explain what you changed, and do not print any secret." Only the finding's own title, place and controls go in. A finding never holds what was found, so no secret and no patient data can go in. Claude Code runs the prompt as a turn of its own once the session is idle, and shows it as sent by the Widal.Code plugin.
- A version of Widal.Code without `widal check` says on the Security tab that the checks are not part of it yet.
- Cloud checks do not run from the pane. Run `widal cloud-check` in a terminal (see "Cloud checks"); the tab then shows what it found.
- The names of tasks follow the setting `hud.names`, as on the status line.

## Settings

`widal settings` shows every setting you may change, in one place: its key, its value and what it does.

| Group | Keys | Values |
|---|---|---|
| Status line | `hud.layout` | `lines` (up to four lines) or `one` (one line) |
| | `hud.lines.session`, `hud.lines.plan`, `hud.lines.work`, `hud.lines.hint` | `on` or `off`. At least one line stays on. |
| | `hud.bars`, `hud.names` | `on` or `off` |
| Hints | `hint.effort`, `hint.compact`, `hint.nudge` | `on` or `off`: the hint about the effort level, the hint to compact, and the notification before a cache ends |
| Frameworks | `security.frameworks.<id>` | `on` or `off`, for each framework in the next table |
| Checks | `security.checks.settings`, `security.checks.actions`, `security.checks.code`, `security.checks.data`, `security.checks.cloud`, `security.checks.push` | `on` or `off` |

The security frameworks, in their groups, with the id of each:

| Group | Frameworks |
|---|---|
| Healthcare | HIPAA (`hipaa`), HITRUST CSF (`hitrust`), SOC 2 (`soc2`), ISO 27001 (`iso27001`) |
| Life sciences | 21 CFR Part 11 (`part11`), EU GMP Annex 11 (`annex11`), GDPR (`gdpr`) |
| Fintech | PCI DSS (`pci`), GLBA Safeguards Rule (`glba`), NYDFS 23 NYCRR 500 (`nydfs`), EU DORA (`dora`) |
| AI agents | OWASP Top 10 for Agentic Applications (`owasp-agentic`), OWASP Top 10 for LLM Applications (`owasp-llm`), NIST AI RMF (`nist-ai-rmf`), ISO/IEC 42001 (`iso42001`) |

- OWASP Top 10 for Agentic Applications is on until you turn it off. The other frameworks are off.
- **Sets** switch several frameworks on at once, and switch none off. `widal settings set security.set healthcare` switches on HIPAA, SOC 2 and HITRUST CSF. `life-sciences` switches on 21 CFR Part 11, EU GMP Annex 11 and SOC 2. `fintech` switches on SOC 2, PCI DSS and GLBA Safeguards Rule.
- **The checks:** settings, actions, code and the gate before a push are on. Data is off, because it reads the text of sessions. Cloud is off: it runs only on request. What each check does is in "Security and compliance".
- **The checks run now:** settings, actions and code on their own, data only when you turn it on, and the cloud only when you ask, with `widal cloud-check` (see "Cloud checks"). Widal.Code checks technical controls and flags risks. It does not make a company compliant or certify it.

| Command | What it does |
|---|---|
| `widal settings` | In a terminal: a list. Up and down (or `j` and `k`) move. Space or Enter turns a setting on or off, moves a choice to its next value, or switches a set on. `u` undoes, `q` quits. Without a terminal: the settings as text, with the commands that change them. |
| `widal settings --json` | The same as data: each setting with its key, label, group, value, allowed values and default, the sets, and the accounts. The pane reads this. |
| `widal settings set <key> <value>` | Changes one setting, for example `widal settings set security.frameworks.hipaa on`. A wrong key or value gives one sentence and exit code 1, and nothing changes. |
| `widal settings undo` | Puts back what the last `widal settings set` changed. It goes back one step. |

- **Where they are kept.** Your settings are in `~/.widal/config.json`, where `widal hud`, `widal hint` and `widal nudge` keep the same values. Those commands keep working. `widal hint on` and `widal hint off` set both hints at once. `widal settings` sets each one.
- **For one repository.** `--project <folder>` writes the frameworks for that repository instead, into `<folder>/.claude/loobster-frameworks.json`, as `{ "frameworks": [ ... ] }`. Another plugin already uses that file, so every other key in it stays. When the file names frameworks, they win over your own setting for that repository. `widal settings --project <folder>` shows them. Only the frameworks and the sets take `--project`. A file that is not a JSON object is never written over.
- **Accounts.** When `widal accounts` is there, `widal settings` lists the accounts with their labels. Change a label with `widal accounts label <key> "<label>"`, or in the pane.
- Nothing here changes Claude Code's settings.

## Security and compliance

Widal.Code checks what your agents may do, what they did, and the code they changed. It flags the risks it finds, and names the controls they touch in the frameworks you switched on (see "Settings").

**Widal.Code checks technical controls and flags risks. It does not make a company compliant or certify it.** Every list of findings ends with this sentence.

**What is checked, and when.**

| Check | What it reads | When it runs | On by default |
|---|---|---|---|
| Settings | Claude Code's user settings, the organization's managed settings when they can be read, the project's `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`, the MCP servers in `.claude.json`, and Codex's `config.toml` | When a session starts, and with `widal check --run` | Yes |
| Actions | The whole session's log, read a piece at a time: the names of tools, the paths of files, and the words of shell commands | When an agent's turn ends, and with `widal check --run` | Yes |
| Code | The files the agent changed in the session's repository: those that differ from the last commit, and new files git does not know yet. At most 200 files and 2 MB per file. Binary files and `node_modules` are skipped. | When an agent's turn ends, and with `widal check --run` | Yes |
| Data | The user messages and tool results in the whole session's log | When an agent's turn ends, and with `widal check --run`, only after `widal settings set security.checks.data on` | No |

- The hooks start the checks in the background and return at once. A session never waits for a check. A second start for the same repository within 60 seconds is skipped.
- Each check can be turned off with `widal settings set security.checks.<name> off`: `settings`, `actions`, `code`, `data`.
- `widal connect` adds the three hooks to Claude Code's settings, and the plugin carries the same three (see "The plugin's hooks"). A hook never acts twice. `widal disconnect` takes them out.

**The rules.**

| Rule | Severity | It flags | Fix |
|---|---|---|---|
| `set.bypass-mode` | high | `permissions.defaultMode` is `bypassPermissions` or `auto` in the user or managed settings, or `skipDangerousModePermissionPrompt` is true, while bypass mode is not disabled | `widal apply no-bypass` |
| `set.allow-any-shell` | high | An allow rule `Bash` or `Bash(*)` | |
| `set.no-secret-deny` | medium | No deny rule in the user or managed settings for reading `.env` files and private keys | `widal apply deny-secret-files` |
| `set.sandbox-off` | medium | `sandbox.enabled` is not true in the user or managed settings | |
| `set.all-project-mcp` | medium | `enableAllProjectMcpServers` is true | |
| `set.remote-mcp` | low | An MCP server with an address on another host | |
| `set.provider-not-hipaa` | medium, only with HIPAA on | `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or an `ANTHROPIC_BASE_URL` that points away from Anthropic's API: Claude Code's HIPAA configuration does not cover such sessions | |
| `set.transcripts-kept` | low, medium with HIPAA, PCI DSS, 21 CFR Part 11 or GDPR on | `cleanupPeriodDays` missing (30 days) or above 7, or `desktopSessionCleanupPeriodDays` missing (kept without end) or above 7. Transcripts are plain text on disk. | `widal apply transcript-days` |
| `set.otel-prompts` | medium | `OTEL_LOG_USER_PROMPTS` or `OTEL_LOG_TOOL_DETAILS` turned on | |
| `codex.approval-never`, `codex.full-access` | high | `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, at the top of Codex's `config.toml` or in a profile | |
| `codex.network`, `codex.history` | medium, low | `sandbox_workspace_write.network_access = true`, `history.persistence = "save-all"` | |
| `act.read-secret-file` | high | A read of `.env`, `.env.*` (not `.env.example`), `*.pem`, `id_rsa*` (not `.pub`), `.aws/credentials`, `*.p12`, `.npmrc` or `.netrc` | |
| `act.self-config` | medium | An edit of `.claude/settings*.json`, `.mcp.json`, `.codex/config.toml` or a hooks file | |
| `act.send-out` | medium | `curl` with `-T`, `--upload-file`, `-d @`, `--data-binary @` or `-F`, `scp`, `rsync` to a host, `nc` | |
| `act.force-push` | medium | `git push` with `--force` or `-f` | |
| `act.destroy` | high | `terraform destroy`, `kubectl delete`, an `aws` delete, `aws s3 rm`, `aws s3api put-bucket-acl`, `gcloud ... delete`, `vercel --prod`, `vercel rm`, `prisma migrate reset`, `dropdb` | |
| `act.no-verify` | low | `git commit` or `git push` with `--no-verify` | |
| `code.iac` | the scanner's | Infrastructure code with a risky setting (see "Scanners" below) | |
| `code.secret` | high | A secret key in the code | |
| `code.tls-off` | high | `verify=False`, `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` set to `0`, `InsecureSkipVerify: true`, or `curl -k` in a script | |
| `code.phi-log` | medium, only with HIPAA or GDPR on | A log or print call in the same line as a field named like `ssn`, `dob`, `date_of_birth`, `mrn`, `medical_record`, `patient_name`, `diagnosis` or `insurance_id` | |
| `code.card-number` | medium, only with PCI DSS on | A 13 to 19 digit number that passes the check of card numbers, outside folders and files named as test fixtures | |
| `code.http` | low | An `http://` address to a host that is not this computer, in a config file | |
| `data.us-ssn`, `data.card-number`, `data.secret` | high | A US social security number, a card number or a secret key in the session's text. The finding says that the transcript holds it in plain text, where, and for how long. | `widal apply transcript-days` |

A command is split into words as a shell splits it, so a word inside a quoted argument does not count: `git commit -m "no --force"` is no force push.

**Scanners.** No check needs an installed program. With one, Widal.Code uses it:

- **Infrastructure code:** Checkov, Trivy (`trivy config`) or KICS, the first one found, with a time limit of 60 seconds. They check Terraform, CloudFormation, Kubernetes YAML and Dockerfiles. Without one, or when it fails or runs out of time, Widal.Code's own rules check Terraform only: an S3 bucket with a public ACL or without encryption, a security group open to `0.0.0.0/0` on a port other than 80 and 443, `publicly_accessible = true`, and `storage_encrypted = false`. CloudFormation, Kubernetes YAML and Dockerfiles need a scanner.
- **Secret keys:** gitleaks when it is installed, run with `--redact`, with the same time limit. Without it, Widal.Code's own patterns: AWS access key ids, private key blocks, GitHub tokens, Anthropic and OpenAI API keys, and Slack tokens.
- Each finding says which program found it.

**What is read, and what is never kept.** The findings are in `~/.widal/findings.json`. A finding holds the rule, the severity, where (a file and line, a path inside the repository, a session), when it was first and last seen, and the controls. It never holds what was matched: no key, no number, no command, no text of a session.

- **Actions:** Widal.Code looks at the name of a tool, the path of a file and the words of a shell command only to compare them with the rules. It keeps the rule, the time and, for a file, its path inside the repository. Never the command. A read or an edit of a file that was denied or failed is no finding: Widal.Code looks only at the error flag of its result, never at the text. A shell command counts also when it failed, because it may have done part of its work first.
- **Data:** only the kind and the count.
- **MCP servers:** only the name, the type and the host. Never the headers or the environment of a server.
- A finding that a later run does not find again is resolved. Resolved findings older than 30 days are dropped.

**The gate.** Before `git push`, `gh pr create` or `gh pr merge`, while a high finding of the code or the actions is open in that repository, Claude Code asks you first:

```
Widal.Code: 2 high risks are open in this repository: A secret key is in the code; The code turns off the check of TLS certificates. See them with widal check.
```

It never refuses: you answer the question. It also sees `git -C <folder> push` and `cd <folder> && git push`, and then looks at that folder's repository. Turn it off with `widal settings set security.checks.push off`.

- **A hook that answers for you.** The question is a normal permission question of Claude Code. If you have a hook of your own that answers every permission question with "allow" (a `PermissionRequest` hook), that hook answers this question too, and the push goes ahead. The live test on 14 Nov 2026 showed exactly that: Claude Code said "Allowed by PermissionRequest hook". To keep the gate, let such a hook leave out `git push`, `gh pr create` and `gh pr merge`.

**Where findings show.**

| Where | What |
|---|---|
| The status line | At the start of line `session`, and at the start of the one line: `2 high risks` in red, or `1 medium risk` in yellow, for the settings and the session's repository. Nothing when there are none. It reads only the findings file. |
| `widal check` | The frameworks that are on, then the open findings by kind, the most severe first, each with what it is, where, the controls of the frameworks that are on, and its fix. Then the sentence about not certifying. |
| `widal check --run` | Runs the checks that are on for this folder first: the settings, the code of its repository, and the Claude Code sessions of this folder of the last 7 days. |
| `widal check --json` | The same as data: `at`, `frameworks`, `counts`, `findings` and `note`. The pane and the desktop extension read it. |
| `widal check --export findings.csv` | The open and the resolved findings with their dates and controls, as a CSV file, for an audit. The last line is the sentence about not certifying. A cell that starts with `=`, `+`, `-` or `@` gets a `'` in front, so a spreadsheet never runs it as a formula. |

**The fixes.** Three findings name a change that Widal.Code can make. Each saves a copy of `~/.claude/settings.json` first, and `widal undo <name>` takes it back (see "Every change the tool can make to Claude Code's settings").

| Command | What it changes |
|---|---|
| `widal apply no-bypass` | Sets `permissions.disableBypassPermissionsMode` to `"disable"`, and takes out `skipDangerousModePermissionPrompt`. Bypass mode can no longer start. |
| `widal apply deny-secret-files` | Adds deny rules for `.env` files, `.pem` files, `id_rsa` keys and `.aws/credentials`. Your other rules stay. |
| `widal apply transcript-days` | Sets `cleanupPeriodDays` and `desktopSessionCleanupPeriodDays` to 7 days, or to `--days`. Claude Code then deletes older transcripts at the start of a session. Widal.Code's reports read the same transcripts, so they see that many days at most. |

**Frameworks and controls.**

- A finding names the controls of the frameworks that are on: your own (`widal settings`), or for code in a repository with `.claude/loobster-frameworks.json`, that file's. A finding that touches none of them keeps its controls of the AI agents group: OWASP Top 10 for Agentic Applications, OWASP Top 10 for LLM Applications, NIST AI RMF and ISO/IEC 42001.
- **"(id to check)"** follows every control id that was not checked against the framework's own text. The ids that were checked: the HIPAA Security Rule 45 CFR 164.312(a), (a)(2)(i), (a)(2)(iv), (b), (c), (d), (e) and 164.514(b)(2)(i), 21 CFR 11.10(a), (c), (d), (e), (g) and (k), PCI DSS 6.4.3 and 11.6.1, GLBA 16 CFR 314.4, DORA Art. 28, and the OWASP Top 10 for LLM Applications 2025.
- **HITRUST** has no ids here. Its findings name the HIPAA and ISO 27001 controls they touch, with the words "HITRUST: through the controls it shares with HIPAA and ISO 27001".
- **ISO/IEC 42001** has no ids here either. The NIST AI RMF is named by its four functions: Govern, Map, Measure and Manage.
- The catalog is in `src/controls.mjs`, and the rules with their controls are in `src/rules.mjs`.

## Cloud checks

`widal cloud-check` reads the security settings of one cloud account, project or repository, and saves what it finds, so that `widal check` and the pane's Security tab show it too. It only reads. It runs only when you type it: never on a timer and never from a hook. It uses the sign-in you already have in the provider's own command line tool. Widal.Code never reads a credentials file and never keeps a key.

| Command | What it reads | What it needs |
|---|---|---|
| `widal cloud-check aws [--profile <name>] [--region <r>] [--minutes 20]` | With Prowler: Prowler's checks for the frameworks that are on. Without Prowler: the results AWS already has, from AWS Config conformance packs and Security Hub CSPM. | The AWS CLI (`aws`), signed in. Read access: the AWS managed policy SecurityAudit. Prowler is optional. |
| `widal cloud-check vercel [--project <name>] [--team <id>]` | Deployment protection, Password Protection and Trusted IPs, environment variables that look like secrets, and the firewall | The Vercel CLI (`vercel`), signed in. For two of the checks: a token in `VERCEL_TOKEN`. |
| `widal cloud-check github [--repo <owner/name>]` | A review before a merge into the default branch, secret scanning and push protection, the counts of open alerts, and two-factor sign-in in the organisation | The GitHub CLI (`gh`), signed in |

- A run prints what it checked, what it skipped and why, the open findings with their controls, and the sentence that Widal.Code checks technical controls and does not certify anything.
- **A finding never holds what was found:** no secret, no value of a variable, no text that a scanner wrote about a resource. It holds the check's title, the resource's id, and the controls.
- **What one run covers:** one AWS account (and the region, when you name one), one Vercel project, or one GitHub repository. A later run of the same resolves what was fixed since. A run that could not finish (a time limit, a tool that failed in the middle) saves nothing, so it resolves nothing either.
- A tool that is not installed, or a sign-in that does not work, gives one sentence and exit code 1.
- A run keeps the 500 most severe findings at most, and says how many it left out.

**AWS.** First `aws sts get-caller-identity` says which account the sign-in is for. Only the account id is kept. Then one of two paths:

- **With Prowler.** Prowler is an open source scanner (Apache 2.0). When it is installed, Widal.Code runs `prowler aws` with the compliance frameworks that match the frameworks that are on, and only those that Prowler has: HIPAA (`hipaa_aws`), SOC 2 (`soc2_aws`), ISO 27001 (`iso27001_2022_aws`), PCI DSS (`pci_4.0_aws`), 21 CFR Part 11 (`gxp_21_cfr_part_11_aws`), EU GMP Annex 11 (`gxp_eu_annex_11_aws`) and GDPR (`gdpr_aws`). HITRUST runs through HIPAA and ISO 27001. Prowler has nothing for GLBA or NYDFS, and its DORA results do not reach the file Widal.Code reads. When no framework that is on has one in Prowler, Prowler runs all its checks.
  - Prowler scans every region, unless you name one with `--region`. It stops after 20 minutes. `--minutes 60` gives it longer.
  - Widal.Code reads the failed checks from Prowler's JSON-OCSF file, in a new temp folder. That report names your resources, so Widal.Code deletes it and its folder right after reading it, also after a failed run. For the full report, run Prowler yourself.
  - Prowler's own documentation asks for the policies SecurityAudit and ViewOnlyAccess, and an extra policy for some checks. That extra policy has one permission that writes (`securityhub:BatchImportFindings`), and it can read content such as log events. Read it before you add it.
- **Without Prowler.** Widal.Code reads what AWS already has, in the CLI's region or the one you name: the rules that are not compliant in each AWS Config conformance pack that is deployed, and the findings of Security Hub CSPM's controls with severity high or critical.
  - AWS has conformance packs for HIPAA Security, PCI DSS, 21 CFR Part 11, GxP EU Annex 11, GLBA, NYDFS 23 and many more, and none for SOC 2, ISO 27001 or HITRUST. A pack has to be deployed first.
  - Security Hub CSPM (the Security Hub from before 2025) has standards for AWS Foundational Security Best Practices, CIS, NIST 800-53, NIST 800-171 and PCI DSS, and none for HIPAA or SOC 2.
  - When neither is there, or neither may be read, the run saves one finding of severity info that says what to switch on and what it costs.
- **What the AWS services cost** (AWS's prices in Nov 2026, for US East). Security Hub CSPM costs about $0.001 per check of one resource in one region, for the first 100,000 checks a month, after a free trial of 30 days per account and region. It needs AWS Config, which is paid on its own. AWS Config costs $0.003 per configuration item it records, and $0.001 per rule evaluation and per conformance pack evaluation, for the first 100,000. See aws.amazon.com/security-hub/cspm/pricing and aws.amazon.com/config/pricing. Prowler is free.
- AWS Audit Manager takes no new customers since 30 Apr 2026, so Widal.Code does not use it.

**Vercel.** The project is the one this folder is linked to, or the one `--project` names. `--team` names its team.

- Deployment protection and Password Protection, with `vercel project protection <project> --json`. Previews that nothing protects are a finding of severity high. URLs of production deployments that nothing protects are one of severity medium. Production domains are public on purpose for most sites, so Widal.Code does not flag them.
- The firewall on or off, with `vercel firewall status --json`.
- Trusted IPs, and environment variables that stay readable after they are saved (Config, not Secret) while their name ends in `_KEY`, `_SECRET` or `_TOKEN` or holds `PASSWORD`. Only Vercel's REST API answers these. Widal.Code calls `GET /v9/projects/<id>` on api.vercel.com, and only when you set `VERCEL_TOKEN` (make a token in your account settings on vercel.com). It sends the token there only, and never writes it anywhere. Of each variable it reads the name and the kind, never the value. Without the token the run says that these checks were skipped, and their findings from an earlier run stay as they were.
- With HIPAA on: one finding of severity info. Vercel signs a HIPAA BAA only on Pro with the paid add-on, and on Enterprise. Widal.Code cannot see whether yours is signed.
- Vercel itself has a SOC 2 Type 2 attestation and is ISO 27001 certified. That covers Vercel, not your project.

**GitHub.** The repository of this folder, or the one `--repo` names. Each check is a `gh api` call:

- The default branch needs at least one approving review before a merge, by a ruleset or by branch protection.
- Secret scanning and push protection are on. GitHub shows this only to admins of the repository.
- Open secret scanning alerts (asked without the secrets), open Dependabot alerts of severity high and critical, and open code scanning alerts: the counts only. When GitHub answers 403 or 404 for code scanning, it is not enabled.
- For a repository of an organisation: two-factor sign-in is required. GitHub shows this only to owners.
- What your sign-in may not see is one sentence in the output, and no finding.

**Controls.** A cloud finding names the controls of the frameworks that the provider's tool reported: Prowler's requirement ids, the rule of a conformance pack, and Security Hub's PCI DSS requirements. Widal.Code's own checks of Vercel and GitHub name controls that Widal.Code chose. Every id that is not checked against the framework's own text shows "(id to check)".

## The Widal.Code board

The Widal.Code board is a web app for a team. Each person links their computer to it once. From then on Widal.Code on that computer sends what it records to the board, on its own. The board joins that with the team's pull requests on GitHub, and shows the spend, the cost of each pull request, parallel work, waste and the security findings of the whole team in one place. The board is a separate project.

**Link this computer.** Run this in a terminal, with your board's address:

```
widal board login https://code.widal.com
```

1. Widal.Code prints an address and a code, such as `BCDF-GHJK`, and opens the address in your browser (`open` on macOS, `xdg-open` on Linux).
2. Sign in to the board with GitHub. Check that the board shows the same code and your computer's name, pick the team when you are in more than one, and click Approve.
3. Widal.Code saves the link and sends the first data right away: the last 30 days. It says what it sent.

The code works for 15 minutes. Ctrl-C stops the waiting. The address has to start with `https://`. Plain `http://` works only for a test board on this computer (`localhost` or `127.0.0.1`).

| Command | What it does |
|---|---|
| `widal board login <address>` | Links this computer to the board, as above |
| `widal board status` | The board, the team, your user on the board, this computer, the last sync and what it sent, whether background sync is on, and whether the board still knows this computer |
| `widal board sync` | Sends now. `--days 30` sends that many days again. |
| `widal board logout` | Unlinks this computer. Widal.Code sends nothing more. |

**When Widal.Code sends.** Right after the link, and then about every 10 minutes while you work: the status line and the plugin's hooks at the start of a session and at the end of a turn start a sync in the background when the last one is 10 minutes old or more. They read two small files for that and never wait for the sync. The status line itself never uses the network. A lock file (`~/.widal/board.lock`) keeps two syncs from running at once. Without the status line and the plugin, run `widal board sync` yourself.

**What is sent.** Once you link a computer, Widal.Code sends everything it records, with no further question:

- **The model calls:** for each call its time, session, agent (Claude Code, Codex or Cowork), model and effort level, the tokens of each kind, the cost at list prices, the folder, the GitHub repository (`owner/name` of the folder's git remote `origin`), the git branch and its ticket, the account, whether it came from a subagent and its parent session, the names of the tools with 8 characters of a hash of their input, the sizes of what entered the context, and the counts of failed tool results and interrupts.
- **The sessions,** with their folder, repository, branch and ticket. For the sessions that are open now: whether they work, wait for you or are idle. While the names of tasks and agents are on (`widal hud names on`, the default), also the names of their tasks, and the kind and short description of each agent that runs. With names off, none of these.
- **The commits** made while a session worked in a repository, from your local git: the commit's id and time, and the session. Only your own commits: when git knows your email (`user.email`), a commit with another committer email came with a pull and is left out. That email is read on your computer only, and never sent.
- **The security findings** (the whole list), the plan's limits of each account, the accounts (their key, label, how they pay, their plan, and the price of their plan a month: the one you set, else a public price that Widal.Code knows, else none), the settings as `widal settings --json` gives them, and the proposals as `widal advise --json` gives them (at most every 6 hours, because the replay takes time).

**What is never sent.** The text of a prompt, an answer, a tool result or a file. Widal.Code never keeps that text, so it has none to send. The name of the program of a shell command, which Widal.Code keeps for `widal findings`, is not sent either. Folders are sent with `~` for your home folder, so your user name on the computer is not sent. No email address and no person's name is sent.

**The token.** The board gives this computer a token that starts with `kbm_`. It is the one secret Widal.Code keeps. It is in `~/.widal/board.json`, which only you can read (mode 600), and Widal.Code never prints it in full (`widal board status` shows `kbm_…` and its last 4 characters). The board keeps only a hash of it.

**How it works.** Each sync sends the calls since one hour before the last sync, to catch a call that reached its log a little late. The board keeps a call by its id, so a call sent twice changes nothing. A request holds at most 2000 calls, packed with gzip, and is split in half while it is bigger than 3.5 MB. Each request has a time limit of 60 seconds. The time of the sync is saved only after the board took every request. When the network or the board fails, nothing is saved and the next sync sends the same again. `widal board status` shows the last failure.

**Stop it.** `widal board logout` tells the board, which stops taking the token at once, and deletes `~/.widal/board.json`. When the board cannot be reached, the link on your computer is deleted all the same: remove the computer on the board's Machines page. You, or an admin of your team, can also click Revoke there. Widal.Code then stops its background syncs at the next try, and `widal board status` says that the board removed the computer. To link again, run `widal board login` again.

## Install from this folder

```
node cli/widal.mjs connect
```

Run it in this folder. This is the way to use a checkout of the repo instead of the plugin. It links to this folder and copies nothing. It does four things:

- It makes the link `~/.widal/bin/widal` to the command in this folder. Claude Code's settings call the tool through this link.
- It links the command to `~/.local/bin/widal`, so that you can type `widal`. That folder has to be on your PATH.
- It sets Claude Code's status line in `~/.claude/settings.json`, with a refresh every 30 seconds. A copy of the file is saved in `~/.widal/backup/` first. Another tool's status line is kept, unless you run `widal connect --force`.
- It adds the three hooks of the security checks to the same file (see "Security and compliance"). Hooks of other tools stay.

**Another program named widal.** Widal.Factory, another tool of Widal, also has a command named `widal`, and its folder can be on your PATH. So two programs named `widal` can be on one computer:

- The tool never replaces or removes another program at `~/.local/bin/widal`, and says so. It leaves another program at `~/.local/bin/kestrel` or `~/.local/bin/agent-spend` alone in the same way.
- When another program named `widal` comes first on your PATH, `widal connect` and `widal doctor` say where it is. Then type `~/.widal/bin/widal` instead of `widal`, for example `~/.widal/bin/widal summary`. Or put `~/.local/bin` before the other program's folder in your PATH.
- Claude Code's settings never call the link on the PATH, so they always run this tool.
- The tool only ever changes or takes out an entry in Claude Code's settings that calls its own files: `~/.widal/bin/widal`, `~/.kestrel/bin/kestrel`, its own link on the PATH, or its own command file. An entry that calls the bare word `widal`, or a program named `widal` in another folder, belongs to the other program and stays as it is.
- For the same reason, `widal` does not take the four commands that had other names before 17 Nov 2026: `install` is `widal connect`, `uninstall` is `widal disconnect`, `status` is `widal doctor`, and `mcp` is `widal desktop-mcp`. Typed with the old name, `widal install` says the new one.

Codex and Cowork need no setup. Their logs are read as they are.

`widal doctor` shows what is installed. `widal disconnect` takes the tool out of Claude Code again.

The tool keeps its files in `~/.widal`. Set `WIDAL_HOME` to use another folder.

## Coming from Kestrel

The tool was called Kestrel until 17 Nov 2026. Its command was `kestrel`, its folder was `~/.kestrel`, the plugin was `kestrel@kestrel`, and the board was at `https://kestrel.widal.com`. You do not need to do much:

1. Update the tool: update the plugin in Claude Code, or pull this folder.
2. Type any command once, for example `widal doctor`, or `kestrel doctor` while `widal` is not on your PATH yet. With the plugin, starting a new Claude Code session does the same.
3. From then on, type `widal` in place of `kestrel`.

The first command, or the plugin at the start of a session, moves the install to the new name. It prints each thing it did, and does it only once:

- **The folder.** It renames `~/.kestrel` to `~/.widal`, with everything in it, and leaves `~/.kestrel` as a link to `~/.widal`. Sessions that are open call `~/.kestrel/bin/kestrel` for their status line and hooks, and that path keeps working through the link. When both folders are there, it changes neither. When `WIDAL_HOME` (or `KESTREL_HOME`) is set, it moves no folder.
- **The links.** It makes the link `~/.widal/bin/widal`, which Claude Code's settings call from now on. It adds the link `~/.local/bin/widal` next to `~/.local/bin/kestrel`. The old links stay.
- **Claude Code's settings.** In `~/.claude/settings.json` it changes the status line and this tool's hooks to call `~/.widal/bin/widal`, with the same words after the command. A copy of the file is saved in `~/.widal/backup/` first. Nothing else in the file changes.
- **The board.** A computer that was linked to `https://kestrel.widal.com` is linked to `https://code.widal.com` from then on. It is the same board under its new address, so the link stays valid and you do not log in again.

The status line and the hooks never run the move. A command typed in a checkout that the install does not run moves nothing either: there, run `widal migrate` to move the install to that checkout.

**What keeps working for one release.**

- The command `kestrel`, with every command, also `kestrel install`, `kestrel uninstall`, `kestrel status` and `kestrel mcp`. Each command typed this way prints a note on stderr to type `widal`. The status line and the hooks never print it.
- The links `~/.kestrel` and `~/.widal/bin/kestrel`, so that sessions from before the move keep working.
- The settings `KESTREL_HOME`, `KESTREL_COWORK_DIR`, `KESTREL_MANAGED_SETTINGS`, `KESTREL_MCP_WAIT_MS` and `KESTREL_NO_BROWSER` are still read. The `WIDAL_` name wins when both are set.
- A change that you applied under the old name stays applied. `widal doctor` shows it, and `widal undo` takes it back.

**The plugin.** The plugin is now called `widal`, so its commands are `/widal:connect`, `/widal:report`, `/widal:open` and so on. `/kestrel:setup` is now `/widal:connect`, and `/kestrel:status` is now `/widal:doctor`. Add the new plugin and take out the old one:

```
/plugin uninstall kestrel@kestrel
/plugin marketplace remove kestrel
/plugin marketplace add Widal-Inc/widal-code
/plugin install widal@widal
```

Take the old plugin out first: two plugins with the same hooks would run each hook twice.

**The desktop extension.** The extension is now called Widal.Code, in the file `widal-code.mcpb`, and the skill for the web and the phone is in `widal-code-skill.zip`. An installed Kestrel extension keeps working, because it carries its own copy of the tool. To move to the new one, remove Kestrel under **Settings**, **Extensions** in the app, and install `widal-code.mcpb` (see "Install in the Claude desktop app").

## Coming from agent-spend

The tool was called `agent-spend` until 13 Nov 2026. The same move brings an install from that time to the new name: it renames `~/.agent-spend` to `~/.widal`, and leaves `~/.agent-spend` as a link to it. To run it by hand, type in this folder:

```
node cli/widal.mjs migrate
```

Once you have pulled this version, the old command does not run: its file moved from `bin/` to `cli/`, and the link still points at the old place. So run the move right after the pull. `widal connect` runs the same steps first.

- **The links.** It makes the link `~/.widal/bin/widal`, and adds the link `~/.local/bin/widal` next to `~/.local/bin/agent-spend`. A link that points at the command's files in `bin/`, where they were before 13 Nov 2026, is pointed at the same file in `cli/`.
- **Claude Code's settings.** An entry is changed when its program is one of these: the full path of `~/.local/bin/agent-spend` or `~/.local/bin/kestrel`, the link `bin/kestrel` in `~/.agent-spend`, `~/.kestrel` or `~/.widal`, the bare word `agent-spend` or `kestrel`, or `node` with a path that ends in `agent-spend.mjs` or `kestrel.mjs` in the folder `cli` or `bin`. A program that only has the name in a longer name, or a command that has it only in an argument, belongs to another tool and stays.
- The link `~/.local/bin/agent-spend` stays, and `cli/agent-spend.mjs` runs the same program as `cli/widal.mjs`. `widal disconnect` removes the old links, when they are this tool's.
- A second `widal migrate` changes nothing, and says that nothing was left to do.
- `AGENT_SPEND_HOME` is no longer read. Set `WIDAL_HOME`.

## How you pay decides what you see

There are two ways to pay for Claude Code. A dollar figure means something else in each.

- **A subscription** (Pro, Max, Ultra). You pay a fixed price. The plan has a limit per 5 hours and a limit per week. What counts is how much of those limits is used. So the status line, the notification and the warnings show percent of the plan's limits, and tokens.
- **By the token** (an API key or a cloud provider). Every token is billed. So the same places show dollars.

The tool finds out how you pay. It takes the first of these that holds:

1. You set it by hand, with `widal plan subscription` or `widal plan usage`. In the commands, paying by the token is called "usage".
2. Claude Code gives the session the plan's limits. It does that for subscribers only. So this is a subscription.
3. One of Claude Code's switches for a cloud provider is set in the environment (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_MANTLE`). So you pay by the token.
4. `ANTHROPIC_API_KEY` is set in the environment. So you pay by the token. The tool only looks whether the variable is set. It never keeps or prints the key.
5. The plan's limits were seen on this machine in the last 24 hours. So this is a subscription.
6. None of these holds. The tool then shows dollars and says that it is not sure. The status line marks them with `(list prices)`.

`widal plan` shows the answer and the reason. Right after the install no session has shown its limits yet, so it can say "not sure" to a subscriber. `widal plan auto` takes back what you set by hand.

**The reports always show dollars, and say what they are.** `widal summary`, `widal findings` and the other reports price every call at list prices: the public price per token of each model. They still show which work is large and which is small. What the dollars mean depends on the account of each call:

- **Spend.** For an account that pays by the token (an API key, a cloud provider), the dollars are what you pay. The reports call them spend.
- **API value.** For an account on a subscription (Claude Pro, Max or Ultra, a Team or Enterprise seat, a ChatGPT plan for Codex), you pay the plan's price instead. The reports call the same dollars API value: what the same use would cost by the token.
- **Both.** When a period has calls of both kinds, the reports show them apart, for example:

```
Paid by the token: $12.50 (spend, at list prices)
On subscriptions: $412 of API value (what the same use would cost by the token)
```

- **Not known.** An account whose way to pay Widal.Code cannot tell shows its dollars "at list prices". `widal plan subscription` or `widal plan usage` tells it for such accounts.

How an account pays comes from the same signs as above, per account: a reading of its plan's limits, what Claude Code's file `.claude.json` says about it, a Codex plan type, the key `api` (an API key) or `cloud` (a cloud provider). `widal summary`, `widal findings`, `widal accounts`, `widal session`, the pane and the desktop extension all use these words. A limit that you set with `widal limit` is in dollars at list prices.

**The price of a plan.** For each subscription in the period, `widal summary` and `widal accounts` show a block "Plans": the plan's limits now, then the API value of the period next to the plan's price for the same number of days (the price a month, times the days, divided by 30):

```
Plans
  Acme (claude:1a2b3c4d): Claude Max, $100 a month (the plan's public price)
    Limits now: week 41% used, 52% of the week gone; 5 hour limit 33% used, 60% of its time gone
    API value in 7 days: $412. The plan's price for 7 days: $23.33. That is 17.7 times the plan's price.
```

- Widal.Code knows the price of these plans, as claude.com/pricing gave them on 16 Nov 2026: Claude Pro $20 a month (billed monthly; billed yearly it is $17 a month), Claude Max $100 and Claude Ultra $200, and ChatGPT Plus $20 and ChatGPT Free $0 for Codex. Team and Enterprise seats and other plans have no price there.
- Claude Code names both Max and Ultra `claude_max`. Widal.Code tells them apart by the rate limit tier in `.claude.json`: a tier that ends in `max_5x` is Max, and one that ends in `max_20x` is Ultra (the pricing page links Ultra to `max_20x`). Widal.Code keeps only `5x` or `20x` of it. Without a tier the plan shows as "Claude Max or Ultra", with no price: set it with `widal accounts price`.
- `widal accounts price claude:1a2b3c4d 100` sets the price of an account's plan, in dollars a month (0 to 100,000, such as 100 or 19.99). A price you set wins over the one Widal.Code knows. `widal accounts price claude:1a2b3c4d --clear` takes it away. It is kept with the account in `~/.widal/accounts.json`.
- A plan without a price says so, with the command that sets one: `Price not set: widal accounts price claude:1a2b3c4d <dollars>`.
- A Cowork account runs on the plan of the Claude account with the same id, so both count as one plan, with one price.

## The status line

Claude Code shows a status line at the bottom of a session. This tool fills it with up to four lines. If you want one line instead, run `widal hud one` (see "One line" below).

**The four lines.** With the sample that `widal hud` shows:

```
[Opus 5.5 · high] │ my-app git:(main) │ context ████░░░░░░ 42% of 1M │ cache warm, 52 min left
week ████████▌░ 85%, full 2.2 days early │ 5h ███░░░░░░░ 33% │ today 41M tokens, 96% from the cache
▸ Writing the tests (3/5) │ Explore: find where the hooks run (4 min), general-purpose: check the guide (2 min) │ other sessions: 1 waits for you
context 420k: a good moment to /compact
```

| Line | What it shows | Where the numbers come from |
|---|---|---|
| `session` | First, the open security risks of the settings and of the folder's repository: `2 high risks` in red, or `1 medium risk` in yellow when none is high. They come first because a terminal cuts a long line at its end. Then the model and its effort level. The folder and its git branch. The context as a bar, the percent used, and the size of the context window. The cache. A lost cache and keep-warm show here too. | Claude Code's input to the status line. The branch is read from the folder's git files, without running git. The risks: the file `~/.widal/findings.json` (see "Security and compliance"). |
| `plan` | When more than one account was used in the last 7 days, the name of the session's account first, as in `Widal, Inc. · week ...` (see "More than one account"). On a subscription: each limit of the plan as a bar with its percent, the week first. A limit that is on pace to be full before its reset says how much earlier, and an old reading says how old it is. By the token: the dollars of the session and of today. Then today's tokens of all agents on this computer, and how much of them came from the cache. | The limits: the newest reading of all sessions of the same account (see "Every session shows the newest reading of the limits" below). Today's tokens: the file `~/.widal/today.json`, which the command `widal refresh-today` makes from the logs. When that file is missing or more than 5 minutes old, the status line starts the command in the background, at most once in 2 minutes. Until the file is there, the part is left out. |
| `work` | The task in progress and how many tasks are done (`▸ Writing the tests (3/5)`), or `tasks done (5/5)`. Up to two agents that run, each with its kind, what it does and the minutes since it started, then `+1 more`. The other open sessions: how many work and how many wait for you (yellow when one waits). A warning in yellow when another open session works on the same ticket: `ABC-321 is also open in Projects/other`, with `and 2 more` when there are more folders. The line is left out when it has nothing to show. | The task list and the agents: the end of this session's log (its last 256 KB), read once per run. The task list is the newest `TodoWrite`, or the tasks of `TaskCreate` and `TaskUpdate`. An agent is a call of the tool `Task` or `Agent` that has no result yet. The other sessions: the small file that each session's status line keeps in `~/.widal/sessions/`. A session is open when its status line ran in the last 2 minutes, and it works when it made a model call in the last 60 seconds. The ticket comes from the git branch: `user/abc-321-lines` gives ABC-321. |
| `hint` | The hint about the effort level and the hint to compact, in their colours (see "Model and effort" and "Compaction"). The line is left out when there is no hint. | The same as on one line. |

- **Bars** have 10 cells. A full cell `█` is 10%, and `▌` is half a cell (5%). 0% to 4% is all `░`, and only 100% or more is all `█`. A bar has the colour of its part.
- **The names of tasks and agents show on your screen.** They come from the session's log. Widal.Code shows them on the status line and never writes them to a file: not to a session's file, not to `today.json`, not to the cache. `widal hud names off` shows counts only: `tasks 3/5`, `2 agents running`. A computer linked to a Widal.Code board sends the names of the tasks and agents of its open sessions to the board while names are on, and none while they are off (see "The Widal.Code board").
- The parts are separated by ` │ `. With colours, each line ends with a reset. Without colours (see "The colours" below) the bars stay, because they are characters.
- A line that fails is left out, and the other lines are still shown.

**Choose the lines.** `widal hud` shows the settings in words and a preview made with the sample above. Each change prints the new preview. The settings are kept under `hud` in `~/.widal/config.json`. They change nothing in Claude Code's settings.

| Command | What it does |
|---|---|
| `widal hud` | The settings, a preview, what each line shows, and the commands |
| `widal hud lines session,plan,work,hint` | The lines to show, in this order. Any of the four. |
| `widal hud lines` | All four lines again |
| `widal hud one` | One line, as described below |
| `widal hud bars on` or `widal hud bars off` | Bars for the context and the limits, or numbers only |
| `widal hud names on` or `widal hud names off` | The names of tasks and agents, or counts only |
| `widal hud undo` | Puts back the settings from before the last change. It goes back one step. |

A wrong word gives one sentence that lists the right ones. In Claude Code, the plugin's command `/widal:hud` does the same with your own words, for example `/widal:hud hide the names`, `/widal:hud only two lines` or `/widal:hud go back`. Claude runs `widal hud`, picks the one command that does what you asked, runs it and shows the preview. `/widal:hud undo` takes the change back.

**One line.** After `widal hud one` the status line is one line of parts, separated by ` | `. It has no bars, no work line and no today's tokens. This is how the status line looked before the four lines.

On a subscription:

```
5 hour limit 42% used, 60% of its time gone | week 36% used, 44% of the week gone | cache warm, 52 min left | context 527k (53%) | effort high
```

By the token:

```
$12.40 session, $3.10 per hour | cache warm, 52 min left, then $8.43 | context 527k (53%) | effort high | today $12.40
```

What the parts of the one line mean. The four lines show the same facts, some in shorter words:

| Part | What it means |
|---|---|
| `5 hour limit 42% used, 60% of its time gone` | On a subscription. How much of the plan's 5 hour limit is used, and how much of that window's time has passed. `week` is the same for the weekly limit. |
| `: full about 75 min early` | Added to a limit when the use so far, at the same pace, fills the limit before it resets. It says how much earlier. |
| `(read 12 min ago)` | Added to a limit when its reading is 5 minutes old or more. |
| `plan limits not reported yet` | On a subscription, before Claude Code has given a reading. |
| `$12.40 session, $3.10 per hour` | By the token. What this session cost so far, by Claude Code's own figure, and the cost per hour once the session is 10 minutes old. `(list prices)` is added when the tool is not sure how you pay. |
| `cache warm, 52 min left` | How long the provider still keeps this session's context in its cache. By the token, `then $8.43` is what the next call costs after that time. |
| `cache gone: the next call re-sends 527k` | The cache has ended. The next call sends that many tokens again. By the token the part reads `cache gone, next call about $8.43`. |
| `next call at least $0.11` | By the token, when Claude Code gives no end time for the cache. It is what a read of the whole context from the cache costs. |
| `cache lost: model changed` | Shown for 10 minutes after a cache was lost, with the cause that Claude Code gives, in short words: `timed out`, `model changed`, `messages rewritten`, or Claude Code's own name for another cause. |
| `kept warm, 1.5 of 3 hours used` | Only with keep-warm (see "Before a cache ends"), and only while the session is idle. Once its cap is reached: `keep-warm stopped after 3 hours`. The part goes away with the first model call after you are back. |
| `context 527k (53%)` | The tokens in the context, and the share of the model's context window that is used. |
| `effort high` | The effort level of the session. |
| `2 high risks` | Open security findings of the settings and of the folder's repository, in red. Without a high one, `1 medium risk` in yellow. Nothing when there are none. It is the first part of the line, so that a terminal that cuts the line still shows it. See "Security and compliance". |
| `today $12.40` | By the token. What the sessions on this machine spent today. With a limit per day it reads `today $12.40 of $200`, and `limit $50` is your limit per session. |
| `limit $50 per session at list prices, $12.40 so far` | On a subscription, when you set a limit. These are the only dollars on a subscriber's line. |
| `mostly simple work at high effort: /effort medium keeps the cache` | The hint about the effort level, at the end of the line (see "Model and effort"). |
| `context 420k: a good moment to /compact` | The hint to compact, as the last part of the line, at a break in the work (see "Compaction"). |

**The colours** say how urgent a part is.

- A limit of the plan is green, yellow from 75% used, and red from 90%. It is also yellow when it is on pace to be full before its reset. It is red when it would be full within 30 minutes (the weekly limit: within 1 day).
- The cache is green while it is warm, and yellow in its last 10 minutes (the last minute of a cache that lasts 5 minutes). It is red once it is gone and the next call sends 100,000 tokens or more again.
- The context is yellow from 80% of the window, and red from 95%. It is also yellow above the size from which the model costs more per token.
- A limit in dollars is yellow from 80% of it, and red when it is reached.
- A lost cache, a keep-warm that has stopped, the hint to raise the effort and the hint that the automatic compaction is near are yellow.
- Colours are off when `NO_COLOR` is set in the environment, or with `"color": false` in `~/.widal/config.json`.

**The refresh timer.** Claude Code runs the status line after each answer. An idle session would keep showing an old cache time and an old percent. So the install also sets a timer. After `widal connect --refresh 30` Claude Code runs the status line every 30 seconds too. A plain install sets the same 30 seconds. `widal connect --refresh 0` takes the timer out. The timer costs no tokens: a run of the status line makes no model call. It reads a few small files and the last 256 KB of the session's log. One run took about 0.04 seconds on the Mac it was built on, also with a log of 100 MB and 30 sessions open.

**Every session shows the newest reading of the limits.** Claude Code gives a session the plan's limits only with that session's own last answer. An idle session would show a percent that is hours old, while another session has used the plan since. So every session saves the reading it was given in one shared file, `~/.widal/limits.json`, and every status line shows the newest reading of its own account on the machine. Each account has a reading of its own (see "More than one account"). When that reading is 5 minutes old or more, the line says so. The percent also counts what chat and Cowork used, because all three draw from the same limits.

**After a change of account.** Each session knows its account, and saves and shows the reading of that account only. So a session of one account never shows the week of another. Within one account, a session that has just had an answer gives limits that are true now, so its reading replaces the kept one, also when its week ends earlier. A session that has had answers but gets no limits from Claude Code runs on an account without them: it shows the session's dollars at list prices, and no reading that another session saved.

## All agents at once

`widal top` shows every agent session on this computer in the terminal: Claude Code, Codex and Cowork. It draws the view again every 2 seconds. Press `q` or Ctrl+C to end it. Without a terminal, and with `widal top --once`, it prints the view once.

```
Widal.Code · 4 sessions on this computer · 5 hour limit 33% used, 60% of its time gone · 12:00:00

SESSION              TOOL    TICKET                    STATE                   CONTEXT     CACHE              TODAY  AGENTS  TASK
work/app             Claude  ABC-322 also in work/web  working                 313k        warm, 50 min left  625k   1       Writing the notes
work/api             Codex   ABC-7                     working                 100k (25%)  not known          110k
work/web             Claude  ABC-322 also in work/app  waits for you (12 min)  55k         warm, 20 min left  55k
sessions/calm-river  Cowork                            idle (10 min)           100k        not known          101k

Waste today: 1 cold start sent 300k tokens again (34% of today).
Next: work/web waits for you, and its cache ends at 12:20. Answer before then, or /compact first.
```

The first line has the number of sessions, the plan's limits as the status line words them (on a subscription, of the account signed in now), and the time.

**Which sessions it shows.**

- **Claude Code:** the sessions whose status line ran in the last 2 minutes. So these rows need Widal.Code's status line. A session is working when it made a model call in the last 60 seconds. Otherwise it waits for you, and the row says for how many minutes.
- **Codex and Cowork:** the sessions whose log was written to in the last 30 minutes. A session is working when its log was written to in the last 60 seconds. Otherwise it is idle, with the minutes.
- The rows come in this order: working, waits for you, idle.

**The columns.**

| Column | What it shows |
|---|---|
| SESSION | The project folder: its last two parts |
| TOOL | Claude (Claude Code), Codex or Cowork |
| TICKET | The ticket in the name of the session's git branch, for example ABC-322 for the branch `user/abc-322-login`. When another row has the same ticket, `also in` and that row's folder follow, in yellow. Cowork's log names no branch. |
| STATE | Working, waits for you, or idle, with the minutes |
| CONTEXT | The tokens in the context. For Codex also the share of the model's context window. |
| CACHE | Claude Code: warm with the minutes left, or gone. Codex and Cowork: not known. |
| TODAY | The session's tokens today: input, cache writes, cache reads and output |
| AGENTS | Claude Code: the subagents that run now. A subagent runs from the tool call that starts it until its result comes back, as the end of the session's log shows. |
| TASK | Claude Code: the task in progress, from the session's task list |

**The line "Next".** It names one step, from the first rule that holds:

1. A session waits for you, and its cache ends within 30 minutes: `work/web waits for you, and its cache ends at 12:20. Answer before then, or /compact first.`
2. A session waits for you with 150,000 tokens of context or more: `work/big waits with 400k of context: a good moment to /compact.`
3. Otherwise there is no line "Next".

**The line "Waste today"** counts today's cold starts: calls that wrote 100,000 tokens or more to the cache again because the cache had ended. A break that is longer than the cache lasts causes one. The share is of all tokens today.

- Colours are those of the status line: working is green, waits for you is yellow, idle is dim, and the cache and the limits have the colours of the status line. No colours with `NO_COLOR`, or when the output is not a terminal.
- For the agents and the task, and for the context of Codex and Cowork, the view reads the last 256 KB of a log at most. Of a Codex log it also reads the first line, which names the session.
- Nothing in the view makes a model call.

**The names of tasks stay on your screen.** The TASK column shows text of a session: the name of a task. It is shown in `widal top` in your terminal, and it is never written to a file. A computer linked to a Widal.Code board sends the tasks of its open sessions to the board while names are on (see "The Widal.Code board"). Set `"hud": { "names": false }` in `~/.widal/config.json` to leave the column out. `widal top --once --no-names` leaves it out for one view: the plugin's skill runs the view that way, because what it runs goes to the model. The desktop extension never shows it.

**Today's numbers.** `widal refresh-today` works out today's numbers from the logs of all three agents, and writes them to `~/.widal/today.json`: the tokens of each session, of each ticket and of each account, and the cold starts. The file holds only numbers, session ids, ticket names, folder names and the keys of accounts. The same run brings `~/.widal/accounts.json` up to date (see "More than one account").

- The status line starts it in the background when the numbers are older than 5 minutes, and never waits for it. It does so only when it shows the line `plan`, where today's tokens stand. With `widal hud one`, or without that line, `widal top` and the desktop extension work the numbers out when they need them. It prints nothing.
- `widal top` runs it once at its start when the numbers are missing or older than 5 minutes, and says "reading the logs" while it works.
- It reads the logs through Widal.Code's cache, so a run after the first one is quick. On the Mac it was built on it took 1.5 seconds the first time and 0.1 seconds after that. On made-up logs of 126,000 calls today, it took 1.2 seconds the first time and 0.4 seconds after that.
- One run works at a time. A run that finds another one at work ends at once. A run that has held the lock for 10 minutes counts as dead, and the next run takes over.

**Spend per ticket.** `widal tickets` shows, per ticket, the tokens, the cost at list prices and the number of sessions of the last 7 days, most tokens first. `widal tickets --days 30` looks further back. A call counts to the ticket in the name of the git branch that its log names. One line at the end counts the calls without a ticket.

```
Spend per ticket, last 7 days, list prices. A call counts to the ticket in the name of the git branch that its log names.

  ticket   tokens   cost  sessions
  ABC-322    981k  $5.32  2 sessions
  ABC-7      110k  $0.23  1 session

Without a ticket: 101k tokens, $0.21, 1 session.
```

A ticket is 2 to 6 letters, a dash and a number, standing alone in the branch name: `user/abc-322-login` gives ABC-322. Words such as `fix` or `release` are not ticket keys.

## More than one account

A person can use more than one account: a work and a personal Claude account, two organisations, Codex on a ChatGPT plan. Widal.Code keeps them apart: the spend of each, and the plan's limits of each.

`widal accounts` shows one row per account that was used in the last 7 days, the newest first:

```
Accounts, last 7 days, the newest first. Tokens, dollars and sessions are of the 7 days. Dollars are at list prices: spend for an account that pays by the token, API value for one on a subscription (what the same use would cost by the token).

  account                            tool         kind and plan              plan's limits               tokens today  dollars today  tokens  dollars  dollars are  sessions  last seen
  Acme                               Claude Code  subscription, team_tier_1  week 41%; 5h 33%                    4.1M          $1.96     13M   $61.20  API value           2  2026-11-14 10:20
    claude:1a2b3c4d (signed in now)
  api                                Claude Code  usage                                                             0          $0.00    2.1M   $12.50  spend               1  2026-11-13 16:05
  codex:plus                         Codex        subscription, plus                                             410k          $0.67    410k    $0.67  API value           1  2026-11-14 08:20
  Personal                           Claude Code  subscription, claude_max   week 12% (read 2 days ago)             0          $0.00    824k    $4.40  API value           1  2026-11-12 09:20
    claude:9f8e7d6c

Paid by the token: $12.50 (spend, at list prices)
On subscriptions: $66.27 of API value (what the same use would cost by the token)

Plans
  Acme (claude:1a2b3c4d): team_tier_1
    Limits now: week 41% used, 43% of the week gone; 5 hour limit 33% used, 60% of its time gone
    API value in 7 days: $61.20. Price not set: widal accounts price claude:1a2b3c4d <dollars>
  Personal (claude:9f8e7d6c): Claude Max, $100 a month (the plan's public price)
    Limits now: week 12% used (read 2 days ago), 57% of the week gone
    API value in 7 days: $4.40. The plan's price for 7 days: $23.33. That is 0.2 times the plan's price.
  codex:plus: ChatGPT Plus, $20 a month (the plan's public price)
    API value in 7 days: $0.67. The plan's price for 7 days: $4.67. That is 0.1 times the plan's price.

Give an account your own name with: widal accounts label <key> "<label>"
Set the price of an account's plan with: widal accounts price <key> <dollars a month>
```

- Each row has the account's name with its short key below it, the tool, how it pays and its plan, the plan's limits with the pace (in the words of the status line), the tokens and the dollars of today and of the period, what those dollars are (spend, API value, or list prices when Widal.Code does not know how the account pays), the sessions, and when it was last used. The account that is signed in now in Claude Code says so.
- Below the table: the dollars of the period apart by how they are paid, and the block "Plans" (see "How you pay decides what you see").
- With one account, the table has one row, and a line says that Widal.Code found one account.
- `widal accounts --days 30` looks further back. `widal accounts --json` gives the same as one JSON object. Each account in it has `dollars` (`"API value"`, `"spend"` or `"list prices"`) and `price` (`{ "monthly": 100, "source": "table" }`, with `"set"` for a price you set, or `null`).
- `widal summary` has a part "By account" when more than one account was used in the period.
- In the Claude desktop app, ask "Which of my accounts used the most this week?" (see [docs/desktop.md](docs/desktop.md)).

**How Widal.Code tells the accounts apart.**

- **Claude Code:** each session's log names its account, with the ids of the account and of its organisation. A call counts to that account, and an agent's calls count to the account of its session. When you sign in with another account in the middle of a session, the session's log keeps naming the account it started with (seen on Claude Code 2.1.325), so its later calls still count to that account. The plan's limits do follow the new account: Claude Code hands the status line the limits of the account signed in now, and Widal.Code keeps them for that account.
- Logs of older versions of Claude Code do not name the account (on the Mac this was checked on: 2.1.314 and before). Their calls count to `unknown`. Calls through Amazon Bedrock or Vertex AI count to `cloud`: those providers give the answers ids of their own. A log does not show that a session used an API key, so such a session counts to `unknown` in the reports. Its status line calls it `api`.
- **Cowork:** the desktop app keeps the logs of each account in a folder of its own, and the folder is the account. When the folder has the id of a Claude account, the Cowork account takes that account's name.
- **Codex:** its log names no account. Some of its lines name the plan, such as `free` or `plus`, and the calls count to that plan, else to `codex:unknown`. Widal.Code never reads Codex's sign-in file.

**Names and labels.**

- An account shows with your own label, else with the name of its organisation, else with its short key: the tool and the first 8 characters of its id, such as `claude:1a2b3c4d`.
- Widal.Code learns the name of the account that is signed in now from Claude Code's file `~/.claude.json`, or `.claude.json` in another config folder. `widal refresh-today`, `widal accounts` and `widal doctor` read it. The status line never does, because the file can be large. An account that is not signed in now keeps the name from the last time it was.
- `widal accounts price claude:1a2b3c4d 100` sets the price of the account's plan a month, and `--clear` takes it away (see "How you pay decides what you see").
- `widal accounts label claude:1a2b3c4d "Work"` gives an account your own name, up to 60 characters. The start of the id is enough: `widal accounts label 1a2b3c4d "Work"`. `widal accounts label 1a2b3c4d --clear` takes the label away. A key that fits no account, or more than one, gives one sentence that lists the accounts.
- What Widal.Code keeps about each account is in `~/.widal/accounts.json`: the organisation's name and id, the billing type, the seat tier and the type of the organisation, when the account was first and last used, your label, the size of a Max plan (`5x` or `20x`, from the rate limit tier), and the price of the plan when you set one.

**The plan's limits of each account.**

- Each account has limits of its own. `~/.widal/limits.json` keeps one reading per account, and a session shows the reading of its own account only. So after a change of account, a session no longer shows the week of the account before.
- The status line finds the account of its session once: it reads the first 8 KB of the session's log, and keeps the account in the session's file in `~/.widal/sessions/`. Until the log is there, the session counts to the account that is signed in now.
- The rules of "Every session shows the newest reading of the limits" and "After a change of account" hold per account. So does the rule that limits seen in the last 24 hours mean a subscription. A reading from before this change, one for the whole computer, counts as the reading of `unknown`.
- `widal doctor` lists the last reading of each account. `widal top` shows the limits of the account that is signed in now.
- When more than one account was used in the last 7 days, line `plan` of the status line starts with the name of the session's account. With one account, it stays as it was.

```
Widal, Inc. · week ████░░░░░░ 41% │ 5h ███░░░░░░░ 33% │ today 41M tokens, 96% from the cache
```

**Other config folders.** Claude Code can run with another config folder, for example for a second account: `CLAUDE_CONFIG_DIR=~/.claude-work claude`. Its logs are then in `~/.claude-work/projects/`. Widal.Code reads the logs of all of these:

- the folder that `CLAUDE_CONFIG_DIR` names, when it is set,
- `~/.claude`,
- every folder in your home folder whose name starts with `.claude` and that has a folder `projects`,
- the folders in the setting `claudeDirs` in `~/.widal/config.json`, for example `"claudeDirs": ["~/work/claude-config"]`.

The same folder twice, also once through a link, is read once.

**Privacy.** `.claude.json` also holds your email address, your full name and your display name. Widal.Code never stores, prints or sends them. Claude can name a personal organisation after its person, for example with the email address: such a name of an organisation is not kept either, and the account then shows with its short key. The organisation's name, the ids and your labels are kept, and shown.

## Before a cache ends

A provider keeps the context of a session in its cache for a while after the last call: 5 minutes or 1 hour. A read from the cache is cheap. The first call after the end sends the whole context again, at the high price or against your plan's limits. In a long session that is hundreds of thousands of tokens.

Three things help. Each is off until you turn it on.

**A notification.** `widal nudge on` shows a notification of the operating system shortly before a session's cache ends: 5 minutes before, or 1 minute before for a cache that lasts 5 minutes. It comes only when the next call would send 100,000 tokens or more again, and once per end. It names the session's folder and the time. It says what the next call sends again in tokens on a subscription, and in dollars by the token. Send any message before that time and the cache stays. For a large session that Claude Code compacts on its own while it is idle, it says that instead (see "Compaction").

- `widal nudge on --before 5 --min 100000` sets the minutes and the tokens.
- `widal nudge` shows the settings. `widal nudge off` turns it off.
- It works on macOS, and on Linux with `notify-send`.
- It comes from the status line, so the status line needs its refresh timer.

**A warning at a cold start.** `widal apply cold-start-warn` adds a hook that runs when you send a prompt. When the session's cache has ended and its context is large, it says so once per ended cache. Large is 100,000 tokens or more, the same number as the `--min` of the notification.

```
widal: this session's cache ended at 14:05. This prompt sent 527k tokens again. Before a long break next time: /compact, or start a new session.
```

By the token it gives the dollars that the prompt cost more. It only shows a message. It never stops or changes a prompt. Claude Code hands the hook the prompt, and the hook uses only the id of the session. It works with what the status line saved, so the status line has to be installed. `widal undo cold-start-warn` takes it out.

**Keep-warm.** `widal apply keep-warm` adds a hook that runs after each answer and waits in the background. When nobody typed and the cache is 6 minutes from its end, the hook wakes the session with one short turn. The cache then lasts another hour. It stops after 3 hours without you. That is the cap. `widal apply keep-warm --cap-hours 2` sets another cap, up to 24 hours.

**Keep-warm spends your plan's limit while you are away** (money, when you pay by the token). Each wake reads the whole context from the cache. When you do not come back while the cache is kept, every wake was for nothing. It can cost more than it saves. It is an experiment.

- It leaves a session alone when its cache lasts 5 minutes, when its context is under 100,000 tokens, and while a limit of the plan is yellow or red on the status line. The limits are looked at when an answer ends, and again just before each wake, because another session can have used them in the hour between. It does not wake a session that was closed.
- It needs the status line with its refresh timer.
- The status line shows how much of the cap is used. When the cap is reached and the notification is on, the notification says so.
- While a wake is still to come before the end of a cache, the notification for that end waits. When the wake has not come one minute after its time, the notification comes after all.
- `widal measure keep-warm` shows what the wakes read and how often you came back while the cache was kept. From 10 idle periods on it says whether keep-warm saved more than it cost.
- `widal undo keep-warm` takes it out.

**Two more changes are about the cache.**

- `widal apply subagent-cache-1h` sets `"subagentPromptCacheTtl": "1h"`. Subagents then keep their cache for 1 hour instead of 5 minutes. A subagent that waits on a long command no longer pays to write its whole context again. Every cache write of a subagent costs the 1 hour price instead. The setting was checked live on 2026-11-12 with one small session that starts one subagent. Before the change the subagent wrote its 19,892 tokens to the 5 minute cache. After the change it wrote them to the 1 hour cache.
- `widal apply model-switch-cost` adds a hook that runs before a change of model. A change of model loses the cache. The hook shows what writing the context again costs, by Claude Code's own estimate. From $0.50 it asks first. Claude Code can only ask when you type `/model` with a name in a terminal session. For the model picker, and in a run without a person, the hook shows the cost and goes on. Under $0.05, and with the cache already gone, it says nothing. The amount from which it asks can be set as `modelSwitchAskFrom` in `~/.widal/config.json`.

## Compaction

A compaction replaces a long conversation with a summary. The context is small again after it, so every later call carries less. Claude Code compacts on its own when the context reaches the limit of the model: about 96.7% of the context window, which is 967,000 tokens in a window of 1,000,000. You can compact by hand at any time with `/compact`. Nothing outside Claude Code can start a compaction. So this tool does four other things: it shows the compactions that happened, it says what a summary has to keep, it can move the automatic point earlier, and it says when a compaction fits.

**What happened so far.** `widal compactions` reads the last 30 days of Claude Code's logs. Claude Code writes one line per compaction there, with the tokens before and after. The report shows:

- One table with a row for all compactions, one for the automatic ones and one for those by hand: how many, the tokens before and after (the median, then the smallest to the largest), by how much the context got smaller (the median percent), and how long a compaction took (the median seconds).
- One sentence that says how many of the automatic compactions came in the middle of work. That is one whose session had made a model call in the 5 minutes before.
- One sentence that says how many of the automatic compactions came 50 to 70 minutes after the last model call of their own conversation. That is how Claude Code's idle rule looks in a log: it compacts an idle session of about 200,000 tokens or more shortly before its 1 hour cache ends. The sentence is left out when there is none.
- The five sessions with the most compactions, each with its folder and its largest size before.

There is no percent to aim for. The size after a compaction is about the same each time, so the percent only says how large the context was allowed to get. On the one Mac that was checked, 57 compactions in 14 sessions went from a median of 366,000 tokens to a median of 31,000, and 53 of them were automatic.

**What a summary has to keep.** `widal apply compact-keep` adds a hook that runs before every compaction, automatic or by hand. Claude Code adds what the hook prints to the instructions for the summary. The hook prints one short text:

```
Keep what the person asked for and decided, the current plan with its open steps, the files that were changed, commands that have to be run again, and everything the person said not to do.
```

- `widal compact-keep` shows the text. `widal compact-keep "<text>"` sets your own, with 1 to 10,000 characters. `widal compact-keep --default` puts the default back.
- It is off until you apply it. `widal undo compact-keep` takes the hook out.
- The hook reads nothing of the session. When this tool's settings file is broken, the hook prints nothing, so that the default never stands in for your own text without a word. `widal compact-keep` then says what is wrong.

**An earlier automatic point.** `widal advise` has a proposal for it. It replays your logs and shows, for Claude Code's calls, what the part of each call's carried context above 200,000, above 300,000 and above 500,000 tokens cost. That is what an automatic compaction at that point would have saved, if the work had gone on the same with a smaller context. Nobody has measured that, and a summary loses detail. So the change is one to measure.

- `widal apply autocompact-window` sets `"autoCompactWindow": 300000` in Claude Code's settings. Claude Code then compacts a context on its own when it reaches 300,000 tokens. `widal apply autocompact-window --tokens 500000` sets another size: a whole number from 100000 to 1000000.
- `widal undo autocompact-window` puts back what was there.
- `widal measure autocompact-window` compares the 14 days before the change with the time after it, for the main sessions of Claude Code. It shows the compactions per session, the median size before a compaction and the cost of carrying context per 1,000 calls. Then it shows the same signs of how the work went as for the other changes: tool errors, rounds of fixing, interrupts by you and repeated tool calls.
- There is no standard for the point. 300,000 tokens is this tool's own choice.

**A hint at a good moment.** At a break in the work the status line can end with one of three hints. The first one that holds is shown.

| Hint | It shows when |
|---|---|
| `automatic compaction is near: /compact now to choose what stays` | The context is within 100,000 tokens of the point at which Claude Code compacts on its own. The point is `autoCompactWindow` from Claude Code's settings when that is set and not above the context window. Otherwise it is 96.7% of the window. This hint is yellow. |
| `a task just ended and the context is 420k: a good moment to /compact` | The end of the session's log shows a sign that a task ended, and the context has 150,000 tokens or more. |
| `context 420k: a good moment to /compact` | The context grew by 150,000 tokens since the last compaction, or since the status line first saw the session. |

- A break in the work is 60 seconds without a model call. In the middle of work there is no hint.
- A hint comes at most once in 30 minutes per session. It stays on the line while the session is idle, and it is gone after the next model call.
- You type `/compact`. Nothing changes on its own.
- Nobody tells the status line that a compaction happened. It sees one as a drop: the context is under half of what it was at the last run, and it was above 100,000 tokens then. From that size on it counts the growth.
- A sign that a task ended is one of two things, after the last compaction. The first is a shell command that starts with `git commit`, `git push`, `gh pr create` or `gh pr merge` and did not fail. The second is a task list whose newest call shows every task as completed (`TodoWrite`, or `TaskCreate` and `TaskUpdate` together). A sign counts once: the same commit gets no second hint.
- For the sign the status line reads the last 256 KB of the session's log, at most once after each model call. When the hint about the effort level is due in the same run, both come from one read.
- The hints need the status line with its refresh timer. A run right after an answer never sees a break.
- `widal hint off` turns these hints off together with the hint about the effort level, and `widal hint on` turns both on. `widal hint` and `widal doctor` show the settings. The two numbers are `growth` and `near` under `compactHint` in `~/.widal/config.json`.

**The privacy rule for the shell command.** The tool may look at the start of a shell command in the log, only to see whether it is one of the four commands above. It compares the first words and keeps only "a task ended at this time". It never keeps, prints or stores the command or any other text. Of a task list it reads the status of each task, and nothing of what a task says.

**The notification before a cache ends.** Claude Code compacts an idle session of about 200,000 tokens or more on its own before its 1 hour cache ends. Its setting `"idleCompaction": false` turns that off. For such a session the notification of `widal nudge on` says:

```
Soon Claude Code compacts this idle session on its own (527k tokens). To keep the full context, send a message before 15:02. To choose what stays, run /compact with your own words now.
```

It says that when the cache lasts 1 hour, 200,000 tokens or more are to send again, and `idleCompaction` is not `false` in `~/.claude/settings.json`. In every other case the notification is as "Before a cache ends" describes it.

## Model and effort

**What you spend on which model.** `widal models` shows the spend of the last 30 days three ways: by model and effort level, by kind of work, and by kind of subagent. The kind of work of a call comes from the tools it used: changing files, running commands, handing work to a subagent, reading and searching, other tools, or thinking and answering. Its last line counts simple work on a strong model at high effort: calls that read, searched or ran commands at effort high or above, on a model whose output costs more than Claude Sonnet 5.5's.

**Proposals.** `widal advise` replays the last 30 days of logs. A replay prices the same model calls again with one thing changed: another cache lifetime, another model, a smaller start. It keeps the tokens as they were. So it says what the same work would have cost, not whether the work would have gone the same way. Each proposal gives the evidence, how the change is made, what can go wrong, and the command when this tool can make the change. A proposal shows when it would have saved 1% of the total or more.

The proposals about model and effort:

| Proposal | It shows when | How the change is made |
|---|---|---|
| Run subagents on a cheaper model | Subagent calls ran on a model that costs more than Claude Sonnet 5.5 | `widal apply subagent-model` |
| Run one kind of subagent on a cheaper model | 60% or more of what that kind cost is reading and searching | `widal apply subagent-model --kind reviewer`, when "reviewer" is a subagent of your own |
| Start sessions at a lower effort | Calls read, searched or ran commands at effort high or above | `widal apply effort-default --level medium`, with the level that the proposal names |
| Start new sessions in one folder on a cheaper model | 80% or more of the folder's main sessions are short (20 calls or fewer), and they mostly read, search and think | By hand: `"model"` in that folder's `.claude/settings.json` |

The amount for a lower effort comes from your own calls: for the same model and the same kind of work, what a call wrote above the median of your calls at the next lower effort. Without 200 such calls of your own the proposal has no amount yet.

The other proposals are about the cache and the size of the context: the 1 hour cache for subagents, a rule for subagents that wait, an earlier automatic compaction (see "Compaction") and smaller subagent starts. The rule and the smaller starts are made by hand. Those two and the earlier compaction change how the work is done, so a replay cannot say that the result stays as good.

**The two changes.**

- `widal apply subagent-model` sets the model of all subagents to `claude-sonnet-5-5`. It sets `CLAUDE_CODE_SUBAGENT_MODEL` in the `env` of Claude Code's settings. `widal apply subagent-model --model claude-haiku-5-5` sets another model. With `--kind` and the name of one of your own subagents it changes only that one: it sets the line `model:` in the subagent's file in `~/.claude/agents/`. A kind that is built into Claude Code has no file, so it cannot be changed alone.
- `widal apply effort-default` sets `"effortLevel"` to `medium`. That is the effort that new sessions start with. `widal apply effort-default --level low` sets another level: `low`, `medium`, `high` or `xhigh`.

Both act on new sessions. `widal undo subagent-model` and `widal undo effort-default` put back what was there.

**The hint in the status line.** In a running session the line can end with one of two hints:

```
mostly simple work at high effort: /effort medium keeps the cache
many failed rounds at low effort: /effort medium keeps the cache
```

- The first shows at effort high or above, when 80% or more of the session's last 30 model calls are simple work (reading and searching, running commands, thinking and answering) and at most 2 rounds failed.
- The second shows at effort low or medium, from 5 failed rounds. A failed round is a call that came after a tool result with an error. This hint is yellow.
- Both need 20 calls or more to go by.
- You type the command. Nothing changes on its own.
- For the hint the status line reads the last 256 KB of the session's log, at most once every 5 minutes. It takes only the names of the tools and the error flags.
- There is no hint through a cloud provider and on an older model, because there a change of the effort level can lose the cache.
- The hint is on after the install. `widal hint` shows its settings, `widal hint off` turns it off, and `widal hint on` turns it on again. The same command turns the hint to compact off and on (see "Compaction").

**After a change.** `widal measure subagent-model` and `widal measure effort-default` compare the 14 days before the change with the time after it, for the calls that the change acts on. They show the cost per 1,000 calls and per session, the calls per session, tool errors, rounds of fixing, interrupts by you and repeated tool calls. They end with one sentence. It is "Too early to judge." until there are 500 calls in 20 sessions after the change. Then it is "Cheaper, and the work looks the same.", "Cheaper, but the work looks worse." or "No clear difference."

**What the research found.**

- **Switch a model only at a boundary:** the start of a session, a subagent, after a summary of the context, or when the cache is gone. A switch in a running session sends the whole context to the new model again. So the tool proposes a model only for subagents and for new sessions.
- **A change of the effort level keeps the cache** on the current models. So in a running session the effort level is the switch to use. That is what the hint is for.
- **Nothing switches on its own.** Vendors that lowered a model or an effort level without asking took that back after complaints. So the tool proposes, and you decide: every change is one command that you run, and one command takes it back.
- **The signs in `widal measure` are signs, not proof.** The work before and after a change is not the same work. Tool errors, rounds of fixing and interrupts are published measures of how work went. None is proven for a single switch.

## Too many agents at once

An agent can start many subagents at the same time. Each one is a separate process that uses CPU (the processors) and memory (RAM). Too many of them make the whole computer slow, and can make it run out of memory. The plugin's hook `load-gate` runs before each subagent and each workflow starts, and checks how busy the computer is:

- **The computer has room:** the subagent starts. You see nothing.
- **CPU or memory is at its limit:** the subagent waits in a queue. The hook measures again every 5 seconds. When there is room again, the subagent starts, and the agent is told how long it waited.
- **Still busy after the wait:** the subagent does not start. The agent is told why, and is told to wait for its running subagents or to do the work itself, and then to try again.

Subagents that an agent starts at the same time start one after another, at least 5 seconds apart. So each one measures the computer after the one before it has started, not all at once on a quiet computer. All sessions on the computer share this queue.

`widal load` shows how busy the computer is now, and the limits. The defaults are 90% CPU, 90% memory, a wait of up to 120 seconds and 5 seconds between two starts. Change them with, for example, `widal load --cpu 80 --memory 85 --wait 60 --spacing 10`. The wait can be at most 140 seconds, because Claude Code ends the hook after 150 seconds. `widal load off` turns the check off, and `widal load on` turns it on again.

On a Mac, memory that holds files and can be freed at once counts as free (the free, inactive, speculative and purgeable pages that `vm_stat` shows). Without that, a Mac looks almost full most of the time. CPU is the share of processor time that was busy over one second.

What it does not do yet:

- It counts only subagents and workflows. A heavy shell command, such as a build or a test run, starts without a check.
- It measures the whole computer, not the agents. A busy browser or a build that a person started also makes subagents wait.
- It has been tested with made-up measurements and on one Mac, not yet in a live session with many subagents.

## A limit in dollars

`widal limit --session 50 --day 200 --action ask` sets a limit per session and a limit per day, in dollars at list prices. At a limit Claude Code asks you before the next tool call (`ask`), shows a warning (`warn`) or stops the agent (`stop`). It asks or warns once, and again each time the spend has grown by a tenth of the limit. `widal limit --off` removes the limits.

The limit uses the cost figure that the status line saves, so the status line has to be installed.

## The reports

| Command | What it shows |
|---|---|
| `widal summary` | The dollars of the last 7 days by day, project and model, and what they paid for: spend by the token, API value on a subscription. The block "Plans" with each plan's price. With more than one account, also by account. |
| `widal session` | The latest session: its spend or API value, lost caches, what filled the context, the most expensive single pieces. Add the first characters of a session's id for another session. |
| `widal calls -n 30` | One line per model call of that session: context size, new tokens, share read from the cache, output, cost, what entered |
| `widal live` | The same lines for the Claude Code sessions that are running, as the calls happen. Stop it with Ctrl-C. |
| `widal findings` | Where the dollars went and what can be done, largest first, each with the command that fixes it (see below) |
| `widal branches` | Spend per project folder and git branch |
| `widal branch` | The branch that is checked out in this folder, with a line for the pull request. Run it in a git repository, or add the name of a branch. |
| `widal models` | Spend of the last 30 days by model, effort level and kind of work |
| `widal compactions` | The compactions of the last 30 days: how many, and the context before and after |
| `widal advise` | Changes that would have saved money, from a replay of the last 30 days, largest first |
| `widal measure subagent-cache-1h` | Before and after a change that was applied |
| `widal accounts` | The dollars, the plan's limits and the plan's price of each account in the last 7 days (see "More than one account"). `--json` gives the same as JSON. `widal accounts price <key> <dollars>` sets a plan's price. |
| `widal doctor` | What is installed, how you pay, the limits, the last reading of the plan's limits of each account, the changes that are applied, and how many logs were found |
| `widal help` | Every command |
| `widal` | The name Widal.Code with the version, and every command below it. |
| `widal --version` | The version of the tool |
| `widal hooks` | The hooks that the plugin carries: whether each one runs, and from where |
| `widal load` | How busy the computer's CPU and memory are, and the limits for starting a subagent |
| `widal check` | The open security findings, the most severe first (see "Security and compliance") |
| `widal board login https://code.widal.com` | Links this computer to your team's Widal.Code board. `widal board status`, `widal board sync` and `widal board logout` go with it (see "The Widal.Code board"). |

The reports take `--days` and a number of days, for example `widal findings --days 30`.

**What `widal findings` shows.** Each finding has its amount, the facts behind it, one item per line, and ends with the command that fixes it. Where `widal advise` has a replay for that change, the line gives the replay's saving for the same days. With made-up data:

```
Where the dollars went and what can be done, last 7 days. Total $412 at list prices.
On subscriptions: $412 of API value. That is what the same use would cost by the token. You pay your plan's price, not this.
The amounts overlap, so they do not add up. Not all of an amount can be saved.

1. Tool results in the context: $124, 30% of the total
   Bash: 8,878 results, 41M tokens, $70.10 with carrying. Largest single result 9.8k tokens.
     By program, the most tokens first:
       npm: 2,104 results, 15M tokens, $25.60
       git: 3,340 results, 9.1M tokens, $15.40
       pytest: 610 results, 7.0M tokens, $11.90
   Read: 1,816 results, 18M tokens, $31.20 with carrying. Largest single result 25k tokens.
   That is about 6.1% of your weekly limit (estimate from this week's use).
   A large result is paid for on every later call. Read parts of files, filter command output, and give large reads to a subagent that returns a summary.
   Fix: widal apply bash-output-cap (the replay of these 7 days: $21.40 less). Claude then gets at most 10,000 characters of a command's output inline, and a preview and a file for longer output.

2. The cache was lost 87 times: $37.10, 9% of the total
   Causes:
     idle for over 5 minutes: 61 times, $24.30
     the start of the prompt changed: 26 times, $12.80
   Largest:
     2026-11-12 14:02 work/shop-web $2.40 (310k tokens)
     2026-11-13 09:47 work/shop-web $1.90 (245k tokens)
   56 of them were in subagents, $19.80. A subagent's cache lasts 5 minutes, so a command or a wait that runs longer loses it.
   That is about 1.8% of your weekly limit (estimate from this week's use).
   Fix for the subagents: widal apply subagent-cache-1h (the replay of these 7 days: $14.20 less). It gives subagents a 1 hour cache.
   Fix for the main sessions: widal apply keep-warm, an experiment. It wakes an idle session with one short turn shortly before its cache ends, for up to 3 hours without you.

3. The same tool call, with the same input, many times: $8.30, 2% of the total
   Read ran 46 times with a repeated input (9 inputs, each 4 times or more) in work/shop-web, about $3.20. Likely cause: files read again after a compaction.
   ToolSearch ran 12 times with a repeated input (2 inputs, each 4 times or more) in work/shop-web, about $0.40. Likely cause: deferred tools loaded again after a compaction.
   Fix: widal apply compact-keep. At each compaction it tells the summary what to keep, such as the files that were changed. No replay can say how much that saves.
```

(Shortened: the real report also explains each cause, and has the findings about context above 200k tokens and about subagents, with `widal apply autocompact-window --tokens 200000` and `widal apply subagent-model`.)

- **The programs of shell commands.** The results of the shell tool are split by the program that each command ran: only the first word of the command, reduced to its base name (`/usr/bin/git` gives `git`), with letters, digits, dot, dash and underscore only, and at most 24 characters. A change of folder in front (`cd <folder> && npm test`, or `cd <folder>; npm test`) is skipped, and the next command's first word counts. Words in front that set a variable (`NODE_ENV=test npm test`) are skipped and never kept. When Widal.Code cannot be sure which word is the program, the command counts as `(other)`: a value in quotes or with a backslash, `$(` or a backquote before it (`PGPASSWORD='a b c' psql` gives `(other)`, never `b`), a word that looks like a key or a token, and a home folder such as `/Users/<name>`. Widal.Code keeps this name, and nothing else of the command, in its cache (see "Privacy"). It is not sent to a Widal.Code board.
- **Repeated tool calls** are one line per session and tool: how often the tool ran with an input that repeated 4 times or more, the folder, and an estimate of the cost: the tokens of the repeated results, entering and carried on the later calls, at each call's prices. The first result of each input is not counted. The likely cause is a compaction when the same input ran again after the session's context was compacted: files read again, or deferred tools loaded again.
- **A share of the weekly limit.** On a subscription with a reading of its week that is at least 5% used, the findings about lost caches, context and tool results say how much of a weekly limit their amount is. It is an estimate: Anthropic does not publish how the limit counts tokens. Widal.Code divides the API value of the account's calls from the start of the week to the time of the reading by the percent that the reading gives, and takes each dollar of API value to use the same share. The report ends with the dollars per 1% that it used. The percent also counts chat, the phone and other computers, which Widal.Code cannot see: when the plan was used there too, the share is too high.

## What works where

| Surface | Sees | Can act |
|---|---|---|
| Claude Code | Every call, the cache, the plan's limits | Status line, the pane, nudges, limits, proposals |
| Codex | Every call | Reports only |
| Cowork on the desktop | Every call of sessions that ran on this computer | Reports. With the plugin also its commands, its skill and its hooks: the text to keep at a compaction, and the warnings at a cold start and before a change of model. |
| Cowork in Anthropic's cloud | Nothing | Nothing |
| Chat on the web and phone | Nothing of its own. Its use is inside the percent of the plan's limits, because chat, Cowork and Claude Code draw from one pool. | Nothing |

**Why the tool does not read chat's usage from the web app.** The web app has its own usage figures, and other tools read them with the browser's sign-in cookie. Anthropic's consumer terms forbid automated access that way. It also means keeping a sign-in secret on the machine. So this tool does not do it.

**What an organisation can do instead.** Team and Enterprise admins can export Cowork's tokens and cost per person. Enterprise with usage-based billing has an analytics API per person and product.

## Every change the tool can make to Claude Code's settings

Claude Code's settings are in `~/.claude/settings.json`. The tool changes that file only when you run one of these commands.

| Command | What it changes | How to undo it |
|---|---|---|
| `widal connect` | Sets `statusLine` to this tool's command, `~/.widal/bin/widal statusline`, with `refreshInterval` 30. With `--refresh` and a number it sets other seconds. Another tool's status line is kept unless you add `--force`. Adds the three hooks of the security checks: `hooks.SessionStart`, `hooks.Stop` and `hooks.PreToolUse` with the matcher `Bash`. | `widal disconnect` |
| `widal migrate` | For an install made under one of the tool's old names, or one whose entries call a link on the PATH. Changes the command of the status line and of this tool's hooks to `~/.widal/bin/widal`. The first command you type runs the same move on its own. See "Coming from Kestrel". | No command. The copy of the file is in `~/.widal/backup/`. |
| `widal limit --session 50 --day 200 --action ask` | Adds one hook before tool calls (`hooks.PreToolUse`). The limit itself is kept in this tool's own settings. | `widal limit --off` |
| `widal apply subagent-cache-1h` | Sets `"subagentPromptCacheTtl": "1h"` | `widal undo subagent-cache-1h` |
| `widal apply model-switch-cost` | Adds one hook before a change of model (`hooks.PreModelSwitch`) | `widal undo model-switch-cost` |
| `widal apply cold-start-warn` | Adds one hook for a sent prompt (`hooks.UserPromptSubmit`) | `widal undo cold-start-warn` |
| `widal apply subagent-model` | Sets `CLAUDE_CODE_SUBAGENT_MODEL` in `env` | `widal undo subagent-model` |
| `widal apply subagent-model --kind reviewer` | Sets the line `model:` in `~/.claude/agents/reviewer.md`. This is the one change outside the settings file. It needs that file to be there. | `widal undo subagent-model` |
| `widal apply effort-default` | Sets `"effortLevel"` | `widal undo effort-default` |
| `widal apply keep-warm` | Adds one hook after each answer (`hooks.Stop`). The hook may wait in the background for up to 1 hour. It also turns keep-warm on in this tool's own settings. | `widal undo keep-warm` |
| `widal apply compact-keep` | Adds one hook before a compaction (`hooks.PreCompact`). The text that the hook prints is kept in this tool's own settings. | `widal undo compact-keep` |
| `widal apply autocompact-window` | Sets `"autoCompactWindow"` to 300000. With `--tokens` and a number it sets another size. | `widal undo autocompact-window` |
| `widal apply bash-output-cap` | Sets `"bashOutputMaxChars"` to 10000: how many characters of a successful shell command's output Claude gets inline (about 30,000 without it). Longer output goes to a file, and Claude gets a preview of 2,000 characters and the file's path. With `--chars` and a number (4000 to 128000) it sets another size. It needs Claude Code 2.1.261 or later. When it replaces a value of yours it says so, and undo puts that value back. While it is set, Claude Code ignores `BASH_MAX_OUTPUT_LENGTH`, and the command says so when that variable is set. | `widal undo bash-output-cap` |
| `widal apply no-bypass` | Sets `permissions.disableBypassPermissionsMode` to `"disable"`, and takes out `skipDangerousModePermissionPrompt` | `widal undo no-bypass` |
| `widal apply deny-secret-files` | Adds five deny rules to `permissions.deny`: `Read(./.env)`, `Read(./.env.*)`, `Read(**/*.pem)`, `Read(**/id_rsa*)`, `Read(**/.aws/credentials)`. The other rules stay. | `widal undo deny-secret-files` takes out only the rules it added |
| `widal apply tools-unused --tools Workflow,ListAgents` | Adds the named built-in tools to `permissions.deny`, so that new sessions start without their definitions. It takes only tools that a session can do without: Task, Workflow, ScheduleWakeup, ReportFindings, ListAgents, WebFetch, SendMessage and WebSearch. `widal advise` names the ones no session called. The other rules stay. | `widal undo tools-unused` takes out only the tools it added |
| `widal apply transcript-days` | Sets `"cleanupPeriodDays"` and `"desktopSessionCleanupPeriodDays"` to 7. With `--days` and a number (1 to 365) it sets other days. | `widal undo transcript-days` |

- **Backups.** Before each change the file is copied as it was to `~/.widal/backup/`, with the time in its name. The tool never deletes these copies.
- **Undo.** What a change found before it is kept in `~/.widal/actions.json`. `undo` puts back that value, and leaves the rest of the file as it is now. It puts the value back only while the setting still holds what the change set. A value that you changed by hand after the change stays, and `undo` says so. `widal apply` without a name lists the changes.
- **Other tools' settings stay.** Hooks of other tools stay, also in a group that they share with a hook of this tool. Two hooks of this tool can share an event (keep-warm and the security check both run when a turn ends): a change of one keeps the other.
- **A file is replaced as a whole.** The new text is written to a new file, which then takes the place of the old one. A crash in the middle leaves the old file. A settings file that is not a JSON object, or whose `env` or `hooks` is not in the shape Claude Code writes, is not changed: the command fails and says why.
- **One thing is left behind.** After the last hook is taken out, an empty `"hooks": {}` can stay in the file. It does nothing.
- **The command in the settings.** Every hook that a command adds calls `~/.widal/bin/widal`, a link in the tool's own folder. No other program can be there. A command that adds a hook makes the link when it is missing.
- **Uninstall.** `widal disconnect` takes out the status line, every hook of this tool, the links `~/.widal/bin/widal` and `~/.widal/bin/kestrel`, and the links to the command on the PATH, also the links under the tool's old names. After a setup from the plugin it also removes the copy in `~/.widal/app/`. A link on the PATH that belongs to another program stays. The plugin itself stays installed: take it out with `/plugin uninstall widal@widal`. A setting that a change set stays: the cache of subagents, the model of subagents, the starting effort, the size for the automatic compaction and the cap on shell output. Take those back first, with `undo`.

`widal plan`, `widal nudge`, `widal hint`, `widal compact-keep`, `widal hooks` and `widal settings` change nothing in Claude Code. Their settings are in `~/.widal/config.json`. `widal settings set` with `--project` writes the frameworks into the repository you name (see "Settings"). The plugin's hooks change nothing in Claude Code's settings either: Claude Code reads them from the plugin. Everything else the tool writes is in `~/.widal/` too: one small file per session, the newest reading of the limits of each account, the names and labels of the accounts, the parsed logs, the record of keep-warm, the security findings (`findings.json`), the times the checks last started (`checks/`), the backups, and on a computer linked to a Widal.Code board the link with its token (`board.json`, mode 600), the time of the last background start (`board.start`) and the lock of a running sync (`board.lock`). The check before a subagent starts keeps the time of the last start (`load-gate.json`) and the lock of its queue (`load-gate.lock`).

## How the numbers are made

**What a provider bills.** Each model call is billed in four kinds of tokens: input that is not in the provider's cache, input written to the cache, input read from the cache, and output (which includes thinking). The agent's log holds the exact count of each kind for each call. This tool multiplies them by the list prices in `src/prices.mjs`.

**Why carrying matters.** An agent sends its whole context on every call. So a tool result is paid for when it enters, and again on every later call, until the context is summarized or the result is cleared. This tool follows each piece through the calls and gives it two costs: entering and carrying.

**Lost cache.** A provider keeps the context in its cache for 5 minutes or 1 hour. After a longer gap, or after a change of model, the whole context is written again at the high price. The tool finds those calls and says what the rewrite cost.

**What is exact and what is an estimate.**

- Exact: the tokens and the cost of each call, and the split between carrying, new context and output.
- Estimate: how the new tokens of one call are split between the pieces that entered at that call. It is done by their size in characters.
- Estimate: all dollar figures are list prices. By the token they are what you pay (spend). On a subscription they are API value: what the same use would cost by the token, not what you pay.
- Estimate: the share of a weekly limit in `widal findings`. Anthropic does not publish how the limit counts tokens. Widal.Code takes each dollar of API value to use the same share of it.
- Estimate: the replay of a cap on shell output keeps the preview's share of each result over the cap. It does not count the reads of the file that Claude may make for the rest, so its saving is the most it can be.
- Estimate: in a Cowork log the output of a turn is exact, and its split between the calls of the turn is not. In a check against 5,714 calls the split was off by 19% of the output on average.
- Assumption: two prices. Fast mode is taken to double the cache prices too. The price of a cache read above 100,000 prompt tokens on Claude Haiku 5.5 is taken from the same ratio as its other prices.

**Checked against Claude Code.** The price table gives exactly the cost that Claude Code itself saved for the same token counts ($82.5528 for one model in a real session). That is a test.

## What is not tested or not built

Not tested:

- **The tool has run on one machine only,** a Mac. One machine is not evidence.
- **The limit was tested live on 2026-11-12,** in small sessions without a person (print mode), next to another hook that approves every tool call, and in the mode that skips permission prompts:
  - `warn`: Claude Code showed the notice, and the tool call ran.
  - `ask`: the tool call was refused with the tool's message, because nobody could answer. In a session with a person, Claude Code asks. That prompt itself was not tested.
  - `stop`: the tool call was refused and the agent's turn ended.
- **The hook before a change of model was seen live in a run without a person,** on 2026-11-12: Claude Code called it and showed its message. The question that a person gets in a terminal session was not seen.
- **The newer parts were tested with made-up input only:** the colours, the pace of a limit, the shared reading of the limits, the notification, the warning at a cold start and the hint. The made-up input has the field names of a real session's input, captured on 2026-11-13.
- **Keep-warm has not run in a live session.** Claude Code's documentation says that a hook of this kind wakes an idle session when it ends with exit code 2. How long such a hook may wait is not documented. The tool gives it a time limit of 1 hour.
- **The model of subagents and the starting effort were not checked live.** The tool sets them as Claude Code's documentation names them: `CLAUDE_CODE_SUBAGENT_MODEL`, `model:` in a subagent's file, and `effortLevel`. No live session has shown that Claude Code then uses them. Of the settings, only the 1 hour cache for subagents was checked live.
- **The Cowork folder is confirmed on macOS only.** For Windows and Linux the tool looks in the desktop app's data folder on those systems. Nobody has checked that. The layout of the Cowork log was read from the logs on one Mac on 2026-11-13.
- **The move from the tool's old name was tested with made-up home folders only.** `widal migrate` has not run on a machine with a real install yet.
- **The cloud checks ran once against a real AWS account, Vercel project and GitHub organization,** on 14 and 15 Nov 2026. Prowler has not run, and the Vercel checks that need a `VERCEL_TOKEN` were skipped. The other cases were tested with stand-ins: small programs that print the shapes from each provider's documentation (read on 14 Nov 2026).
- **The pane has not run in a live session.** It was tested with a stand-in for what Claude Code gives a mod, built from Anthropic's documentation of mods and the types of Claude Code 2.1.325. Three things follow the documentation and were not seen live: that a mod hears the plugin's own command files `/widal:open` and `/widal:settings` and can answer them, that `$.prompt.submit` sends the prompt of Hand to the agent, and how the pane looks in each app.
- **The plugin was installed from a local folder on one Mac on 15 Nov 2026.** `claude plugin validate .` passes on Claude Code 2.1.325. The commands, the skill, the hooks and the setup from a plugin's folder were tested with made-up folders only. Two things follow the documentation and were not seen live: that a command file runs its shell command as written, and that its `allowed-tools` line lets that command run without a question.
- **Cowork was not tried.** Whether Node is there when Cowork runs a plugin's hook is not known. Without Node the hooks print nothing.
- **The plugin's hooks run their command through `sh`.** On Windows without Git Bash, Claude Code runs a hook's command with PowerShell, and the command was not written for it.
- **The parts about compaction were tested with made-up input only.** The hook before a compaction has not run in a live session. The tool sets `autoCompactWindow` and reads `idleCompaction` as Claude Code's documentation names them (version 2.1.323). No live session has shown that Claude Code then compacts earlier, or that it compacts an idle session. The line that Claude Code writes for a compaction was read from the logs on one Mac. A line without all of its numbers is not counted.
- **A subscription is found as documented for Pro, Max and Ultra.** Whether Claude Code gives the plan's limits to Team and Enterprise seats is not documented. If the tool gets it wrong, set it with `widal plan subscription`.
- **It is not known whether Claude Code still gives the end of a cache once the cache is gone.** The tool keeps the last end it was given.
- **The accounts were checked on one Mac only, on 14 Nov 2026.** The line that names the account was in the logs of Claude Code 2.1.317 and later, and in no log of 2.1.314 and before. The ids that Amazon Bedrock and Vertex AI give an answer come from those providers' formats: no such log was on that Mac. A second config folder of Claude Code, and a Codex plan type other than `free` and `prolite`, were tested with made-up logs only.
- **Whether a write to the 1 hour cache counts more against a subscription's limits is not documented.**
- **Max and Ultra are told apart by the rate limit tier.** `claude_max` with a tier that ends in `max_5x` was in a real `.claude.json`. That Ultra has `max_20x` comes from the link on the pricing page, not from a real file. The name `claude_pro` follows the same pattern as `claude_team` and `claude_max`. If a plan shows without its price, set it with `widal accounts price`.
- **The cost of standing text is an estimate.** Claude Code's logs give the size of each instruction file, each plugin's skills in the list of skills and the text that hooks add, in characters. `widal advise` turns that into tokens at about 4 characters per token, and takes that share of the start of each session for `standing-text`. It measures what the text costs to carry, not whether it makes the answers longer or shorter.
- **The sizes of the tool definitions were measured on one version.** On 24 Nov 2026, with Claude Code 2.1.331 and no other settings, a session started with 19,450 tokens, and denying one tool took that tool's definition out of the start (for example 2,926 tokens for Task and 2,064 for Workflow). `widal advise` uses those sizes for the saving of `tools-unused`. Other versions can differ, so `widal measure tools-unused` shows the start of a session before and after.
- **The cap on shell output was not checked live.** `widal apply bash-output-cap` sets `bashOutputMaxChars` as Claude Code's documentation names it (settings reference and tools reference, read on 16 Nov 2026). No live session has shown that Claude Code then cuts the output.
- **The Widal.Code board link was tested with a stand-in board only,** a small web server in the tests that answers as the board's design says. It has not sent to a real board yet. The background start from the status line and the hooks was tested with made-up input.
- **The security checks were tested with made-up settings, logs and repositories only.** The gate's question before a push was seen in Claude Code on 14 Nov 2026, in a throwaway repository. The scanners Checkov, Trivy and KICS were tested with stand-ins that print the JSON of their documentation. gitleaks was run once on a made-up file in a temp folder, to see its JSON.

Not counted:

- **Claude Code's small helper calls are not in the session log** (for example the call that reads a web page). They were under 1% of the cost in the one session checked.
- **The calls that the Cowork app makes on the side are not in its log** (the same kind of helper calls). The app's own cost figure for a session counts them. The tool keeps that figure, and no report shows it yet.
- **Cowork has no thinking, no effort level, no git branch and no tool errors.** The log has only a running estimate of the thinking, which cannot be tied to one call, so the thinking of a Cowork call stays 0. The log does not name the effort or the branch. The reader does not count failed tool results or interrupts, so `widal measure` has none of those signs for Cowork.
- **The output of a Cowork call in a turn that was stopped is too low.** Such a turn has no totals in the log.
- **Codex has no rounds of fixing.** Its log does not say which command failed.
- **A model without a price shows tokens only.** Add its price in `~/.widal/prices.json`.
- **Spend per branch is a first step, not a cost per pull request.** The agent's log names the branch of the folder where the session started, and keeps that name when the session moves to another repository. So a call counts to a branch only when its folder is in a repository that has the branch (a local git check, no network). On this machine about half of a week's spend was not on a known branch: scratch folders, detached checkouts and branches that are gone. Nothing is checked against the code host.
- **No outcome yet.** The tool knows the ticket of a session from its git branch name (`widal tickets`), but not whether the work merged.

Not built:

- **The limit works in Claude Code only.** It uses the cost figure that the status line saves, so the status line has to be installed. The limit acts before the next tool call, so a model call that is already running still finishes. Codex has hooks too. A limit for Codex is not built.
- **An agent can change the limit before it is reached,** by running `widal limit` itself. Once the limit is reached, every tool call is held, also that one. A limit that an agent cannot change needs settings that only an administrator can write.
- **A session's file has no lock.** The status line and the hooks all write the small file of a session. Each reads the file again just before it writes, and sets only its own fields. Two of them that write in the very same moment can still lose one field. The gap is far shorter than one run, and no lock is built.
- **Only Claude Code's user settings are read** for the point of the automatic compaction and for the idle compaction. An `autoCompactWindow` or `idleCompaction` in a project's settings is not seen.
- **A session that waits for a long command counts as quiet.** The hint to compact goes by model calls. So it can show while a command runs for more than 60 seconds, in the middle of a task.
- **Single tasks are counted, not told apart.** Of `TaskCreate` and `TaskUpdate` only the status is read. A task from before the last 256 KB of the log is seen only once an update names its status.
- **Nothing acts in Codex, Cowork or chat.** See "What works where".
- **The security checks of actions and data read Claude Code's logs only.** Codex's settings are checked, but not what a Codex agent did.
- **The findings file has no lock.** Two checks that save at the very same moment can lose the findings of one run. The next run of that check finds them again.
- **A project's own settings files are checked for the folder a session starts in,** and for the top of its repository. A finding about another project's files stays open until a session there checks it again.
- **A Vercel check covers one project.** It is the project of the folder or of `--project`, not every project of a team.
- **No notification on Windows.**
- **The hint knows a fixed list of models** on which a change of the effort level keeps the cache. A newer model gets no hint until it is added in `src/hint.mjs`.
- **No comparison with other tools** that read the same logs.
- **The log formats are internal** to Claude Code, Codex and the Claude desktop app. A new version can change them.

## Privacy

- **Everything stays on the machine,** except what you ask for with `widal cloud-check`, and what a computer that you linked to a Widal.Code board sends to that board. The programs the tool starts are `git`, for local questions about branches, remotes and commits, the program that shows a notification (`osascript` on macOS, `notify-send` on Linux), the program that opens the browser at `widal board login` (`open` or `xdg-open`), and its own command: `widal settings` asks `widal accounts` for the accounts, the pane runs Widal.Code's commands, and the status line and the hooks start `widal refresh-today`, the security checks and the board's sync in the background.
- **Two parts of Widal.Code use the network, and only these two.** The cloud checks, only when you run them: `widal cloud-check` starts `aws`, `prowler`, `vercel` or `gh`, which talk to their providers with your sign-in. With `VERCEL_TOKEN` set, Widal.Code itself calls api.vercel.com with that token. What a cloud check saves holds no secret, no value of a variable and no text about a resource (see "Cloud checks"). And the Widal.Code board, only after you linked the computer with `widal board login`: Widal.Code then sends what it records to that board's address, on its own, and to no other address. It never sends the text of prompts, answers, tool results or files. See "The Widal.Code board" for the full list, and `widal board logout` to stop it. The outcome benchmark in `bench/` is not part of the tool that runs on your computer day to day. Its records go to that same board only when you run `node bench/export.mjs --send` yourself: numbers, the benchmark's own ids, model names and versions of runs on the benchmark's sample project, which Widal reads together with the records of all teams (see [bench/README.md](bench/README.md), "Keep and share the records").
- **From a log the tool takes counts, sizes, flags and names:** the tokens of each call, the length of each piece of text, the flags for an error and an interrupt, the names of tools and models, the folder and the git branch. The text of a prompt, an answer or a tool result is never kept, stored or printed. Of the input of a tool call only a short code is kept (8 characters of a hash), to find the same call again.
- **Of a shell command Widal.Code keeps the name of its program.** It is the first word of the command, reduced to its base name (`npm`, `git`, `pytest`), with letters, digits, dot, dash and underscore only, and at most 24 characters. A change of folder in front (`cd <folder> &&`) and words that set a variable are skipped, so neither the folder nor a value is kept. When a quote, a backslash, `$(` or a backquote comes before the program's word, the command counts as `(other)`, because a value in quotes can hold spaces. So does a word that looks like a key or a token (such as one that starts with `AKIA`, `ghp_` or `sk-`, or a long mix of capitals and digits), and a home folder such as `/Users/<name>` or `/home/<name>`. No argument and no other part of the command is kept. The name is in Widal.Code's cache of parsed logs (`~/.widal/cache/`), and `widal findings` prints it. It is not sent to a Widal.Code board.
- **One rule for the start of a shell command.** For the hint to compact, the tool may look at the start of a shell command in the log, only to see whether it is `git commit`, `git push`, `gh pr create` or `gh pr merge`. It compares the first words and keeps only "a task ended at this time". It never keeps, prints or stores the command or any other text. Of a task list it reads the status of each task, and nothing of what a task says.
- **A notification holds the short name of a folder, a time, and a number of tokens or dollars.**
- **The hooks use nothing of your prompt or of the model's answer.** Claude Code hands a hook more than it needs. The hooks take the id of the session. The hook before a change of model also takes the two model names, the size of the context and Claude Code's cost estimate. The hook before a compaction reads nothing of what it is handed.
- **The security checks keep no matched text.** A finding says which rule matched, where (a file and line, a path inside the repository, a session), when, and which controls it touches. It never holds a key, a number, a command or text of a session. See "Security and compliance".
- **No sign-in token and no cookie is read.** For an API key the tool only looks whether `ANTHROPIC_API_KEY` is set. It never keeps or prints the key. No credentials file is ever read: not `~/.aws/credentials`, not a sign-in file of Vercel or GitHub. Widal.Code uses two tokens: the one you put in `VERCEL_TOKEN` for a Vercel check, which it never writes anywhere, and the token of a Widal.Code board. That one is the only secret Widal.Code keeps: in `~/.widal/board.json` with mode 600, never printed in full, and sent only to the board that gave it.
- **Accounts: no email address and no person's name.** For the name of the account signed in now, the tool reads Claude Code's file `.claude.json`. That file also holds your email address, your full name and your display name. They are never stored, printed or sent, and neither is an organisation's name that holds one of them. The organisation's name, the ids and your own labels are kept in `~/.widal/accounts.json`. Codex's sign-in file is never read.
- **The plugin's skill tells Claude never to open, read or quote a session log.** Claude runs a report, and the report prints only numbers.
- **What the tool keeps is in `~/.widal/`.** `widal disconnect` leaves that folder where it is.

## Files

| File | What it does |
|---|---|
| `cli/widal.mjs` | The command. `cli/kestrel.mjs` and `cli/agent-spend.mjs` run it under the tool's old names. |
| `package.json` | The name of the package and the version. `widal --version` prints the version. |
| `src/app.mjs` | The folder of the tool's own files, the version, and the copy in `~/.widal/app/` after a setup from the plugin |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | The plugin's manifest, and the marketplace with this one plugin. The manifest carries the version of `package.json`. |
| `commands/`, `skills/widal/SKILL.md`, `hooks/hooks.json` | The plugin's ten commands, its skill and its four hooks. `hooks/hooks.json` also names the mod. |
| `hooks/pane.mjs` | The mod that draws the Widal.Code pane in Claude Code |
| `src/settings.mjs` | Every setting in one place, and `widal settings` |
| `src/security.mjs` | The security checks as a whole: their hooks, the gate before a push, and `widal check` |
| `src/controls.mjs`, `src/rules.mjs` | The catalog of controls per framework, and the rules of the checks |
| `src/check-settings.mjs`, `src/check-log.mjs`, `src/check-code.mjs` | The checks of the settings, of a session's log (actions and data), and of the changed code with the scanners |
| `src/findings.mjs`, `src/risk.mjs` | The store of findings, `~/.widal/findings.json`, and the part of the status line about them |
| `src/cloud.mjs` | `widal cloud-check`: runs a provider's tools with a time limit and saves the findings. `src/cloud-aws.mjs`, `src/cloud-vercel.mjs` and `src/cloud-github.mjs` are the checks of each provider. |
| `src/finding-words.mjs`, `src/findings-text.mjs` | The words for a finding (where it is, its controls, the prompt of Hand to the agent), and the open findings as text |
| `src/plugin.mjs` | The hooks that the plugin carries, and the rule that keeps a hook from acting twice |
| `src/board.mjs` | The Widal.Code board: `widal board login`, `status`, `sync` and `logout`, what a sync sends, and its start in the background |
| `assets/` | The Widal W mark as a drawing (`widal-code.svg`, the same as the board's) and in two sizes of PNG. The plugin's icon and the desktop extension's icon are `widal-code-512.png`. |
| `src/prices.mjs` | List prices and the cost of one call |
| `src/parse-claude.mjs`, `src/parse-codex.mjs`, `src/parse-cowork.mjs` | Read a session log into one record per model call |
| `src/store.mjs` | Finds the logs and keeps the parsed result in `~/.widal/cache/` |
| `src/paths.mjs` | Where the logs are, the config folders of Claude Code, and where this tool keeps its files |
| `src/analyze.mjs` | Assigns every dollar to what caused it, and names the kind of work of a call |
| `src/report.mjs` | The reports |
| `src/billing.mjs` | How you pay, and the newest reading of the plan's limits of each account |
| `src/accounts.mjs` | The accounts: their names from `.claude.json`, the labels, and `~/.widal/accounts.json` |
| `src/accounts-report.mjs` | `widal accounts`: the dollars and the limits of each account, as a table or as JSON |
| `src/plans.mjs` | How each account pays, the prices of plans, the words spend and API value, the block "Plans", and the share of a weekly limit |
| `src/program.mjs` | The name of the program that a shell command runs |
| `src/claude-code.mjs` | The status line and the hooks |
| `src/hud.mjs` | The status line in lines: the bars, the four lines, the tasks and agents from the end of a log, and `widal hud` |
| `src/top.mjs` | `widal top`: every agent session on this computer |
| `src/refresh-today.mjs` | Works out today's numbers in the background for the status line and `widal top` |
| `src/today-file.mjs` | The file of today's numbers, `~/.widal/today.json` |
| `src/ticket.mjs` | The ticket of a git branch name, and the branch of a folder |
| `src/mcp.mjs` | The desktop extension: the server that answers Claude in the Claude desktop app |
| `src/nudge.mjs` | The notification before a cache ends |
| `src/keep-warm.mjs` | The settings, the record and the measure of keep-warm |
| `src/hint.mjs` | The hint about the effort level, and the look at the end of a session's log |
| `src/compact.mjs` | The text that says what a summary has to keep, and the hint to compact |
| `src/advise.mjs` | The proposals from a replay, and the before and after of a change |
| `src/actions.mjs` | The changes the tool can make, each with a way back |
| `src/install.mjs` | Changes Claude Code's settings, with a backup |
| `src/links.mjs` | The link in the tool's own folder that the settings call, and the links on the PATH |
| `src/migrate.mjs` | Brings an install made under one of the tool's old names (Kestrel, agent-spend) to the name Widal.Code |
| `src/config.mjs` | This tool's own settings |
| `src/format.mjs` | How numbers, tables and colours are printed |
| `src/git.mjs` | Local git checks for the branch reports, and the top folder of a repository |
| `test/` | `node --test` |
| `bench/` | The outcome benchmark: real Claude Code sessions on 13 tasks with hidden checks, with and without Widal.Code. It costs money to run, so the tests only check its tasks. See [bench/README.md](bench/README.md) |

## Licence

Widal.Code is free and open source under the MIT licence. See [LICENSE](LICENSE).

Widal.Code is made by Widal, Inc. in San Francisco. The team board, which shows what a whole team's agents spend, is a paid service at [code.widal.com](https://code.widal.com). Widal.Code on your computer works without it. Questions: hello@widal.com.
