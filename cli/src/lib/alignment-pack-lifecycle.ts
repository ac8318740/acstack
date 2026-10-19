import { join } from 'node:path';

import { ACSTACK_DIR } from './constants.js';
import { ensureProjectGitignore } from './project-data.js';

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

function storageName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._@-]+/g, '-');
}

export function loadAlignmentPackConfig(root: string): Promise<AlignmentPackConfig> {
  void root;
  return Promise.resolve({ autoGenerate: false, approvalGate: false, commitGeneratedPacks: false });
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

export function archiveAlignmentPackWorkingState(options: ArchiveAlignmentPackWorkingStateOptions): Promise<void> {
  if (!options.durableResidueExtracted) {
    throw new Error('Cannot archive alignment pack working state before durable residue has been extracted.');
  }

  // Legacy review artifacts remain available for explicit migration.
  return Promise.resolve();
}

// Git's root ignore rules alone control tracking; commit_generated_packs is compatibility-only.
export function ignoreGeneratedPacks(root: string): void {
  ensureProjectGitignore(root);
}
