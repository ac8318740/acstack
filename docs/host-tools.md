# Host tools

ACStack runs on Claude Code, Codex, and pi. Skills name each capability once, in host-neutral words. This file maps those words to each host's tool.

- **Launch a subagent**: start a child agent with its own context, by its ACStack name (`investigator`, `reviewer`, `scope-worker`, `frontend-verifier`)
    - Claude Code: the Agent tool, with `subagent_type` set to that name
    - Codex: `spawn_agent` with that name. Codex delegates only when told to, so every ACStack instruction to launch an agent is that explicit request
    - pi: `Agent` from `@tintinweb/pi-subagents` (`subagent_type`), `subagent` from `pi-subagents` (`agent`), or `team_agent` from ac-teams
        - `team_agent` does not load ACStack agents by name, so put the role's instructions in the brief
        - ac-teams describes its member access controls in its own `docs/access.md`
    - **Read-only codebase-search subagent**: `Explore` on Claude Code and pi's `Agent`, or `scout` on pi's `subagent`
    - On a host without a matching built-in agent, launch a general subagent with that brief
- **Team mode**: parallel writers, each in its own checkout; Solo and Team modes in `orchestrator/AGENTS.md` gives each host's mechanism
- **Ask the user a structured question**: the host's question tool (AskUserQuestion on Claude Code)
    - On a host with no question tool, print the questions and options as a numbered list in chat, then stop and wait for the reply
    - Keep every rule a skill attaches to the question: batching, option order, the recommended answer, exact wording
- **Message a running agent**: the host's agent-messaging tool (`SendMessage` on Claude Code)
    - On a host with none, give the message to the user to relay
- **Invoke a skill**: `/acstack:<name>` names an ACStack skill throughout these files
    - Claude Code and pi run `/acstack:<name>` as written
    - ACStack's pi extension also takes `/acstack <name>`
    - On pi, never write `/skill:<name>`. ACStack's skills are not pi skills, so that command does not exist
    - Other hosts load the skill named `<name>` their own way
    - When you tell the user to run a skill, write the form their host takes
- **Project instructions**: `CLAUDE.md` on Claude Code, `AGENTS.md` on Codex, either on pi
    - Read whichever the project has wherever a skill says to check the project's instructions
- **The ACStack CLI**: always call it by its absolute path, `~/.claude/acstack/bin/acstack <subcommand>`
    - The SessionStart hook keeps this symlink pointed at the current plugin version
    - A bare `acstack` depends on the shell's PATH and breaks in subshells, fresh agent contexts, and CI
    - If the symlink is missing, the hook did not run. Tell the user to restart the session; if that fails, point them at `TROUBLESHOOTING.md` in the plugin root
