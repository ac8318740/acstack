import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  archiveAlignmentPackWorkingState,
  alignmentPackStoragePaths,
  loadAlignmentPackConfig,
} from './alignment-pack-lifecycle.js';

async function tempRoot() {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'acstack-alignment-pack-lifecycle-'));
}

async function writeProjectConfig(root: string, yaml: string) {
  const acstackDir = join(root, 'acstack');
  await mkdir(acstackDir, { recursive: true });
  await writeFile(join(acstackDir, 'project.yaml'), yaml);
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

describe('alignment pack lifecycle setup and archive rules', () => {
  it('loads default setup config with local generated packs kept ephemeral', async () => {
    const root = await tempRoot();

    await expect(loadAlignmentPackConfig(root)).resolves.toEqual({
      autoGenerate: true,
      approvalGate: true,
      commitGeneratedPacks: false,
    });
  });

  it('parses and normalizes project config overrides for generation, approval, and committed artifacts', async () => {
    const root = await tempRoot();
    await writeProjectConfig(
      root,
      [
        'workflow:',
        '  alignment_packs:',
        '    auto_generate: false',
        '    approval_gate: false',
        '    commit_generated_packs: true',
      ].join('\n') + '\n'
    );

    await expect(loadAlignmentPackConfig(root)).resolves.toEqual({
      autoGenerate: false,
      approvalGate: false,
      commitGeneratedPacks: true,
    });
  });

  it('derives deterministic local storage paths for pack, annotations, feedback, and state', () => {
    const root = '/workspace/project';

    expect(
      alignmentPackStoragePaths({ root, map: 'checkout redesign', packVersion: 'checkout redesign@map:abc/123' })
    ).toEqual({
      directory: join(root, 'acstack', 'alignment-packs', 'checkout-redesign'),
      packHtml: join(root, 'acstack', 'alignment-packs', 'checkout-redesign', 'checkout-redesign@map-abc-123.html'),
      annotationsJsonl: join(root, 'acstack', 'alignment-packs', 'checkout-redesign', 'annotations.jsonl'),
      feedbackMarkdown: join(root, 'acstack', 'alignment-packs', 'checkout-redesign', 'feedback.md'),
      localState: join(root, 'acstack', 'alignment-packs', 'checkout-redesign', 'state.json'),
    });
  });

  it('refuses to archive working state before durable residue has been extracted', async () => {
    const root = await tempRoot();
    const paths = alignmentPackStoragePaths({ root, map: 'checkout-redesign', packVersion: 'checkout-redesign@map-abc123' });
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.packHtml, '<!doctype html><title>Alignment pack</title>');
    await writeFile(paths.annotationsJsonl, '{"comment":"keep until extracted"}\n');
    await writeFile(paths.feedbackMarkdown, '# Feedback\n');
    await writeFile(paths.localState, '{"approved":false}\n');

    await expect(
      archiveAlignmentPackWorkingState({ root, map: 'checkout-redesign', durableResidueExtracted: false })
    ).rejects.toThrow(/durable residue/i);

    await expect(readFile(paths.packHtml, 'utf8')).resolves.toContain('Alignment pack');
    await expect(readFile(paths.annotationsJsonl, 'utf8')).resolves.toContain('keep until extracted');
    await expect(readFile(paths.feedbackMarkdown, 'utf8')).resolves.toContain('Feedback');
    await expect(readFile(paths.localState, 'utf8')).resolves.toContain('approved');
  });

  it('archives generated working state after residue is confirmed without deleting source maps or durable records', async () => {
    const root = await tempRoot();
    const paths = alignmentPackStoragePaths({ root, map: 'checkout-redesign', packVersion: 'checkout-redesign@map-abc123' });
    const sourceMap = join(root, 'acstack', 'maps', 'checkout-redesign', 'node-001.md');
    const durableSpec = join(root, 'acstack', 'specs', 'checkout-redesign.md');
    const durableAdr = join(root, 'docs', 'adr', '0012-checkout-redesign.md');
    const decisionLedger = join(root, 'acstack', 'decisions', 'ledger.md');

    await mkdir(paths.directory, { recursive: true });
    await mkdir(join(root, 'acstack', 'maps', 'checkout-redesign'), { recursive: true });
    await mkdir(join(root, 'acstack', 'specs'), { recursive: true });
    await mkdir(join(root, 'docs', 'adr'), { recursive: true });
    await mkdir(join(root, 'acstack', 'decisions'), { recursive: true });
    await writeFile(paths.packHtml, '<!doctype html><title>Alignment pack</title>');
    await writeFile(paths.annotationsJsonl, '{"comment":"already extracted"}\n');
    await writeFile(paths.feedbackMarkdown, '# Feedback\n');
    await writeFile(paths.localState, '{"approved":true}\n');
    await writeFile(sourceMap, '# Source map node\n');
    await writeFile(durableSpec, '# Durable spec\n');
    await writeFile(durableAdr, '# Durable ADR\n');
    await writeFile(decisionLedger, '# Decision ledger\n');

    await archiveAlignmentPackWorkingState({ root, map: 'checkout-redesign', durableResidueExtracted: true });

    await expect(exists(paths.directory)).resolves.toBe(false);
    await expect(readFile(sourceMap, 'utf8')).resolves.toBe('# Source map node\n');
    await expect(readFile(durableSpec, 'utf8')).resolves.toBe('# Durable spec\n');
    await expect(readFile(durableAdr, 'utf8')).resolves.toBe('# Durable ADR\n');
    await expect(readFile(decisionLedger, 'utf8')).resolves.toBe('# Decision ledger\n');
  });
});
