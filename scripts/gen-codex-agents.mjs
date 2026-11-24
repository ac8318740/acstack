#!/usr/bin/env node
// Generate Codex subagent definitions from the ACStack agent markdown.
//
// agents/<name>.md  ->  agents/codex/<name>.toml
//
// The markdown is the single source of truth. The TOML is generated and
// committed, and CI fails if it drifts (like pi/agents).
// Never hand-edit the TOML.
//
// Codex parses agent files with deny_unknown_fields: one unrecognised key and
// it discards the whole file with a log line nobody reads. So this emits only
// keys Codex actually applies, and refuses to guess at anything else.
//
//   name                    required
//   description             required, non-blank
//   developer_instructions  required - the markdown body
//
// Deliberately not emitted:
//   model  - ours says "opus", a Claude alias that means nothing to Codex.
//            Omitting it makes a subagent inherit the parent's model, which is
//            the behaviour we want anyway.
//   color  - no Codex equivalent.
//   sandbox_mode / mcp_servers - Codex parses then silently ignores both; a
//            child agent may never escalate past its parent. Emitting them
//            would imply a guarantee that does not exist.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommunicationStandard } from '../hooks/lib/communication-standard.mjs';
import { readAgents } from './read-agents.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'agents', 'codex');

/** Emit a TOML basic string. */
function tomlString(value) {
  return JSON.stringify(value);
}

/**
 * Emit a TOML multi-line basic string.
 *
 * Multi-line basic strings honour backslash escapes, so a literal backslash in
 * the body has to be doubled or TOML reads it as an escape. A run of three or
 * more quotes would also close the string early, so the third quote is escaped.
 */
function tomlMultiline(value) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
  return `"""\n${escaped}\n"""`;
}

const standard = readCommunicationStandard(root);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const written = [];
for (const { file, fields, body } of readAgents(root)) {
  const toml = [
    '# Generated from agents/' + file + ' by scripts/gen-codex-agents.mjs.',
    '# Do not edit. Change the markdown and re-run the generator.',
    '',
    `name = ${tomlString(fields.name)}`,
    `description = ${tomlString(fields.description)}`,
    '',
    `developer_instructions = ${tomlMultiline(`${body}\n\n${standard}`)}`,
    '',
  ].join('\n');

  const out = basename(file, '.md') + '.toml';
  writeFileSync(join(outDir, out), toml, 'utf-8');
  written.push(out);
}

console.log(`generated ${written.length} Codex agent definitions: ${written.join(', ')}`);
