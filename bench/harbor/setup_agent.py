"""Claude Code with one setup of the Widal.Code benchmark, as an agent for Harbor.

Harbor (github.com/harbor-framework/harbor) runs public task sets such as SWE-rebench, SWE-bench Pro
and Terminal-Bench in containers. Its own Claude Code agent installs Claude Code in the task's
container and runs one session with a settings file. This agent adds what a setup of the benchmark
needs on top of that:

- the setup's Claude Code settings (the model's effort level, environment variables, hooks);
- folders uploaded into the container, some of them loaded as Claude Code plugins;
- commands that run once in the container before the session, as root or as the agent's user;
- the list of tools the session may use. Harbor's default permission mode bypasses all permission
  checks; a setup runs with the mode "dontAsk" and its own list instead, as the benchmark's other
  sessions do.

A setup is one entry of a JSON file of setups:

    {"setups": [{"id": "baseline", "effort": "xhigh", "settings": {...}, "allowedTools": [...]}]}

and a run names it:

    harbor run -d <set> -m anthropic/claude-fable-5-2 \\
      -a bench.harbor.setup_agent:SetupAgent --ak setups=<file> --ak setup=baseline

Fields of a setup, all optional except "id":
- "settings": an object, Claude Code's settings for the session.
- "effort": the effort level (low, medium, high, xhigh or max).
- "allowedTools": a list of Claude Code tool rules, for example "Bash", "Read", "Edit".
- "appendSystemPrompt": text added to the system prompt.
- "env": variables for the session.
- "uploads": a list of {"from": <local folder>, "to": <folder in the container>}.
- "pluginDirs": folders in the container that Claude Code loads as plugins.
- "rootInstall" and "agentInstall": shell commands run once before the session.
- "budget": the most the session may spend, in dollars.
- "fastMode": true runs the session in fast mode (Claude Code's --fast-mode on), which the Claude API
  offers on Claude Opus 5.5 and Claude Fable 5.2 at twice the standard price.

"${setups}" in a text stands for the folder of the file of setups.

The agent also keeps API keys off the command line. Harbor passes the variables of a command to
`docker compose exec` as `-e NAME=value`, where the runner's process list shows them. The variables
that hold a key reach the container in a file instead (see KEYS_FILE).
"""

from __future__ import annotations

import json
import re
import shlex
import tempfile
from pathlib import Path
from typing import Any

from harbor.agents.installed.claude_code import ClaudeCode, ClaudeCodeOptions
from pydantic import Field

FIELDS = {
    "id",
    "name",
    "settings",
    "effort",
    "allowedTools",
    "appendSystemPrompt",
    "env",
    "uploads",
    "pluginDirs",
    "rootInstall",
    "agentInstall",
    "budget",
    "fastMode",
}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
DEFAULT_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Task", "TodoWrite"]


