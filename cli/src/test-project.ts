import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { locateProject } from './lib/project.js';

/**
 * Make `root` a Git repository whose `.acstack/` is in the index, so the CLI
 * resolves its project folder to `root/.acstack` (tracked mode). Fixtures can
 * then keep writing project data under `root/.acstack/`.
 */
export function trackProject(root: string): string {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.acstack'], { cwd: root });
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

/**
 * Make `root` a Git repository whose project folder, under `home`, links to
 * `root/.acstack`, for a fixture with no committed project.yaml to track.
 */
export function linkProject(root: string, home: string): string {
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, '.acstack'), { recursive: true });
  const location = locateProject(root, join(home, 'projects'))!;
  mkdirSync(dirname(location.entry), { recursive: true });
  symlinkSync(join(root, '.acstack'), location.entry);
  return root;
}
