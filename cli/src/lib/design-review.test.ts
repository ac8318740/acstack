import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designDocToPack } from './design-doc.js';
import { exampleDesign } from '../example-design.js';
import { openDesignReview, readDesignReviewHistory } from './design-review.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('identifies the exact malformed canonical history without changing its evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-review-'));
  roots.push(root);
  const pack = designDocToPack(exampleDesign());
  const { reviewPath } = openDesignReview(root, pack);
  const malformed = Buffer.from('{"packVersion":');
  writeFileSync(reviewPath, malformed);

  let failure: unknown;
  try { readDesignReviewHistory(root, pack.designDocument!.id, reviewPath); }
  catch (error) { failure = error; }

  expect(readFileSync(reviewPath)).toEqual(malformed);
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) throw new Error('Expected malformed history to fail');
  expect(failure.message).toContain(reviewPath);
  expect(failure instanceof SyntaxError ? failure : failure.cause).toBeInstanceOf(SyntaxError);
});
