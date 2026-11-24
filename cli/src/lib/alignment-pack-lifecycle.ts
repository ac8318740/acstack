import { join } from 'node:path';

const ALIGNMENT_PACKS_DIR = 'alignment-packs';

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

function storageName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._@-]+/g, '-');
}

export function alignmentPackStoragePaths(options: AlignmentPackStorageOptions): AlignmentPackStoragePaths {
  const safeMap = storageName(options.map);
  const directory = join(options.root, ALIGNMENT_PACKS_DIR, safeMap);
  return {
    directory,
    packHtml: join(directory, `${storageName(options.packVersion)}.html`),
    annotationsJsonl: join(directory, 'annotations.jsonl'),
    feedbackMarkdown: join(directory, 'feedback.md'),
    localState: join(directory, 'state.json'),
  };
}
