import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ACSTACK_DIR, projectFile } from './constants.js';
import { getProjectKey, projectKeyDefaultFlag } from './project-config.js';

export const ALIGNMENT_PACK_AUTO_GENERATE_KEY = 'workflow.alignment_packs.auto_generate';
export const ALIGNMENT_PACK_APPROVAL_GATE_KEY = 'workflow.alignment_packs.approval_gate';
export const ALIGNMENT_PACK_COMMIT_GENERATED_PACKS_KEY = 'workflow.alignment_packs.commit_generated_packs';

const ALIGNMENT_PACKS_DIR = 'alignment-packs';

export interface AlignmentPackConfig {
  autoGenerate: boolean;
  approvalGate: boolean;
  commitGeneratedPacks: boolean;
}

export interface AlignmentPackStorageOptions {
  root: string;
  map: string;
  packVersion: string;
}

export interface AlignmentPackStoragePaths {
  directory: string;
  packHtml: string;
  annotationsJsonl: string;
  feedbackMarkdown: string;
  localState: string;
}

export interface ArchiveAlignmentPackWorkingStateOptions {
  root: string;
  map: string;
  durableResidueExtracted: boolean;
}

function booleanProjectValue(file: string, key: string): boolean {
  const read = getProjectKey(file, key);
  if (read.status === 'unset') return projectKeyDefaultFlag(key);
  if (typeof read.value !== 'boolean') throw new Error(`${key} must be a boolean.`);
  return read.value;
}

function storageName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._@-]+/g, '-');
}

export function loadAlignmentPackConfig(root: string): Promise<AlignmentPackConfig> {
  const file = projectFile(root);
  return Promise.resolve({
    autoGenerate: booleanProjectValue(file, ALIGNMENT_PACK_AUTO_GENERATE_KEY),
    approvalGate: booleanProjectValue(file, ALIGNMENT_PACK_APPROVAL_GATE_KEY),
    commitGeneratedPacks: booleanProjectValue(file, ALIGNMENT_PACK_COMMIT_GENERATED_PACKS_KEY),
  });
}

export function alignmentPackStoragePaths(options: AlignmentPackStorageOptions): AlignmentPackStoragePaths {
  const safeMap = storageName(options.map);
  const directory = join(options.root, ACSTACK_DIR, ALIGNMENT_PACKS_DIR, safeMap);
  return {
    directory,
    packHtml: join(directory, `${storageName(options.packVersion)}.html`),
    annotationsJsonl: join(directory, 'annotations.jsonl'),
    feedbackMarkdown: join(directory, 'feedback.md'),
    localState: join(directory, 'state.json'),
  };
}

export async function archiveAlignmentPackWorkingState(options: ArchiveAlignmentPackWorkingStateOptions): Promise<void> {
  if (!options.durableResidueExtracted) {
    throw new Error('Cannot archive alignment pack working state before durable residue has been extracted.');
  }

  const paths = alignmentPackStoragePaths({
    root: options.root,
    map: options.map,
    packVersion: options.map,
  });
  await rm(paths.directory, { recursive: true, force: true });
}

// Generated packs stay out of git unless the project opts in; an ignore file inside the folder
// does that without touching the project's own .gitignore.
export function ignoreGeneratedPacks(root: string): void {
  const ignore = join(root, ACSTACK_DIR, ALIGNMENT_PACKS_DIR, '.gitignore');
  if (existsSync(ignore) || booleanProjectValue(projectFile(root), ALIGNMENT_PACK_COMMIT_GENERATED_PACKS_KEY)) return;
  mkdirSync(dirname(ignore), { recursive: true });
  writeFileSync(ignore, `# Written by acstack. Delete this file and set ${ALIGNMENT_PACK_COMMIT_GENERATED_PACKS_KEY}: true to commit packs.\n*\n`);
}
