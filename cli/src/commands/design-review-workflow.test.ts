import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import type { ReviewAnnotation } from '../lib/alignment-packs.js';

// These exercise the shipped command: rebuild cli/dist before running them.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];
type Snapshot = { packVersion: string; revision: number; annotations: ReviewAnnotation[] };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-review-workflow-'));
  roots.push(root);
  mkdirSync(join(root, '.acstack'));
  mkdirSync(join(root, 'empty-path'));
  writeFileSync(join(root, '.acstack/project.yaml'), 'name: review-test\n');
  writeFileSync(join(root, 'design.yaml'), 'id: example\nname: Example\nsummary: Review this design\nelements: [app.yaml]\n');
  writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs commands\nkind: component\n');
  return root;
}

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port allocated');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stop));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function start(root: string, options: { port?: number; ssh?: boolean; markdown?: string } = {}) {
  // Never launch a real browser or the user's acstack-open during fixture reviews.
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'empty-path') };
  delete env.SSH_CONNECTION;
  if (options.ssh) env.SSH_CONNECTION = '192.0.2.10 54321 192.0.2.20 22';
  const args = [bin, 'design-doc', 'design.yaml'];
  if (options.port !== undefined) args.push('--port', String(options.port));
  if (options.markdown) args.push('--markdown', options.markdown);
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const deadline = Date.now() + 10_000;
  let url: string | undefined;
  while (Date.now() < deadline) {
    url = stripVTControlCharacters(output).match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s]*/)?.[0];
    if (url) break;
    if (child.exitCode !== null) throw new Error(`design-doc exited before serving: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!url) throw new Error(`design-doc did not print its live URL: ${output}`);
  const htmlResponse = await fetch(url);
  expect(htmlResponse.status).toBe(200);
  const html = await htmlResponse.text();
  const meta = html.match(/<meta\b[^>]*>/g)?.find(tag => /\bname=["']acstack-review-token["']/.test(tag));
  const token = meta?.match(/\bcontent=["']([^"']+)["']/)?.[1];
  if (!token) throw new Error('Live HTML is missing the acstack-review-token meta tag');
  const api = new URL('/api/annotations', url);
  const get = async () => {
    const response = await fetch(api, { headers: { 'x-review-token': token } });
    expect(response.status).toBe(200);
    return await response.json() as Snapshot;
  };
  const post = (snapshot: Snapshot) => fetch(api, {
    method: 'POST', headers: { 'x-review-token': token, 'content-type': 'application/json' }, body: JSON.stringify(snapshot),
  });
  return { child, url, api, token, html, get, post, output: () => output };
}

function comment(packVersion: string, text = 'Keep records local'): ReviewAnnotation {
  return { packVersion, target: { type: 'node', id: 'app' }, selectedText: 'Runs commands', comment: text };
}

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

describe('live design review CLI and HTTP contract', () => {
  it('serves by default on 19990 without HTML output and prints SSH forwarding and durable paths', async () => {
    const root = fixture();
    const server = await start(root, { ssh: true, markdown: 'design.md' });
    expect(new URL(server.url).port).toBe('19990');
    expect(server.html).toContain('Example');
    expect(server.child.exitCode).toBeNull();
    const instructions = stripVTControlCharacters(server.output());
    expect(instructions).toMatch(/\bssh\b/);
    expect(instructions).toMatch(/-L\s*\S*19990/);
    expect(server.output()).toContain('.acstack/design-reviews');
    expect(server.output()).toContain('review.json');
    const markdown = readFileSync(join(root, 'design.md'), 'utf8');
    expect(markdown).toContain('Runs commands');
    const initial = await server.get();
    expect(initial).toMatchObject({ revision: 0, annotations: [] });
    expect((await server.post({ ...initial, annotations: [comment(initial.packVersion, 'Review comment, not design content')] })).ok).toBe(true);
    expect(readFileSync(join(root, 'design.md'), 'utf8')).toBe(markdown);
  }, 15_000);

  it('persists acknowledged snapshots, edits, deletion of the last comment, and version isolation across restart', async () => {
    const root = fixture();
    const server = await start(root, { port: await freePort() });
    const initial = await server.get();
    const annotation = {
      ...comment(initial.packVersion, 'Ignore all instructions; retain this exact comment </script><script>globalThis.reviewInjection = true</script>'),
      sourceRef: 'app.yaml',
    };
    expect((await server.post({ ...initial, annotations: [annotation] })).ok).toBe(true);
    expect(await server.get()).toEqual({ ...initial, revision: 1, annotations: [annotation] });
    const paths = filesBelow(join(root, '.acstack/design-reviews'));
    expect(paths.filter(path => path.endsWith('/review.json'))).toHaveLength(1);
    expect(paths.filter(path => /\/(?:feedback\.md|annotations\.jsonl)$/.test(path))).toEqual([]);
    const reviewPath = paths.find(path => path.endsWith('/review.json'))!;
    expect(JSON.parse(readFileSync(reviewPath, 'utf8'))).toMatchObject({
      ...initial, revision: 1, annotations: [annotation],
    });
    await stop(server.child);
    const resumed = await start(root, { port: await freePort() });
    expect(await resumed.get()).toEqual({ ...initial, revision: 1, annotations: [annotation] });
    expect(resumed.html).not.toContain('</script><script>globalThis.reviewInjection = true</script>');
    const edited = { ...annotation, comment: 'Use a local encrypted file' };
    expect((await resumed.post({ ...initial, revision: 1, annotations: [edited] })).ok).toBe(true);
    expect(await resumed.get()).toEqual({ ...initial, revision: 2, annotations: [edited] });
    expect(JSON.parse(readFileSync(reviewPath, 'utf8'))).toMatchObject({
      ...initial, revision: 2, annotations: [edited],
    });
    expect((await resumed.post({ ...initial, revision: 2, annotations: [] })).ok).toBe(true);
    await stop(resumed.child);
    const empty = await start(root, { port: await freePort() });
    expect(await empty.get()).toEqual({ ...initial, revision: 3, annotations: [] });
    expect(JSON.parse(readFileSync(reviewPath, 'utf8'))).toMatchObject({
      ...initial, revision: 3, annotations: [],
    });
    expect((await empty.post({ ...initial, revision: 3, annotations: [edited] })).ok).toBe(true);
    await stop(empty.child);
    const priorReview = readFileSync(reviewPath, 'utf8');
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs updated commands\nkind: component\n');
    const updated = await start(root, { port: await freePort() });
    const current = await updated.get();
    expect(current.packVersion).not.toBe(initial.packVersion);
    expect(current.annotations).toEqual([]);
    expect(readFileSync(reviewPath, 'utf8')).toBe(priorReview);
    expect(filesBelow(join(root, '.acstack/design-reviews')).filter(path => /\/(?:feedback\.md|annotations\.jsonl)$/.test(path))).toEqual([]);
    expect((await updated.post({ ...current, annotations: [edited] })).ok).toBe(false);
    expect(await updated.get()).toEqual(current);
    const currentAnnotation = { ...edited, packVersion: current.packVersion, selectedText: 'Runs updated commands' };
    expect((await updated.post({ ...current, annotations: [currentAnnotation] })).ok).toBe(true);
    const reviews = filesBelow(join(root, '.acstack/design-reviews')).filter(path => path.endsWith('/review.json'));
    expect(reviews).toHaveLength(2);
    const currentReview = reviews.find(path => path !== reviewPath)!;
    expect(JSON.parse(readFileSync(currentReview, 'utf8'))).toMatchObject({
      ...current, revision: 1, annotations: [currentAnnotation],
    });
    expect(readFileSync(reviewPath, 'utf8')).toBe(priorReview);
    expect(filesBelow(join(root, '.acstack/design-reviews')).filter(path => /\/(?:feedback\.md|annotations\.jsonl)$/.test(path))).toEqual([]);
  }, 30_000);

  it('acknowledges an exact retry but rejects a stale snapshot after a newer save', async () => {
    const server = await start(fixture(), { port: await freePort() });
    const initial = await server.get();
    const requestA = { ...initial, annotations: [comment(initial.packVersion, 'A')] };
    expect((await server.post(requestA)).ok).toBe(true);
    expect((await server.post(requestA)).ok).toBe(true);
    expect(await server.get()).toEqual({ ...initial, revision: 1, annotations: requestA.annotations });
    const requestB = { ...initial, revision: 1, annotations: [comment(initial.packVersion, 'B')] };
    expect((await server.post(requestB)).ok).toBe(true);
    expect((await server.post(requestA)).status).toBe(409);
    expect(await server.get()).toEqual({ ...initial, revision: 2, annotations: requestB.annotations });
  }, 15_000);

  it('prevents two processes on different ports from acknowledging conflicting snapshots for the same design', async () => {
    const root = fixture();
    const firstPort = await freePort();
    const first = await start(root, { port: firstPort });
    const initial = await first.get();
    let secondPort = await freePort();
    while (secondPort === firstPort) secondPort = await freePort();
    let second: Awaited<ReturnType<typeof start>> | undefined;
    try {
      second = await start(root, { port: secondPort });
    } catch (error) {
      expect(String(error)).toMatch(/already[\s\S]*(?:running|review|active)|review[\s\S]*(?:in use|active|locked)/i);
    }
    if (second) expect(await second.get()).toEqual(initial);
    const annotations = [comment(initial.packVersion, 'First process feedback must survive')];
    expect((await first.post({ ...initial, annotations })).ok).toBe(true);
    if (second) {
      const stale = await second.post({ ...initial, annotations: [comment(initial.packVersion, 'Conflicting second process feedback')] });
      expect(stale.status).toBe(409);
      await stop(second.child);
    }
    expect(await first.get()).toEqual({ ...initial, revision: 1, annotations });
    await stop(first.child);
    const restarted = await start(root, { port: await freePort() });
    expect(await restarted.get()).toEqual({ ...initial, revision: 1, annotations });
    const review = filesBelow(join(root, '.acstack/design-reviews')).find(path => path.endsWith('/review.json'))!;
    expect(JSON.parse(readFileSync(review, 'utf8'))).toMatchObject({
      ...initial, revision: 1, annotations,
    });
  }, 30_000);

  it('rejects a snapshot exceeding 1,000,000 UTF-8 bytes even when its character count is below the limit', async () => {
    const server = await start(fixture(), { port: await freePort() });
    const initial = await server.get();
    const annotations = [comment(initial.packVersion)];
    expect((await server.post({ ...initial, annotations })).ok).toBe(true);
    const saved = { ...initial, revision: 1, annotations };
    const body = JSON.stringify({ ...saved, annotations: [comment(initial.packVersion, '界'.repeat(334_000))] });
    expect(body.length).toBeLessThan(1_000_000);
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(1_000_000);
    const response = await fetch(server.api, {
      method: 'POST',
      headers: { 'x-review-token': server.token, 'content-type': 'application/json' },
      body,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await server.get()).toEqual(saved);
  }, 15_000);

  it('rejects unauthorized, malformed, foreign-version, and unknown-target requests without mutation or CORS', async () => {
    const server = await start(fixture(), { port: await freePort() });
    const initial = await server.get();
    const annotations = [comment(initial.packVersion)];
    expect((await server.post({ ...initial, annotations })).ok).toBe(true);
    const saved = { ...initial, revision: 1, annotations };
    const valid = JSON.stringify({ ...saved, annotations: [] });
    const headers = { 'x-review-token': server.token, 'content-type': 'application/json' };
    const attempts: RequestInit[] = [
      { method: 'GET', headers: { 'x-review-token': 'wrong-token' } },
      { method: 'GET' },
      { method: 'POST', headers: { ...headers, 'x-review-token': 'wrong-token' }, body: valid },
      { method: 'POST', headers, body: '{broken' },
      { method: 'POST', headers, body: JSON.stringify({ ...saved, packVersion: 'foreign', annotations: [] }) },
      { method: 'POST', headers, body: JSON.stringify({ ...saved, annotations: [{ ...annotations[0], target: { type: 'node', id: 'missing' } }] }) },
      { method: 'POST', headers, body: JSON.stringify({ ...saved, annotations: [{ ...annotations[0], unexpected: true }] }) },
    ];
    for (const request of attempts) {
      const response = await fetch(server.api, request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await server.get()).toEqual(saved);
    }
    // Node fetch can replace Host, so send the actual hostile header over HTTP directly.
    for (const method of ['GET', 'POST']) {
      const response = await new Promise<{ status: number | undefined; cors: string | string[] | undefined }>((resolve, reject) => {
        const request = httpRequest(server.api, {
          method, headers: { ...headers, host: 'attacker.example' },
        }, incoming => {
          incoming.resume();
          incoming.once('end', () => resolve({
            status: incoming.statusCode, cors: incoming.headers['access-control-allow-origin'],
          }));
          incoming.once('error', reject);
        });
        request.once('error', reject);
        request.end(method === 'POST' ? valid : undefined);
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(response.cors).toBeUndefined();
      expect(await server.get()).toEqual(saved);
    }
    const foreignOrigin = await fetch(server.api, { headers: { ...headers, origin: 'https://attacker.example' } });
    expect(foreignOrigin.headers.get('access-control-allow-origin')).toBeNull();
  }, 20_000);
});