def load_setup(setups: str | Path, setup: str) -> dict[str, Any]:
    """The setup with the given id from a file of setups, checked, with "${setups}" filled in."""
    path = Path(setups)
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise ValueError(f"The file of setups {path} cannot be read as JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("setups"), list):
        raise ValueError(f"The file of setups {path} needs a list of \"setups\".")
    found = [s for s in data["setups"] if isinstance(s, dict) and s.get("id") == setup]
    if len(found) != 1:
        raise ValueError(f"The file of setups {path} has no single setup with the id {setup!r}.")
    spec = _fill(found[0], str(path.parent.resolve()))
    unknown = sorted(set(spec) - FIELDS)
    if unknown:
        raise ValueError(f"The setup {setup!r} has fields that are not known: {', '.join(unknown)}.")
    if "effort" in spec and spec["effort"] not in EFFORTS:
        raise ValueError(f"The setup {setup!r} needs an effort level of {', '.join(sorted(EFFORTS))}.")
    for key in ("allowedTools", "pluginDirs", "rootInstall", "agentInstall"):
        if key in spec and not (isinstance(spec[key], list) and all(isinstance(x, str) and x for x in spec[key])):
            raise ValueError(f"The setup {setup!r} needs a list of texts as {key!r}.")
    if "env" in spec and not (isinstance(spec["env"], dict) and all(isinstance(v, str) for v in spec["env"].values())):
        raise ValueError(f"The setup {setup!r} needs texts as the values of \"env\".")
    if "fastMode" in spec and not isinstance(spec["fastMode"], bool):
        raise ValueError(f"The setup {setup!r} needs true or false as \"fastMode\".")
    if "settings" in spec and not isinstance(spec["settings"], dict):
        raise ValueError(f"The setup {setup!r} needs an object as \"settings\".")
    for item in spec.get("uploads", []):
        if not (isinstance(item, dict) and Path(str(item.get("from", ""))).is_dir() and str(item.get("to", "")).startswith("/")):
            raise ValueError(f"The setup {setup!r} needs uploads of a local folder that is there to a folder in the container.")
    return spec


def _fill(value: Any, folder: str) -> Any:
    if isinstance(value, str):
        return value.replace("${setups}", folder)
    if isinstance(value, list):
        return [_fill(x, folder) for x in value]
    if isinstance(value, dict):
        return {k: _fill(v, folder) for k, v in value.items()}
    return value


def options_of(spec: dict[str, Any]) -> dict[str, Any]:
    """The options of Harbor's Claude Code agent that a setup sets."""
    options: dict[str, Any] = {
        "permission_mode": "dontAsk",
        "allowed_tools": ",".join(spec.get("allowedTools", DEFAULT_TOOLS)),
    }
    if "effort" in spec:
        options["reasoning_effort"] = spec["effort"]
    if "appendSystemPrompt" in spec:
        options["append_system_prompt"] = spec["appendSystemPrompt"]
    if "budget" in spec:
        options["max_budget_usd"] = str(spec["budget"])
    if "settings" in spec:
        options["config"] = spec["settings"]
    return options


# The /etc/hosts of the task, saved before the setup's own steps run. The setups block GitHub there (a
# rootInstall step) so that the session cannot fetch the upstream fix, and the file is put back when the session
# ends, so that Harbor's verifier, which runs next in the same container, sees the container as the task set it
# up, as in the oracle check. Some verifiers download their tools from GitHub (Terminal-Bench's tests/test.sh
# installs uv from it) and fail whatever the agent did while the block holds. Docker mounts /etc/hosts into the
# container, so the file is written in place: `sed -i` cannot replace it.
HOSTS_OF_TASK = "/var/tmp/.hosts-of-task"
SAVE_HOSTS = f"cp /etc/hosts {HOSTS_OF_TASK}"
RESTORE_HOSTS = f"if [ -f {HOSTS_OF_TASK} ]; then cat {HOSTS_OF_TASK} > /etc/hosts && rm -f {HOSTS_OF_TASK}; fi"


# Harbor passes the variables of a command to `docker compose exec` as `-e NAME=value`. While a session
# runs, which can be an hour, everyone who can list the runner's processes could read the API key there.
# So the variables that hold a key, found by their name, are written to a file in the container, and the
# command reads that file before it does anything else. The session gets the same variables as before.
# The file is uploaded with `docker compose cp`, which names the file and not what is in it. It lies
# outside /logs, which Harbor copies to the runner, and it is removed when the session ends.
KEY_NAME = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL", re.IGNORECASE)
KEYS_FILE = "/var/tmp/.keys-of-session"
READ_KEYS = f". {KEYS_FILE} || exit 1; "
REMOVE_KEYS = f"rm -f {KEYS_FILE}"


def split_keys(env: dict[str, str] | None) -> tuple[dict[str, str], dict[str, str]]:
    """A command's variables in two parts: those that hold a key, and the rest.

    A variable holds a key when its name says so and it has a value. A name that only looks like one
    (a limit of tokens, for example) goes into the file too, and reaches the command all the same.
    """
    env = env or {}
    keys = {name: value for name, value in env.items() if value and KEY_NAME.search(name)}
    return keys, {name: value for name, value in env.items() if name not in keys}


def keys_text(keys: dict[str, str]) -> str:
    """The file of keys: one export per key, quoted so that the shell takes the value as it is."""
    return "".join(f"export {name}={shlex.quote(value)}\n" for name, value in sorted(keys.items()))


class SetupAgentOptions(ClaudeCodeOptions):
    """Harbor checks every agent option against this schema before it starts a trial."""

    setups: str | None = Field(default=None, description="The file of setups.")
    setup: str | None = Field(default=None, description="The id of the setup in that file.")


class SetupAgent(ClaudeCode):
    """Harbor's Claude Code agent with one setup of the benchmark on top."""

    options_model = SetupAgentOptions

    def __init__(self, logs_dir: Path, *args: Any, **kwargs: Any):
        setups, setup = kwargs.get("setups"), kwargs.get("setup")
        if not setups or not setup:
            raise ValueError("SetupAgent needs --ak setups=<file of setups> and --ak setup=<id>.")
        self._spec = load_setup(setups, setup)
        for key, value in options_of(self._spec).items():
            kwargs.setdefault(key, value)
        super().__init__(logs_dir, *args, **kwargs)
        self._resolved_env_vars.update(self._spec.get("env", {}))
        self._keys_in_file: dict[str, str] | None = None

    async def install(self, environment) -> None:
        await super().install(environment)
        for item in self._spec.get("uploads", []):
            await environment.upload_dir(item["from"], item["to"])
        await self.exec_as_root(environment, command=SAVE_HOSTS)
        for command in self._spec.get("rootInstall", []):
            await self.exec_as_root(environment, command=command)
        for command in self._spec.get("agentInstall", []):
            await self.exec_as_agent(environment, command=command)

    async def run(self, instruction: str, environment, context) -> None:
        """Runs the session, then puts back the task's /etc/hosts (see HOSTS_OF_TASK), also when it fails or times out.

        The file of keys (see KEYS_FILE) is removed then too, so the verifier's container does not hold it.
        """
        try:
            await super().run(instruction=instruction, environment=environment, context=context)
        finally:
            try:
                await self.exec_as_root(environment, command=RESTORE_HOSTS, timeout_sec=60)
            except Exception as error:  # the verifier then runs with the block, as before
                print(f"Could not put back the task's /etc/hosts: {error}")
            self._keys_in_file = None
            try:
                await self.exec_as_root(environment, command=REMOVE_KEYS, timeout_sec=60)
            except Exception as error:  # the container is deleted after the verifier anyway
                print(f"Could not remove the file of keys: {error}")

    async def _keys_to_file(self, environment, command: str, env: dict[str, str] | None) -> tuple[str, dict[str, str] | None]:
        """Takes the keys out of a command's variables and makes the command read them from the file of keys.

        The file is uploaded once per session, and again only when the keys change. It belongs to the
        user that runs the agent's commands and only that user can read it. When Harbor names no user,
        the commands run as the image's own user, whom this agent cannot name, so the file is then
        readable inside the container, which holds one session that has the keys anyway.
        """
        keys, rest = split_keys(env)
        if not keys:
            return command, env
        if keys != self._keys_in_file:
            with tempfile.TemporaryDirectory(prefix="bench-keys-") as folder:
                local = Path(folder) / "keys"
                local.touch(mode=0o600)
                local.write_text(keys_text(keys))
                await environment.upload_file(local, KEYS_FILE)
            user = getattr(environment, "default_user", None)
            access = f"chmod 644 {KEYS_FILE}" if user is None else f"chown {shlex.quote(str(user))} {KEYS_FILE} && chmod 600 {KEYS_FILE}"
            await super().exec_as_root(environment, command=access)
            self._keys_in_file = keys
        return READ_KEYS + command, rest

    async def exec_as_agent(self, environment, command: str, env: dict[str, str] | None = None, cwd: str | None = None, timeout_sec: int | None = None) -> Any:
        """Harbor's command as the agent's user, with the keys in a file and not on the command line."""
        command, env = await self._keys_to_file(environment, command, env)
        return await super().exec_as_agent(environment, command, env=env, cwd=cwd, timeout_sec=timeout_sec)

    async def exec_as_root(self, environment, command: str, env: dict[str, str] | None = None, cwd: str | None = None, timeout_sec: int | None = None) -> Any:
        """Harbor's command as root, with the keys in a file and not on the command line."""
        command, env = await self._keys_to_file(environment, command, env)
        return await super().exec_as_root(environment, command, env=env, cwd=cwd, timeout_sec=timeout_sec)

    def build_cli_flags(self) -> str:
        flags = super().build_cli_flags()
        plugins = " ".join(f"--plugin-dir {shlex.quote(folder)}" for folder in self._spec.get("pluginDirs", []))
        fast = "--fast-mode on" if self._spec.get("fastMode") else ""
        return " ".join(part for part in (flags, plugins, fast) if part)
