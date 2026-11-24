#!/usr/bin/env node
// Generate pi-subagents agent definitions from the ACStack agent markdown.
//
// agents/<name>.md  ->  pi/agents/<name>.md
//
// The markdown is the single source of truth. The output is generated and
// committed, and CI fails if it drifts - the same arrangement as agents/codex.
// Never hand-edit the output.
//
// pi-subagents (the pi package that runs subagents on pi) reads agent files
// from any installed pi package whose package.json lists them under
// pi.subagents.agents. The root package.json points that at ./pi/agents.
//
// The output lives under pi/, not agents/pi/. Claude Code loads every
// markdown file under a plugin's agents/ as a Claude agent, so a second copy
// there would register each agent twice.
//
// Emitted frontmatter:
//   name                   required
//   description            required, non-blank
//   systemPromptMode       append - keep pi's base prompt (tools, rules) and
//                          add the agent's own, the way a Claude Code
//                          subagent keeps its harness prompt
//   inheritProjectContext  true - the agents follow the repo's AGENTS.md
//   inheritSkills          true - the agents keep the user's own pi skills
//   skills, skillPath      the ACStack skills each agent reads, from SKILLS
//                          below. ACStack's skills are not pi skills (they
//                          would each show up as a /skill:<name> command), so
//                          an agent resolves its own from the skills/
//                          directory. skillPath is relative to the agent
//                          file, and pi-subagents never adds it to the
//                          parent's skill catalog. Agents absent from SKILLS
//                          get neither field
//   tools                  pi's builtin file and shell tools, listed so the
//                          set is fixed. A foreground child loads none of
//                          the parent's extensions, so an agent reaches the
//                          acstack CLI through bash, at its absolute path
//
// Deliberately not emitted:
//   model  - ours says "opus", a Claude alias. Omitting it lets the user's
//            pi-subagents defaults (subagents.defaultModel, agentOverrides)
//            pick the model.
//   color  - no pi-subagents equivalent.
//
// pi-subagents' frontmatter parser strips surrounding quotes but does not
// unescape, so values are written as plain single-line scalars. It skips
// lines that are not key: value, so the generated marker sits in the
// frontmatter as a YAML comment and never reaches the agent's prompt.

import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommunicationStandard } from '../hooks/lib/communication-standard.mjs';
import { readAgents } from './read-agents.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'pi', 'agents');
const tools = 'read, grep, find, ls, bash, edit, write';

// The ACStack skills each agent reads. browser-verify covers the agent-browser
// commands the frontend-verifier runs, and its prompt points at bridge.
const SKILLS = {
  'frontend-verifier': ['browser-verify', 'bridge'],
};

const standard = readCommunicationStandard(root);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const written = [];
for (const { file, fields, body } of readAgents(root)) {
  const md = [
    '---',
    '# Generated from agents/' + file + ' by scripts/gen-pi-agents.mjs.',
    '# Do not edit. Change the markdown and re-run the generator.',
    `name: ${fields.name}`,
    `description: ${fields.description}`,
    'systemPromptMode: append',
    'inheritProjectContext: true',
    'inheritSkills: true',
    ...(SKILLS[fields.name] ? [`skills: ${SKILLS[fields.name].join(', ')}`, 'skillPath: ../../skills'] : []),
    `tools: ${tools}`,
    '---',
    '',
    body,
    '',
    standard,
    '',
  ].join('\n');

  for (const skill of SKILLS[fields.name] ?? []) {
    if (!existsSync(join(root, 'skills', skill, 'SKILL.md'))) throw new Error(`${file}: no skill named ${skill}`);
  }
  writeFileSync(join(outDir, file), md, 'utf-8');
  written.push(file);
}

console.log(`generated ${written.length} pi agent definitions: ${written.join(', ')}`);
