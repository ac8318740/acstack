import { Command } from 'commander';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { register } from './design-doc.js';
import { createReviewServer } from '../lib/review-server.js';
import { REVIEW_HANDOFF_ID } from '../lib/alignment-review-protocol.js';

const context = vi.hoisted(() => ({ root: '', server: undefined as Server | undefined }));
vi.mock('../lib/utils.js', () => ({
  inProject: (action: (root: string, ...args: unknown[]) => Promise<void>) => (...args: unknown[]) => action(context.root, ...args),
}));
vi.mock('../lib/review-server.js', async original => ({
  ...await original<typeof import('../lib/review-server.js')>(),
  listenForReview: (server: Server) => { context.server = server; },
}));
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function page(server: Server) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const url = `http://127.0.0.1:${address.port}/`;
  return { url, html: await (await fetch(url)).text() };
}
function embeddedPrompt(html: string): string | undefined {
  const script = html.match(new RegExp(`<script id="${REVIEW_HANDOFF_ID}" type="application/json">([^]*?)</script>`));
  return script ? JSON.parse(script[1]) as string : undefined;
}

it('serves exact quoted review and authored paths separately from unchanged annotation snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-'));
  roots.push(root);
  const directory = join(root, '<script>"&', 'design');
  mkdirSync(directory, { recursive: true });
  const entry = join(directory, 'entry"<.yaml');
  writeFileSync(entry, 'id: example\nname: Example\nsummary: Review this design\nelements: [app.yaml]\n');
  writeFileSync(join(directory, 'app.yaml'), 'id: app\nname: App\nsummary: Runs commands\nkind: component\n');
  context.root = root;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const command = new Command();
  register(command);
  await command.parseAsync(['design-doc', entry], { from: 'user' });
  const server = context.server!;
  const { html, url } = await page(server);
  const version = readdirSync(join(root, '.acstack/design-reviews/example'))[0];
  const reviewPath = join(root, '.acstack/design-reviews/example', version, 'review.json');
  const prompt = embeddedPrompt(html)!;
  expect(prompt).toContain(JSON.stringify(reviewPath));
  expect(prompt).toContain(JSON.stringify(entry));
  expect(prompt).not.toMatch(/untrusted|prompt injection|tool instructions/i);
  expect(prompt).toMatch(/update the authored source/);
  expect(prompt).toMatch(/unresolved decisions.*reopen the review/);
  expect(html).not.toContain(entry);
  const token = html.match(/name="acstack-review-token" content="([^"]+)"/)![1];
  const snapshot = await (await fetch(new URL('/api/annotations', url), { headers: { 'x-review-token': token } })).json() as Record<string, unknown>;
  expect(Object.keys(snapshot).sort()).toEqual(['annotations', 'packVersion', 'revision']);
  expect(snapshot).toEqual(JSON.parse(readFileSync(reviewPath, 'utf8')));
  expect(readdirSync(join(root, '.acstack/design-reviews/example', version))).toEqual(['review.json']);
});

it('escapes script terminators and round-trips hostile paths without executable markup', async () => {
  const prompt = 'Read "/tmp/</script><script>alert(1)</script>"&\u2028/review.json"';
  const { html } = await page(createReviewServer({
    html: '<html><head></head><body></body></html>', path: '/api/annotations', mode: 'comments', handoffPrompt: prompt, post: () => ({}),
  }));
  expect(embeddedPrompt(html)).toBe(prompt);
  expect(html).not.toContain('</script><script>alert(1)');
  expect(html).toContain('\\u003c/script\\u003e');
});

it('does not expose a live handoff on legacy pages', async () => {
  const { html } = await page(createReviewServer({ html: '<head></head>', path: '/api/review', handoffPrompt: 'Not live', post: () => ({ prompt: 'Legacy decision' }) }));
  expect(embeddedPrompt(html)).toBeUndefined();
  expect(html).toContain('acstack-review-token');
  expect(html).not.toContain('acstack-review-mode');
});
