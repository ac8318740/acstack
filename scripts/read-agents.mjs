// The agent markdown both generators read: agents/<name>.md, the single source
// of truth for agents/codex/*.toml and pi/agents/*.md.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read YAML frontmatter as flat key/value pairs.
 *
 * Hand-rolled rather than pulled from a library because the generators must
 * run with no node_modules, in CI and from a plugin checkout alike. It only has
 * to handle `key: scalar` lines, and it throws on anything else rather than
 * quietly returning a half-parsed object.
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

/**
 * Every agent under `<root>/agents`, sorted by file name, as
 * `{ file, fields, body }`. Throws when an agent lacks a name, a description,
 * or a body.
 */
export function readAgents(root) {
  const srcDir = join(root, 'agents');
  return readdirSync(srcDir).filter((f) => f.endsWith('.md')).sort().map((file) => {
    const { fields, body } = parseFrontmatter(readFileSync(join(srcDir, file), 'utf-8'), file);
    for (const required of ['name', 'description']) {
      if (!fields[required]) throw new Error(`${file}: missing ${required}`);
    }
    if (!body) throw new Error(`${file}: empty body, nothing to instruct with`);
    return { file, fields, body };
  });
}
