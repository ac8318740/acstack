#!/usr/bin/env node
// Generate pi-subagents agent definitions from the SpecHub agent markdown.
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
//   inheritSkills          true - the agents read skills such as
//                          test-conventions
//   tools                  pi's builtin file and shell tools, listed so the
//                          set is fixed. A foreground child loads none of
//                          the parent's extensions, so an agent reaches the
//                          spechub CLI through bash, at its absolute path
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

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'agents');
const outDir = join(root, 'pi', 'agents');
const tools = 'read, grep, find, ls, bash, edit, write';

/**
 * Read YAML frontmatter as flat key/value pairs.
 *
 * Same hand-rolled reader as gen-codex-agents.mjs, for the same reason: this
 * script must run with no node_modules. It throws on anything it cannot read.
 */
function parseFrontmatter(text, file) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: no YAML frontmatter`);

  const fields = {};
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue;
    const sep = line.indexOf(':');
    if (sep === -1) throw new Error(`${file}: cannot parse frontmatter line: ${line}`);
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return { fields, body: match[2].trim() };
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const written = [];
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.md')).sort()) {
  const { fields, body } = parseFrontmatter(
    readFileSync(join(srcDir, file), 'utf-8'),
    file
  );

  for (const required of ['name', 'description']) {
    if (!fields[required]) throw new Error(`${file}: missing ${required}`);
  }
  if (!body) throw new Error(`${file}: empty body, nothing to instruct with`);

  const md = [
    '---',
    '# Generated from agents/' + file + ' by scripts/gen-pi-agents.mjs.',
    '# Do not edit. Change the markdown and re-run the generator.',
    `name: ${fields.name}`,
    `description: ${fields.description}`,
    'systemPromptMode: append',
    'inheritProjectContext: true',
    'inheritSkills: true',
    `tools: ${tools}`,
    '---',
    '',
    body,
    '',
  ].join('\n');

  writeFileSync(join(outDir, file), md, 'utf-8');
  written.push(file);
}

console.log(`generated ${written.length} pi agent definitions: ${written.join(', ')}`);
