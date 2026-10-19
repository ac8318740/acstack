import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the shipped bundle; rebuild cli/dist before verifying implementation.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'acstack-project-data-'));
  roots.push(root);
  git(root, ['init', '--quiet']);
  return root;
}

function put(root: string, path: string, content: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function cli(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  if (result.error) throw result.error;
  // A missing command must not masquerade as a successful safety refusal.
  expect(result.stderr).not.toMatch(/unknown command/);
  return result;
}

function succeeds(root: string, args: string[]) {
  const result = cli(root, args);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function ignored(root: string, path: string) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', path], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
  });
  if (result.error) throw result.error;
  expect([0, 1]).toContain(result.status);
  return result.status === 0;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('project-data CLI policy', () => {
  it('ensure leaves an uninitialised project untouched', () => {
    const root = fixture();
    const original = '# user policy\r\nnode_modules/\r\n';
    put(root, '.gitignore', original);
    succeeds(root, ['project-data', 'ensure']);
    expect(existsSync(join(root, '.acstack'))).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(original);
  });

  it('ensure ignores every part of an empty hidden directory without requiring setup', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    succeeds(root, ['project-data', 'ensure']);
    expect(existsSync(join(root, '.acstack/project.yaml'))).toBe(false);
    const paths = [
      'project.yaml', 'specs/app/spec.md', 'decisions/001.md', 'CONTEXT.md',
      'agent-browser.json', '.test-baseline', 'decision-logs/log.md',
      'verification/VERIFICATION-KNOWLEDGE.md', 'design-reviews/pack/review.json',
      'unknown-future-part/data.json',
    ];
    for (const path of paths) {
      put(root, `.acstack/${path}`, 'private\n');
      expect(ignored(root, `.acstack/${path}`), path).toBe(true);
    }
    put(root, 'application.ts', 'export {};\n');
    expect(ignored(root, 'application.ts')).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('/.acstack/**');
  });

  it('preserves CRLF user rules, tree and file opt-ins, and repeated ensure bytes', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    const original = '# user rules\r\ncache/\r\n!/.acstack/specs/\r\n!/.acstack/specs/**\r\n!/.acstack/project.yaml\r\n';
    put(root, '.gitignore', original);
    succeeds(root, ['project-data', 'ensure']);
    const first = readFileSync(join(root, '.gitignore'));
    expect(first.toString().slice(-original.length)).toBe(original);
    expect(first.toString().indexOf('/.acstack/**')).toBeLessThan(first.toString().indexOf('# user rules'));
    for (const path of ['specs/app/spec.md', 'project.yaml', 'decisions/private.md']) put(root, `.acstack/${path}`, 'data');
    expect(ignored(root, '.acstack/specs/app/spec.md')).toBe(false);
    expect(ignored(root, '.acstack/project.yaml')).toBe(false);
    expect(ignored(root, '.acstack/decisions/private.md')).toBe(true);
    expect(ignored(root, 'cache/output')).toBe(true);
    succeeds(root, ['project-data', 'ensure']);
    expect(readFileSync(join(root, '.gitignore'))).toEqual(first);
  });

  it('preserves non-UTF8 gitignore bytes or refuses without changing them', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    const original = Buffer.concat([Buffer.from('# User bytes: '), Buffer.from([0xff, 0xfe]), Buffer.from('\ncache/\n')]);
    put(root, '.gitignore', original);
    const result = cli(root, ['project-data', 'ensure']);
    const after = readFileSync(join(root, '.gitignore'));
    if (result.status === 0) {
      expect(after.subarray(-original.length)).toEqual(original);
      expect(ignored(root, '.acstack/private.json')).toBe(true);
    } else {
      expect(after).toEqual(original);
    }
  });

  it('normal CLI startup repairs policy from a nested working directory', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    mkdirSync(join(root, 'src/nested'), { recursive: true });
    const result = cli(join(root, 'src/nested'), ['--version']);
    expect(result.status).toBe(0);
    expect(ignored(root, '.acstack/secret.json')).toBe(true);
    expect(existsSync(join(root, 'src/nested/.gitignore'))).toBe(false);
  });

  it('enforces ignore policy before executing a PATH-dispatched helper', () => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    put(root, 'fixture-bin/acstack-policy-probe', '#!/bin/sh\ngit check-ignore --no-index --quiet .acstack/private.json\nresult=$?\nprintf "policy=%s argument=%s\\n" "$result" "$1"\n');
    chmodSync(join(root, 'fixture-bin/acstack-policy-probe'), 0o755);
    const result = cli(root, ['policy-probe', 'payload'], {
      PATH: `${join(root, 'fixture-bin')}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('policy=0 argument=payload\n');
    expect(ignored(root, '.acstack/private.json')).toBe(true);
  });

  it.each([
    ['missing closing boundary', '# >>> acstack project-data >>>\n/.acstack/**\n'],
    ['misordered boundaries', '# <<< acstack project-data <<<\n/.acstack/**\n# >>> acstack project-data >>>\n'],
    ['duplicate boundary', '# >>> acstack project-data >>>\n# >>> acstack project-data >>>\n/.acstack/**\n# <<< acstack project-data <<<\n'],
  ])('refuses malformed managed blocks with %s without changing user bytes', (_condition, block) => {
    const root = fixture();
    mkdirSync(join(root, '.acstack'));
    const original = Buffer.from(`${block}# User rules\r\ncache/\r\n!/.acstack/project.yaml\r\n`);
    put(root, '.gitignore', original);
    const result = cli(root, ['project-data', 'ensure']);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(root, '.gitignore'))).toEqual(original);
    expect(existsSync(join(root, '.acstack/project.yaml'))).toBe(false);
  });

  it('refuses a symlinked gitignore without changing its target', () => {
    const root = fixture();
    const outside = fixture();
    mkdirSync(join(root, '.acstack'));
    put(outside, 'ignore', '# external user rules\n');
    symlinkSync(join(outside, 'ignore'), join(root, '.gitignore'));
    const result = cli(root, ['project-data', 'ensure']);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(outside, 'ignore'), 'utf8')).toBe('# external user rules\n');
    expect(lstatSync(join(root, '.gitignore')).isSymbolicLink()).toBe(true);
  });
});

