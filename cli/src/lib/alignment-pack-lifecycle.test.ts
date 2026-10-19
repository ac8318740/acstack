import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignmentPackStoragePaths } from './alignment-pack-lifecycle.js';

describe('historical alignment pack storage paths', () => {
  it('derives deterministic local storage paths for pack, annotations, feedback, and state', () => {
    const root = '/workspace/project';

    expect(
      alignmentPackStoragePaths({ root, map: 'checkout redesign', packVersion: 'checkout redesign@map:abc/123' })
    ).toEqual({
      directory: join(root, '.acstack', 'alignment-packs', 'checkout-redesign'),
      packHtml: join(root, '.acstack', 'alignment-packs', 'checkout-redesign', 'checkout-redesign@map-abc-123.html'),
      annotationsJsonl: join(root, '.acstack', 'alignment-packs', 'checkout-redesign', 'annotations.jsonl'),
      feedbackMarkdown: join(root, '.acstack', 'alignment-packs', 'checkout-redesign', 'feedback.md'),
      localState: join(root, '.acstack', 'alignment-packs', 'checkout-redesign', 'state.json'),
    });
  });

});
