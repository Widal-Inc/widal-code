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

"${setups}" in a text stands for the folder of the file of setups.
"""

from __future__ import annotations

import json
import shlex
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

    async def install(self, environment) -> None:
        await super().install(environment)
        for item in self._spec.get("uploads", []):
            await environment.upload_dir(item["from"], item["to"])
        for command in self._spec.get("rootInstall", []):
            await self.exec_as_root(environment, command=command)
        for command in self._spec.get("agentInstall", []):
            await self.exec_as_agent(environment, command=command)

    def build_cli_flags(self) -> str:
        flags = super().build_cli_flags()
        plugins = " ".join(f"--plugin-dir {shlex.quote(folder)}" for folder in self._spec.get("pluginDirs", []))
        return " ".join(part for part in (flags, plugins) if part)
