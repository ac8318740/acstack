import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { locateProject } from './lib/project.js';

/**
 * Make `root` a Git repository whose project folder, under `home`, is a real
 * folder that `root/.acstack` links to. Fixtures can then keep writing project
 * data under `root/.acstack/`; the CLI reads it from the project folder.
 */
export function trackProject(root: string, home: string = process.env.ACSTACK_HOME!): string {
  execFileSync('git', ['init', '-q'], { cwd: root });
  const data = join(root, '.acstack');
  mkdirSync(data, { recursive: true });
  const location = locateProject(root, join(home, 'projects'))!;
  mkdirSync(dirname(location.entry), { recursive: true });
  renameSync(data, location.entry);
  symlinkSync(location.entry, data);
  return root;
}

/** The real git, for fixtures that run the CLI with a PATH of their own. */
export const gitBinary = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

let gitDir: string | undefined;
/** A directory holding only `git`, for fixtures that otherwise empty PATH. */
export function gitOnlyDir(): string {
  if (gitDir) return gitDir;
  gitDir = mkdtempSync(join(tmpdir(), 'acstack-git-only-'));
  symlinkSync(gitBinary, join(gitDir, 'git'));
  return gitDir;
}

/** trackProject for a fixture whose CLI runs with `home` as its ACStack home. */
export function linkProject(root: string, home: string): string {
  return trackProject(root, home);
}
