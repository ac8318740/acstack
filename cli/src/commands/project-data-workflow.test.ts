import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the shipped bundle; rebuild cli/dist before verifying implementation.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const temps: string[] = [];

function temp(prefix: string) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(path);
  return path;
}

/** A Git repository named `name`, plus an ACStack home and old XDG locations of its own. */
function fixture(name = 'shop') {
  const base = temp('acstack-project-data-');
  const root = join(base, 'repos', name);
  mkdirSync(root, { recursive: true });
  git(root, ['init', '--quiet']);
  const env = { ACSTACK_HOME: join(base, 'home'), XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'share') };
  return { base, root, home: env.ACSTACK_HOME, env };
}
type Fixture = ReturnType<typeof fixture>;

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function git(root: string, args: string[]) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function cli(f: Fixture, args: string[], cwd = f.root) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', timeout: 10_000, env: { ...process.env, NO_COLOR: '1', ...f.env } });
  expect(result.stderr).not.toMatch(/unknown command/);
  return result;
}

function ok(f: Fixture, args: string[], cwd = f.root) {
  const result = cli(f, args, cwd);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

/** Set the project up the way /acstack:setup does: create the folder `project-data path` names. */
function setup(f: Fixture, yaml = 'profile: python\n') {
  const folder = ok(f, ['project-data', 'path']);
  put(folder, 'project.yaml', yaml);
  return folder;
}

afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('locating the project folder', () => {
  it('names one folder per repository, shared by its worktrees, without creating it', () => {
    const f = fixture();
    const folder = ok(f, ['project-data', 'path']);
    expect(folder).toMatch(new RegExp(`^${f.home}/projects/shop-[0-9a-f]{6}$`));
    expect(existsSync(folder)).toBe(false);
    git(f.root, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
    git(f.root, ['worktree', 'add', '--quiet', join(f.base, 'feature'), '-b', 'feature']);
    expect(ok(f, ['project-data', 'path'], join(f.base, 'feature'))).toBe(folder);
    mkdirSync(join(f.root, 'src'));
    expect(ok(f, ['project-data', 'path'], join(f.root, 'src'))).toBe(folder);
  });

  it('keys a bare repository and its worktrees by the bare folder', () => {
    const f = fixture();
    git(f.root, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
    const bare = join(f.base, 'store.git');
    git(f.base, ['clone', '--bare', '--quiet', f.root, bare]);
    const tree = join(f.base, 'tree');
    git(bare, ['worktree', 'add', '--quiet', tree, '-b', 'feature']);
    expect(ok(f, ['project-data', 'path'], tree)).toMatch(/\/projects\/store\.git-[0-9a-f]{6}$/);
    expect(cli(f, ['project-data', 'mode', 'tracked'], tree).status).not.toBe(0);
  });

  it('refuses outside a Git repository', () => {
    const f = fixture();
    const result = cli(f, ['project-data', 'path'], f.base);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Git repository/);
  });

  it('reads setup from the project folder and leaves the repository untouched', () => {
    const f = fixture();
    const folder = setup(f);
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
    expect(readdirSync(f.root)).toEqual(['.git']);
    expect(JSON.parse(readFileSync(join(folder, 'project.json'), 'utf8'))).toEqual({ commonDir: join(f.root, '.git') });
  });

  it('reports an entry orphaned by a moved repository, and relinks it', () => {
    const f = fixture();
    setup(f);
    // The first command after setup records which repository owns the folder.
    ok(f, ['config', 'get', 'profile']);
    mkdirSync(join(f.base, 'moved'));
    renameSync(f.root, join(f.base, 'moved', 'shop'));
    const moved = join(f.base, 'moved', 'shop');
    const orphaned = cli(f, ['project-data', 'path'], moved);
    expect(orphaned.status).toBe(0);
    const entry = orphaned.stderr.match(/project-data relink (shop-[0-9a-f]{6})/)?.[1];
    expect(entry, orphaned.stderr).toBeTruthy();
    // An orphan never blocks another repository that shares the folder name.
    expect(cli(f, ['config', 'get', 'profile'], moved).stderr).not.toMatch(/project-data relink/);
    ok(f, ['project-data', 'relink', entry!], moved);
    expect(ok(f, ['config', 'get', 'profile'], moved)).toBe('python');
  });
});

describe('tracked mode', () => {
  it('moves the folder into the main checkout, and back, without touching the Git index', () => {
    const f = fixture();
    const folder = setup(f);
    ok(f, ['project-data', 'mode', 'tracked']);
    expect(lstatSync(folder).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(f.root, '.acstack/project.yaml'), 'utf8')).toBe('profile: python\n');
    expect(existsSync(join(f.root, '.acstack/project.json'))).toBe(false);
    expect(git(f.root, ['status', '--porcelain'])).toBe('?? .acstack/\n');
    ok(f, ['project-data', 'mode', 'global']);
    expect(lstatSync(folder).isDirectory()).toBe(true);
    expect(existsSync(join(f.root, '.acstack'))).toBe(false);
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
  });

  it('links committed project data automatically on a machine that has no entry', () => {
    const f = fixture();
    put(f.root, '.acstack/project.yaml', 'profile: node-typescript\n');
    git(f.root, ['add', '.acstack']);
    git(f.root, ['commit', '--quiet', '-m', 'track']);
    expect(ok(f, ['config', 'get', 'profile'])).toBe('node-typescript');
    expect(realpathSync(ok(f, ['project-data', 'path']))).toBe(join(f.root, '.acstack'));
  });

  it('refuses when both a global folder and committed project data exist', () => {
    const f = fixture();
    setup(f);
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    git(f.root, ['add', '.acstack']);
    const result = cli(f, ['config', 'get', 'profile']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/project-data mode/);
  });
});

describe('explicit migration', () => {
  it('refuses legacy repository data until migrated, then moves it and the managed ignore block', () => {
    const f = fixture();
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    put(f.root, '.acstack/specs/app/spec.md', '# Spec\n');
    put(f.root, '.gitignore', '# >>> acstack project-data >>>\n!/.acstack/\n/.acstack/**\n# <<< acstack project-data <<<\nnode_modules/\n');
    const refused = cli(f, ['list', '--json']);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/project-data migrate/);
    expect(cli(f, ['project-data', 'path']).stderr).toMatch(/still holds its project data/);
    ok(f, ['project-data', 'migrate']);
    const folder = ok(f, ['project-data', 'path']);
    expect(readFileSync(join(folder, 'specs/app/spec.md'), 'utf8')).toBe('# Spec\n');
    expect(existsSync(join(f.root, '.acstack'))).toBe(false);
    expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(git(f.root, ['diff', '--cached', '--name-only'])).toBe('');
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
  });

  it('keeps data already in the Git index in the repository and links it', () => {
    const f = fixture();
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    git(f.root, ['add', '.acstack/project.yaml']);
    ok(f, ['project-data', 'migrate']);
    expect(realpathSync(ok(f, ['project-data', 'path']))).toBe(join(f.root, '.acstack'));
  });

  it('keeps the managed ignore block when tracked data stays in the repository', () => {
    const f = fixture();
    const block = '# >>> acstack project-data >>>\n!/.acstack/\n/.acstack/**\n!/.acstack/project.yaml\n# <<< acstack project-data <<<\n';
    put(f.root, '.gitignore', block);
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    put(f.root, '.acstack/HANDOFF.md', 'private\n');
    git(f.root, ['add', '.gitignore', '.acstack/project.yaml']);
    git(f.root, ['commit', '--quiet', '-m', 'track']);
    ok(f, ['project-data', 'migrate']);
    expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toBe(block);
    // HANDOFF.md stays ignored, so `git add -A` cannot publish it.
    expect(git(f.root, ['status', '--porcelain'])).toBe('');
  });

  it('moves untracked data that exists only in a linked worktree', () => {
    const f = fixture();
    git(f.root, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
    const feature = join(f.base, 'feature');
    git(f.root, ['worktree', 'add', '--quiet', feature, '-b', 'feature']);
    put(feature, '.acstack/project.yaml', 'profile: python\n');
    expect(cli(f, ['config', 'get', 'profile'], feature).stderr).toMatch(/project-data migrate/);
    ok(f, ['project-data', 'migrate'], feature);
    expect(existsSync(join(feature, '.acstack'))).toBe(false);
    expect(ok(f, ['config', 'get', 'profile'], feature)).toBe('python');
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
  });

  it('moves the old machine-wide files into the ACStack home', () => {
    const f = fixture();
    put(f.base, 'config/acstack/config.json', '{"host":{}}\n');
    put(f.base, 'share/acstack/mermaid.min.js', 'mermaid');
    expect(cli(f, ['project-data', 'path']).stderr).toMatch(/project-data migrate/);
    ok(f, ['project-data', 'migrate']);
    expect(readFileSync(join(f.home, 'config.json'), 'utf8')).toBe('{"host":{}}\n');
    expect(readFileSync(join(f.home, 'cache/mermaid.min.js'), 'utf8')).toBe('mermaid');
    expect(existsSync(join(f.base, 'config/acstack'))).toBe(false);
    expect(cli(f, ['project-data', 'path']).stderr).toBe('');
  });

  it('changes nothing when a destination already exists', () => {
    const f = fixture();
    put(f.base, 'config/acstack/config.json', 'old\n');
    put(f.home, 'config.json', 'new\n');
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    expect(cli(f, ['project-data', 'migrate']).status).not.toBe(0);
    expect(readFileSync(join(f.base, 'config/acstack/config.json'), 'utf8')).toBe('old\n');
    expect(readFileSync(join(f.home, 'config.json'), 'utf8')).toBe('new\n');
    expect(readFileSync(join(f.root, '.acstack/project.yaml'), 'utf8')).toBe('profile: python\n');
  });

  it('migrates the oldest acstack/ layout straight into the project folder', () => {
    const f = fixture();
    put(f.root, 'acstack/project.yaml', 'profile: python\n');
    put(f.root, 'docs/adr/0001.md', '# Decision\n');
    ok(f, ['project-data', 'migrate']);
    const folder = ok(f, ['project-data', 'path']);
    expect(readFileSync(join(folder, 'decisions/0001.md'), 'utf8')).toBe('# Decision\n');
    expect(readdirSync(f.root).sort()).toEqual(['.git', 'docs']);
  });

  it('does not follow an external legacy metadata link', () => {
    const f = fixture();
    const outside = temp('acstack-outside-');
    put(outside, 'metadata/project.yaml', 'name: external\n');
    symlinkSync(join(outside, 'metadata'), join(f.root, 'acstack'));
    cli(f, ['project-data', 'migrate']);
    expect(readFileSync(join(outside, 'metadata/project.yaml'), 'utf8')).toBe('name: external\n');
    expect(lstatSync(join(f.root, 'acstack')).isSymbolicLink()).toBe(true);
  });
});
