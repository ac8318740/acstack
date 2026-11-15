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

describe('repository records', () => {
  it('leaves decisions and the glossary in each worktree, without treating them as legacy data', () => {
    const f = fixture();
    setup(f);
    put(f.root, '.acstack/decisions/0001.md', '# Decision\n');
    put(f.root, '.acstack/CONTEXT.md', '# Glossary\n');
    expect(cli(f, ['project-data', 'path']).stderr).toBe('');
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
    ok(f, ['project-data', 'migrate']);
    expect(readFileSync(join(f.root, '.acstack/decisions/0001.md'), 'utf8')).toBe('# Decision\n');
  });

  it('removes the mode command', () => {
    const f = fixture();
    const result = spawnSync(process.execPath, [bin, 'project-data', 'mode', 'tracked'], { cwd: f.root, encoding: 'utf8', env: { ...process.env, ...f.env } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown command/);
  });
});

describe('migrating tracked mode', () => {
  /** A project in tracked mode: committed `.acstack/` in the main checkout, linked from the entry. */
  function tracked() {
    const f = fixture();
    const entry = ok(f, ['project-data', 'path']);
    put(f.root, '.gitignore', '# >>> acstack project-data >>>\n!/.acstack/\n/.acstack/**\n!/.acstack/project.yaml\n!/.acstack/decisions/**\n# <<< acstack project-data <<<\nnode_modules/\n');
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    put(f.root, '.acstack/maps/m/node.md', 'node\n');
    put(f.root, '.acstack/decisions/0001.md', '# Decision\n');
    put(f.root, '.acstack/CONTEXT.md', '# Glossary\n');
    put(f.root, '.acstack/HANDOFF.md', 'private\n');
    git(f.root, ['add', '-f', '.gitignore', '.acstack/project.yaml', '.acstack/maps', '.acstack/decisions', '.acstack/CONTEXT.md']);
    git(f.root, ['commit', '--quiet', '-m', 'track']);
    mkdirSync(dirname(entry), { recursive: true });
    symlinkSync(join(f.root, '.acstack'), entry);
    return { f, entry };
  }

  it('refuses a tracked-mode link until migrated', () => {
    const { f } = tracked();
    const result = cli(f, ['config', 'get', 'profile']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/project-data migrate/);
  });

  it('moves everything but the records into a real folder, leaving pending deletions', () => {
    const { f, entry } = tracked();
    ok(f, ['project-data', 'migrate']);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(readFileSync(join(entry, 'maps/m/node.md'), 'utf8')).toBe('node\n');
    expect(readFileSync(join(entry, 'HANDOFF.md'), 'utf8')).toBe('private\n');
    expect(readdirSync(join(f.root, '.acstack')).sort()).toEqual(['CONTEXT.md', 'decisions']);
    expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(git(f.root, ['diff', '--cached', '--name-only'])).toBe('');
    expect(git(f.root, ['status', '--porcelain']).split('\n').filter(Boolean).sort()).toEqual([' D .acstack/maps/m/node.md', ' D .acstack/project.yaml', ' M .gitignore']);
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
  });

  it('removes a link to a checkout that holds only records', () => {
    const f = fixture();
    const entry = ok(f, ['project-data', 'path']);
    put(f.root, '.acstack/decisions/0001.md', '# Decision\n');
    mkdirSync(dirname(entry), { recursive: true });
    symlinkSync(join(f.root, '.acstack'), entry);
    ok(f, ['project-data', 'migrate']);
    expect(existsSync(entry)).toBe(false);
    expect(existsSync(join(f.root, '.acstack/decisions/0001.md'))).toBe(true);
  });

  it('warns about leftovers in a worktree branched before migrating, naming that worktree', () => {
    const { f, entry } = tracked();
    const old = join(f.base, 'old');
    git(f.root, ['worktree', 'add', '--quiet', old, '-b', 'old']);
    ok(f, ['project-data', 'migrate']);
    const result = cli(f, ['project-data', 'path'], old);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(realpathSync(entry));
    expect(result.stderr).toContain(`${old} still holds project data`);
    expect(result.stderr).not.toContain(`${f.root} still holds`);
    expect(result.stderr).toMatch(/Merge the branch where `acstack project-data migrate` ran, or delete the leftover files/);
    expect(result.stderr).not.toMatch(/run `acstack project-data migrate` from each/);
  });

  it('aborts on a collision without moving anything', () => {
    const { f, entry } = tracked();
    rmSync(entry);
    put(entry, 'maps/m/node.md', 'global\n');
    const result = cli(f, ['project-data', 'migrate']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/);
    expect(readFileSync(join(entry, 'maps/m/node.md'), 'utf8')).toBe('global\n');
    expect(readFileSync(join(f.root, '.acstack/project.yaml'), 'utf8')).toBe('profile: python\n');
    expect(existsSync(join(entry, 'project.yaml'))).toBe(false);
  });
});

describe('records and retired files in a global project', () => {
  function global() {
    const f = fixture();
    git(f.root, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
    const folder = setup(f);
    put(folder, 'decisions/0001.md', '# Decision\n');
    put(folder, 'CONTEXT.md', '# Glossary\n');
    put(folder, 'specs/app/spec.md', '# Spec\n');
    put(folder, 'domain-map.yaml', 'domains: []\n');
    return { f, folder };
  }

  it('never moves records silently', () => {
    const { f, folder } = global();
    const result = cli(f, ['project-data', 'migrate']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--decisions move/);
    expect(existsSync(join(folder, 'decisions/0001.md'))).toBe(true);
    expect(existsSync(join(f.root, '.acstack'))).toBe(false);
  });

  it('moves each record into the current worktree and deletes retired files only when asked', () => {
    const { f, folder } = global();
    const feature = join(f.base, 'feature');
    git(f.root, ['worktree', 'add', '--quiet', feature, '-b', 'feature']);
    ok(f, ['project-data', 'migrate', '--decisions', 'move', '--glossary', 'keep', '--retired', 'keep'], feature);
    expect(readFileSync(join(feature, '.acstack/decisions/0001.md'), 'utf8')).toBe('# Decision\n');
    expect(existsSync(join(folder, 'decisions'))).toBe(false);
    expect(existsSync(join(folder, 'CONTEXT.md'))).toBe(true);
    expect(existsSync(join(folder, 'specs'))).toBe(true);
    expect(existsSync(join(f.root, '.acstack'))).toBe(false);
    ok(f, ['project-data', 'migrate', '--glossary', 'move', '--retired', 'delete'], feature);
    expect(readFileSync(join(feature, '.acstack/CONTEXT.md'), 'utf8')).toBe('# Glossary\n');
    expect(existsSync(join(folder, 'specs'))).toBe(false);
    expect(existsSync(join(folder, 'domain-map.yaml'))).toBe(false);
    expect(existsSync(join(folder, 'project.yaml'))).toBe(true);
  });

  it('removes the managed ignore block when only records move, so they stay committable', () => {
    const { f } = global();
    put(f.root, '.gitignore', '# >>> acstack project-data >>>\n!/.acstack/\n/.acstack/**\n# <<< acstack project-data <<<\nnode_modules/\n');
    ok(f, ['project-data', 'migrate', '--decisions', 'move', '--glossary', 'move', '--retired', 'keep']);
    expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(git(f.root, ['status', '--porcelain', '--untracked-files=all', '.acstack'])).toBe('?? .acstack/CONTEXT.md\n?? .acstack/decisions/0001.md\n');
  });

  it('refuses to move records where Git would ignore them, changing nothing', () => {
    const { f, folder } = global();
    const ignore = '# >>> acstack project-data >>>\n/.acstack/**\n# <<< acstack project-data <<<\n.acstack/\n';
    put(f.root, '.gitignore', ignore);
    const result = cli(f, ['project-data', 'migrate', '--decisions', 'move', '--glossary', 'keep', '--retired', 'keep']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/would ignore .*decisions\/0001\.md.*Nothing was moved/);
    expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toBe(ignore);
    expect(existsSync(join(folder, 'decisions/0001.md'))).toBe(true);
    expect(existsSync(join(f.root, '.acstack'))).toBe(false);
  });

  it('refuses to overwrite a record already in the repository', () => {
    const { f, folder } = global();
    put(f.root, '.acstack/decisions/0002.md', '# Other\n');
    const result = cli(f, ['project-data', 'migrate', '--decisions', 'move', '--glossary', 'move']);
    expect(result.status).not.toBe(0);
    expect(existsSync(join(folder, 'decisions/0001.md'))).toBe(true);
    expect(existsSync(join(folder, 'CONTEXT.md'))).toBe(true);
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
    expect(cli(f, ['project-data', 'path']).stderr).toMatch(/still holds project data/);
    ok(f, ['project-data', 'migrate']);
    const folder = ok(f, ['project-data', 'path']);
    expect(readFileSync(join(folder, 'specs/app/spec.md'), 'utf8')).toBe('# Spec\n');
    expect(existsSync(join(f.root, '.acstack'))).toBe(false);
    expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(git(f.root, ['diff', '--cached', '--name-only'])).toBe('');
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
  });

  it('moves committed data with no link out of the repository, leaving a pending deletion', () => {
    const f = fixture();
    put(f.root, '.acstack/project.yaml', 'profile: python\n');
    git(f.root, ['add', '.acstack/project.yaml']);
    expect(cli(f, ['config', 'get', 'profile']).stderr).toMatch(/project-data migrate/);
    ok(f, ['project-data', 'migrate']);
    expect(git(f.root, ['status', '--porcelain'])).toBe('AD .acstack/project.yaml\n');
    expect(ok(f, ['config', 'get', 'profile'])).toBe('python');
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

  it('migrates the oldest acstack/ layout, keeping decisions in the repository', () => {
    const f = fixture();
    put(f.root, 'acstack/project.yaml', 'profile: python\n');
    put(f.root, 'docs/adr/0001.md', '# Decision\n');
    ok(f, ['project-data', 'migrate']);
    const folder = ok(f, ['project-data', 'path']);
    expect(readFileSync(join(folder, 'project.yaml'), 'utf8')).toBe('profile: python\n');
    expect(readFileSync(join(f.root, '.acstack/decisions/0001.md'), 'utf8')).toBe('# Decision\n');
    expect(readdirSync(f.root).sort()).toEqual(['.acstack', '.git', 'docs']);
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
