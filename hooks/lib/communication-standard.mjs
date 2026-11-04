import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read the only authored communication standard, refusing partial blocks. */
export function readCommunicationStandard(root) {
  const file = join(root, 'output-styles', 'ac-writing-style.md');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const starts = lines.flatMap((line, i) => line === '<!-- acstack:communication:start -->' ? [i] : []);
  const ends = lines.flatMap((line, i) => line === '<!-- acstack:communication:end -->' ? [i] : []);
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) {
    throw new Error(`${file}: expected one ordered communication marker pair`);
  }
  const standard = lines.slice(starts[0] + 1, ends[0]).join('\n').trim();
  if (!standard) throw new Error(`${file}: empty communication standard`);
  return standard;
}
