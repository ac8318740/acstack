import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { findPluginRoot, findProjectRoot } from './project.js';

const fault = vi.hoisted(() => ({ destination: '' }));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (to === fault.destination) throw new Error('Injected rename failure');
      return actual.renameSync(from, to);
    },
  };
});
const { assertCanonicalProject, ensureProjectGitignore, migrateProjectData } = await import('./project-data.js');
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'project-data-unit-'));
  roots.push(root);
  return root;
}
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
afterEach(() => {
  fault.destination = '';
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('project data migration safety', () => {
  it('does not recognize or migrate an ordinary acstack source directory', () => {
    const root = fixture();
    put(root, 'acstack/app.ts', 'export const app = true;');
    expect(findProjectRoot(join(root, 'acstack'))).toBeNull();
    expect(() => assertCanonicalProject(root)).not.toThrow();
    expect(migrateProjectData(root)).toEqual({ moved: [] });
    expect(readFileSync(join(root, 'acstack/app.ts'), 'utf8')).toBe('export const app = true;');
    expect(existsSync(join(root, '.acstack'))).toBe(false);
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
  });

  it('moves independent root records without moving an ordinary acstack source directory', () => {
    const root = fixture();
    put(root, 'acstack/app.ts', 'source');
    put(root, 'CONTEXT.md', 'project context');
    migrateProjectData(root);
    expect(readFileSync(join(root, 'acstack/app.ts'), 'utf8')).toBe('source');
    expect(readFileSync(join(root, '.acstack/CONTEXT.md'), 'utf8')).toBe('project context');
    expect(existsSync(join(root, '.acstack/app.ts'))).toBe(false);
  });

  it('discovers the repository rather than its authored design example', () => {
    const root = findPluginRoot();
    expect(root).not.toBeNull();
    expect(findProjectRoot(join(root!, 'examples/design-doc/acstack'))).toBe(root);
  });

  it.each(['domain-map.yaml', 'alignment-packs/', 'design-reviews/', 'maps/', 'specs/', 'changes/', 'archive/', 'decision-logs/'])('recognizes config-free legacy metadata from %s', marker => {
    const root = fixture();
    if (marker.endsWith('/')) mkdirSync(join(root, 'acstack', marker), { recursive: true });
    else put(root, `acstack/${marker}`, 'domains: {}\n');
    expect(findProjectRoot(root)).toBe(root);
    expect(() => assertCanonicalProject(root)).toThrow(/project-data migrate/);
    migrateProjectData(root);
    expect(existsSync(join(root, '.acstack', marker))).toBe(true);
    expect(existsSync(join(root, 'acstack'))).toBe(false);
  });

  it.each(['project.yaml', 'maps'])('preserves a broken legacy %s link instead of overlooking its records', marker => {
    const root = fixture();
    mkdirSync(join(root, 'acstack'));
    const target = `../main/.acstack/${marker}`;
    symlinkSync(target, join(root, 'acstack', marker));
    put(root, 'acstack/note.md', 'keep this record');
    expect(findProjectRoot(root)).toBe(root);
    expect(() => assertCanonicalProject(root)).toThrow(/project-data migrate/);
    migrateProjectData(root);
    expect(readlinkSync(join(root, '.acstack', marker))).toBe(target);
    expect(readFileSync(join(root, '.acstack/note.md'), 'utf8')).toBe('keep this record');
    expect(existsSync(join(root, 'acstack'))).toBe(false);
  });

  it('finds the nearest legacy project before a farther hidden project', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    put(root, 'nested/acstack/project.yaml', 'name: nested\n');
    mkdirSync(join(root, 'nested/src'));
    expect(findProjectRoot(join(root, 'nested/src'))).toBe(join(root, 'nested'));
  });

  it.each(['decisions', 'decision-logs', 'verification'])('preflights incoming %s conflicts inside the legacy tree', directory => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'name: legacy\n');
    put(root, `acstack/${directory}/keep`, 'original');
    if (directory === 'decisions') put(root, 'docs/adr/incoming.md', 'incoming');
    if (directory === 'decision-logs') put(root, '.decisions/incoming.md', 'incoming');
    if (directory === 'verification') put(root, 'VERIFICATION-KNOWLEDGE.md', 'incoming');
    // verification can accept an absent file in its existing real directory.
    if (directory === 'verification') put(root, 'acstack/verification/VERIFICATION-KNOWLEDGE.md', 'existing knowledge');
    expect(() => migrateProjectData(root)).toThrow(/conflict/);
    expect(readFileSync(join(root, `acstack/${directory}/keep`), 'utf8')).toBe('original');
    expect(existsSync(join(root, '.acstack'))).toBe(false);
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
  });

  it('does not traverse a symlinked incoming destination parent', () => {
    const root = fixture();
    const outside = fixture();
    put(root, 'acstack/project.yaml', 'name: local\n');
    put(root, 'VERIFICATION-KNOWLEDGE.md', 'local knowledge');
    symlinkSync(outside, join(root, 'acstack/verification'));
    expect(() => migrateProjectData(root)).toThrow(/unsafe|conflict/);
    expect(existsSync(join(root, '.acstack'))).toBe(false);
    expect(existsSync(join(outside, 'VERIFICATION-KNOWLEDGE.md'))).toBe(false);
  });

  it('preserves relocated relative links without following external directory links', () => {
    const root = fixture();
    const outside = fixture();
    put(root, 'acstack/project.yaml', 'name: local\n');
    put(root, 'config/reference.md', 'reference');
    put(root, 'docs/adr/decision.md', 'decision');
    symlinkSync('../../config/reference.md', join(root, 'docs/adr/reference.md'));
    symlinkSync(outside, join(root, 'acstack/external'));
    symlinkSync(join(root, 'acstack/project.yaml'), join(root, 'acstack/absolute-config'));
    put(outside, 'untouched', 'external');
    migrateProjectData(root);
    expect(readFileSync(join(root, '.acstack/decisions/reference.md'), 'utf8')).toBe('reference');
    expect(readlinkSync(join(root, '.acstack/decisions/reference.md'))).toBe('../../config/reference.md');
    expect(lstatSync(join(root, '.acstack/external')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, '.acstack/absolute-config'), 'utf8')).toBe('name: local\n');
    expect(readFileSync(join(outside, 'untouched'), 'utf8')).toBe('external');
  });

  it('removes only exact generated ignore rules while preserving custom rules', () => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'name: local\n');
    put(root, 'acstack/design-reviews/.gitignore', '*\n');
    put(root, 'acstack/alignment-packs/.gitignore', '# Written by acstack. Delete this file and set workflow.alignment_packs.commit_generated_packs: true to commit packs.\n*\n');
    put(root, '.decisions/.gitignore', '*\n!keep.md\n');
    migrateProjectData(root);
    expect(existsSync(join(root, '.acstack/design-reviews/.gitignore'))).toBe(false);
    expect(existsSync(join(root, '.acstack/alignment-packs/.gitignore'))).toBe(false);
    expect(readFileSync(join(root, '.acstack/decision-logs/.gitignore'), 'utf8')).toBe('*\n!keep.md\n');
  });

  it('rolls back completed moves after a later rename fails', () => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'name: local\n');
    put(root, 'docs/adr/one.md', 'decision');
    put(root, 'CONTEXT.md', 'context');
    put(root, '.gitignore', '# user\n');
    fault.destination = join(root, '.acstack/CONTEXT.md');
    expect(() => migrateProjectData(root)).toThrow('Injected rename failure');
    expect(readFileSync(join(root, 'acstack/project.yaml'), 'utf8')).toBe('name: local\n');
    expect(readFileSync(join(root, 'docs/adr/one.md'), 'utf8')).toBe('decision');
    expect(readFileSync(join(root, 'CONTEXT.md'), 'utf8')).toBe('context');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('# user\n');
    expect(existsSync(join(root, '.acstack'))).toBe(false);
  });

  it('keeps a UTF-8 BOM at the start without changing Git rules or repeated ensure bytes', () => {
    const root = fixture();
    expect(spawnSync('git', ['init', '--quiet'], { cwd: root }).status).toBe(0);
    mkdirSync(join(root, '.acstack'));
    put(root, '.gitignore', '\uFEFFnode_modules/\n');
    put(root, 'node_modules/package/index.js', 'dependency');
    ensureProjectGitignore(root);
    const first = readFileSync(join(root, '.gitignore'));
    expect(first.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(spawnSync('git', ['check-ignore', '--quiet', 'node_modules/package/index.js'], { cwd: root }).status).toBe(0);
    ensureProjectGitignore(root);
    expect(readFileSync(join(root, '.gitignore'))).toEqual(first);
    expect(spawnSync('git', ['check-ignore', '--quiet', 'node_modules/package/index.js'], { cwd: root }).status).toBe(0);
  });

  it('preserves ignore file permissions and leaves bytes unchanged on malformed markers', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    put(root, '.gitignore', '# user\r\ncache/\r\n');
    chmodSync(join(root, '.gitignore'), 0o640);
    ensureProjectGitignore(root);
    expect(statSync(join(root, '.gitignore')).mode & 0o777).toBe(0o640);
    const malformed = '# >>> acstack project-data >>>\n/.acstack/**\n';
    put(root, '.gitignore', malformed);
    expect(() => ensureProjectGitignore(root)).toThrow(/malformed/);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(malformed);
  });
});
