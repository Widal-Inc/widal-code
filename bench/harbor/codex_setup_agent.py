"""OpenAI's Codex with one setup of the Widal.Code benchmark, as an agent for Harbor.

Harbor's own Codex agent installs Codex in the task's container and runs one session. This agent
reads a setup from the same file of setups as setup_agent.py and adds what a Codex session can take
from it, so that a Codex trial runs under the same rules as a Claude Code trial:

- "rootInstall" and "agentInstall": shell commands run once before the session. The benchmark's
  setups use them to block GitHub in the container (the task's repository is public there, and its
  fix with it) and to write a check that the block holds to /logs/agent/network-check.txt;
- "uploads": folders uploaded into the container;
- "env": variables for the session;
- "effort": Codex's reasoning effort.

Web search is off, as in the Claude Code setups, whose list of tools has no web tool.

A setup for Codex may not carry a field that only Claude Code reads ("settings", "allowedTools",
"appendSystemPrompt", "pluginDirs", "budget", "fastMode"): the run would then differ from what the
file of setups says. Codex has no limit on the spend of one session, so the stage's cap is the limit.

    harbor run -d <set> -m openai/gpt-6.2-sol \\
      -a bench.harbor.codex_setup_agent:CodexSetupAgent --ak setups=<file> --ak setup=openai-sol
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from harbor.agents.installed.codex import Codex, CodexOptions
from pydantic import Field

from bench.harbor.setup_agent import load_setup

CLAUDE_ONLY = ("settings", "allowedTools", "appendSystemPrompt", "pluginDirs", "budget", "fastMode")


def codex_setup(setups: str | Path, setup: str) -> dict[str, Any]:
    """The setup for a Codex session, checked: no field that only Claude Code reads."""
    spec = load_setup(setups, setup)
    extra = [key for key in CLAUDE_ONLY if key in spec]
    if extra:
        raise ValueError(f"The setup {setup!r} is run by Codex, which does not read {', '.join(extra)}.")
    return spec


def codex_options_of(spec: dict[str, Any]) -> dict[str, Any]:
    """The options of Harbor's Codex agent that a setup sets."""
    options: dict[str, Any] = {"web_search": "disabled"}
    if "effort" in spec:
        options["reasoning_effort"] = spec["effort"]
    return options


class CodexSetupAgentOptions(CodexOptions):
    """Harbor checks every agent option against this schema before it starts a trial."""

    setups: str | None = Field(default=None, description="The file of setups.")
    setup: str | None = Field(default=None, description="The id of the setup in that file.")


NVM_LINK = (
    'if [ -n "${XDG_CONFIG_HOME:-}" ] && [ ! -e "$HOME/.nvm" ]; then'
    ' mkdir -p "$XDG_CONFIG_HOME/nvm" && ln -s "$XDG_CONFIG_HOME/nvm" "$HOME/.nvm"; fi'
)

# Some task images (SWE-bench Pro) block GitHub in /etc/hosts when the container starts, so that the
# agent cannot fetch the task's fix. Harbor's Codex install fetches nvm from GitHub, so it fails there.
# The block is taken out for the install only and put back right after it, before the session starts
# (and the setup's own block of GitHub runs after that).
HOSTS_SAVED = "/var/tmp/.hosts-of-task"
GITHUB_UNBLOCK = (
    "if grep -qE '^0\\.0\\.0\\.0[[:space:]]+([a-z.]+\\.)?github(usercontent)?\\.com' /etc/hosts; then"
    f" cp /etc/hosts {HOSTS_SAVED} &&"
    f" grep -vE '^0\\.0\\.0\\.0[[:space:]]+([a-z.]+\\.)?github(usercontent)?\\.com' {HOSTS_SAVED} > /etc/hosts || true; fi"
)
GITHUB_REBLOCK = f"if [ -f {HOSTS_SAVED} ]; then cat {HOSTS_SAVED} > /etc/hosts && rm -f {HOSTS_SAVED}; fi"


class CodexSetupAgent(Codex):
    """Harbor's Codex agent with one setup of the benchmark on top."""

    options_model = CodexSetupAgentOptions

    def __init__(self, *args: Any, **kwargs: Any):
        setups, setup = kwargs.get("setups"), kwargs.get("setup")
        if not setups or not setup:
            raise ValueError("CodexSetupAgent needs --ak setups=<file of setups> and --ak setup=<id>.")
        self._spec = codex_setup(setups, setup)
        for key, value in codex_options_of(self._spec).items():
            kwargs.setdefault(key, value)
        super().__init__(*args, **kwargs)
        self._resolved_env_vars.update(self._spec.get("env", {}))

    async def install(self, environment) -> None:
        # Harbor's Codex install loads nvm from $HOME/.nvm, but nvm's installer puts it in
        # $XDG_CONFIG_HOME/nvm when that is set, as in some task images: the install then fails before
        # the agent starts. A link from $HOME/.nvm to that folder makes both agree.
        await self.exec_as_agent(environment, command=NVM_LINK)
        await self.exec_as_root(environment, command=GITHUB_UNBLOCK)
        try:
            await super().install(environment)
        finally:
            await self.exec_as_root(environment, command=GITHUB_REBLOCK)
        for item in self._spec.get("uploads", []):
            await environment.upload_dir(item["from"], item["to"])
        for command in self._spec.get("rootInstall", []):
            await self.exec_as_root(environment, command=command)
        for command in self._spec.get("agentInstall", []):
            await self.exec_as_agent(environment, command=command)