const legacyFiles = [
  ['acstack/project.yaml', '.acstack/project.yaml', 'name: local\n'],
  ['acstack/specs/app/spec.md', '.acstack/specs/app/spec.md', '# App\r\n'],
  ['acstack/design-reviews/example/review.json', '.acstack/design-reviews/example/review.json', '{"packVersion":"v1","revision":7,"annotations":[{"comment":"Keep this comment"}]}\n'],
  ['docs/adr/0001.md', '.acstack/decisions/0001.md', '# Decision\n'],
  ['CONTEXT.md', '.acstack/CONTEXT.md', '# Context\n'],
  ['agent-browser.json', '.acstack/agent-browser.json', '{"port":12345}\n'],
  ['.test-baseline', '.acstack/.test-baseline', '120\n'],
  ['.decisions/review.md', '.acstack/decision-logs/review.md', '# Log\n'],
] as const;

describe('project-data explicit migration', () => {
  it('moves all legacy data byte-for-byte without staging, rewriting the index, or opting tracked parts into Git', () => {
    const root = fixture();
    for (const [oldPath, , content] of legacyFiles) put(root, oldPath, content);
    put(root, 'docs/manual.md', '# Unrelated manual\n');
    git(root, ['add', '.']);
    const index = readFileSync(join(root, '.git/index'));
    succeeds(root, ['project-data', 'migrate']);
    for (const [oldPath, newPath, content] of legacyFiles) {
      expect(existsSync(join(root, oldPath)), oldPath).toBe(false);
      expect(readFileSync(join(root, newPath))).toEqual(Buffer.from(content));
      expect(ignored(root, newPath), newPath).toBe(true);
    }
    expect(readFileSync(join(root, '.git/index'))).toEqual(index);
    expect(readFileSync(join(root, 'docs/manual.md'), 'utf8')).toBe('# Unrelated manual\n');
    expect(git(root, ['diff', '--name-only'])).toContain('acstack/project.yaml');
  });

  it.each([
    ['.acstack/specs/app/spec.md', 'existing spec'],
    ['.acstack/decisions/0001.md', 'existing decision'],
    ['.acstack/CONTEXT.md', 'existing context'],
    ['.acstack/agent-browser.json', 'existing browser config'],
    ['.acstack/.test-baseline', 'existing baseline'],
    ['.acstack/decision-logs/review.md', 'existing log'],
  ])('preflights collision at %s before moving any legacy source', (destination, existing) => {
    const root = fixture();
    for (const [oldPath, , content] of legacyFiles) put(root, oldPath, content);
    put(root, destination, existing);
    const result = cli(root, ['project-data', 'migrate']);
    expect(result.status).not.toBe(0);
    for (const [oldPath, , content] of legacyFiles) {
      expect(readFileSync(join(root, oldPath))).toEqual(Buffer.from(content));
    }
    expect(readFileSync(join(root, destination), 'utf8')).toBe(existing);
  });

  it('allows explicit review-tree opt-in after migrating the legacy generated star ignore', () => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'name: legacy-reviews\n');
    put(root, 'acstack/design-reviews/.gitignore', '*\n');
    put(root, 'acstack/design-reviews/example/review.json', '{"revision":7,"annotations":[]}\n');
    put(root, 'acstack/custom/.gitignore', '*\n');
    succeeds(root, ['project-data', 'migrate']);
    expect(ignored(root, '.acstack/design-reviews/example/review.json')).toBe(true);
    const policy = readFileSync(join(root, '.gitignore'));
    put(root, '.gitignore', Buffer.concat([
      policy,
      Buffer.from('\n!/.acstack/design-reviews/\n!/.acstack/design-reviews/**\n'),
    ]));
    succeeds(root, ['project-data', 'ensure']);
    expect(ignored(root, '.acstack/design-reviews/example/review.json')).toBe(false);
    expect(readFileSync(join(root, '.acstack/design-reviews/example/review.json'), 'utf8')).toBe('{"revision":7,"annotations":[]}\n');
    expect(readFileSync(join(root, '.acstack/custom/.gitignore'), 'utf8')).toBe('*\n');
  });

  it('preserves custom nested ignores while allowing public review files after tree opt-in', () => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'name: custom-review-rules\n');
    const custom = Buffer.from('private.json\n');
    put(root, 'acstack/design-reviews/.gitignore', custom);
    put(root, 'acstack/design-reviews/example/private.json', 'private comment\n');
    put(root, 'acstack/design-reviews/example/review.json', 'public comment\n');
    succeeds(root, ['project-data', 'migrate']);
    put(root, '.gitignore', Buffer.concat([
      readFileSync(join(root, '.gitignore')),
      Buffer.from('\n!/.acstack/design-reviews/\n!/.acstack/design-reviews/**\n'),
    ]));
    succeeds(root, ['project-data', 'ensure']);
    expect(readFileSync(join(root, '.acstack/design-reviews/.gitignore'))).toEqual(custom);
    expect(ignored(root, '.acstack/design-reviews/example/private.json')).toBe(true);
    expect(ignored(root, '.acstack/design-reviews/example/review.json')).toBe(false);
    expect(readFileSync(join(root, '.acstack/design-reviews/example/private.json'), 'utf8')).toBe('private comment\n');
    expect(readFileSync(join(root, '.acstack/design-reviews/example/review.json'), 'utf8')).toBe('public comment\n');
  });

  it('moves only the configured verification knowledge file, leaving helper code and user files in place', () => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'frontend:\n  helpers_dir: "fe/helpers/"\n');
    const knowledge = Buffer.from('# Verification knowledge\r\n\r\nPreserve this evidence.\r\n');
    put(root, 'fe/helpers/VERIFICATION-KNOWLEDGE.md', knowledge);
    put(root, 'fe/helpers/browser-helper.js', 'export const helper = true;\n');
    put(root, 'fe/helpers/user-notes.md', '# Personal notes\n');
    succeeds(root, ['project-data', 'migrate']);
    expect(readFileSync(join(root, '.acstack/verification/VERIFICATION-KNOWLEDGE.md'))).toEqual(knowledge);
    expect(existsSync(join(root, 'fe/helpers/VERIFICATION-KNOWLEDGE.md'))).toBe(false);
    expect(readFileSync(join(root, 'fe/helpers/browser-helper.js'), 'utf8')).toBe('export const helper = true;\n');
    expect(readFileSync(join(root, 'fe/helpers/user-notes.md'), 'utf8')).toBe('# Personal notes\n');
    expect(ignored(root, '.acstack/verification/VERIFICATION-KNOWLEDGE.md')).toBe(true);
  });

  it('never migrates verification knowledge from a configured path outside the project', () => {
    const root = fixture();
    const outside = fixture();
    put(outside, 'helpers/VERIFICATION-KNOWLEDGE.md', '# External evidence\n');
    put(outside, 'helpers/user-notes.md', '# External user notes\n');
    const helpers = relative(root, join(outside, 'helpers'));
    put(root, 'acstack/project.yaml', `frontend:\n  helpers_dir: ${JSON.stringify(helpers)}\n`);
    // Refusal or migration of local metadata is allowed; external data must stay put.
    cli(root, ['project-data', 'migrate']);
    expect(readFileSync(join(outside, 'helpers/VERIFICATION-KNOWLEDGE.md'), 'utf8')).toBe('# External evidence\n');
    expect(readFileSync(join(outside, 'helpers/user-notes.md'), 'utf8')).toBe('# External user notes\n');
    expect(existsSync(join(root, '.acstack/verification/VERIFICATION-KNOWLEDGE.md'))).toBe(false);
  });

  it('preserves a relative project-config symlink target after migration', () => {
    const root = fixture();
    put(root, 'config/project.yaml', 'name: shared-config\n');
    mkdirSync(join(root, 'acstack'));
    symlinkSync('../config/project.yaml', join(root, 'acstack/project.yaml'));
    succeeds(root, ['project-data', 'migrate']);
    expect(lstatSync(join(root, '.acstack/project.yaml')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, '.acstack/project.yaml'), 'utf8')).toBe('name: shared-config\n');
    expect(readlinkSync(join(root, '.acstack/project.yaml'))).toBe('../config/project.yaml');
    expect(readFileSync(join(root, 'config/project.yaml'), 'utf8')).toBe('name: shared-config\n');
  });

  it('does not follow an external legacy metadata directory', () => {
    const root = fixture();
    const outside = fixture();
    put(outside, 'metadata/project.yaml', 'name: external\n');
    symlinkSync(join(outside, 'metadata'), join(root, 'acstack'));
    const result = cli(root, ['project-data', 'migrate']);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(outside, 'metadata/project.yaml'), 'utf8')).toBe('name: external\n');
    expect(lstatSync(join(root, 'acstack')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(root, '.acstack/project.yaml'))).toBe(false);
  });

  it('legacy-only project commands request explicit migration instead of creating empty hidden state', () => {
    const root = fixture();
    put(root, 'acstack/project.yaml', 'name: legacy\n');
    put(root, 'acstack/specs/app/spec.md', '# Existing spec\n');
    const result = cli(root, ['list', '--json']);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/project-data\s+migrate/);
    expect(existsSync(join(root, '.acstack'))).toBe(false);
    expect(readFileSync(join(root, 'acstack/specs/app/spec.md'), 'utf8')).toBe('# Existing spec\n');
  });
});
