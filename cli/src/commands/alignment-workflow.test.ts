import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
let root: string;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('retired alignment command aliases', () => {
  it('does not keep align as a review command', () => {
    root = mkdtempSync(join(tmpdir(), 'acstack-alignment-workflow-'));
    const result = spawnSync(process.execPath, [bin, 'align', '--map', 'demo'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'align'");
  });

});
