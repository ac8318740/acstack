import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveDesignDoc } from './design-doc.js';
import { createNode, updateNode } from '../lib/nodes.js';
import { designChangeListeners, type DesignChange } from '../lib/design-watch.js';
import { trackProject } from '../test-project.js';

// The CLI tests run the shipped command: rebuild cli/dist before running them.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const block = (yaml: string) => `<details>\n<summary>Design element</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n</details>`;
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

type Event = { type: 'design'; pack: { packVersion: string; graph: { nodes: Array<{ id: string; summary: string }> } }; handoffPrompt: string } | { type: 'error'; message: string };
async function start() {
  const checkout = mkdtempSync(join(tmpdir(), 'design-live-'));
  mkdirSync(join(checkout, '.acstack'));
  writeFileSync(join(checkout, '.acstack/project.yaml'), 'name: live-test\n');
  trackProject(checkout);
  const root = join(checkout, '.acstack');
  createNode(root, 'demo', { title: 'Demo', kind: 'destination', label: 'Demo', summary: 'A live design' });
  createNode(root, 'demo', { title: 'App', kind: 'element', label: 'App', summary: 'Runs commands', answers: '001', body: block('kind: component\nconnections: [{to: "003", direction: one-way, label: Writes}]') });
  createNode(root, 'demo', { title: 'Data', kind: 'element', label: 'Data', summary: 'Keeps records', answers: '001', body: block('kind: store') });
  const live = liveDesignDoc(root, 'demo');
  await new Promise<void>(resolve => live.server.listen(0, '127.0.0.1', resolve));
  const address = live.server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const url = `http://127.0.0.1:${address.port}`;
  const token = /name="acstack-review-token" content="([^"]+)"/.exec(await (await fetch(url)).text())![1];
  const abort = new AbortController();
  const response = await fetch(`${url}/api/events`, { headers: { 'x-review-token': token }, signal: abort.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const next = async (): Promise<Event> => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.startsWith('data: ')) return JSON.parse(frame.slice(6)) as Event;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('Event stream closed');
      buffer += value;
    }
  };
  cleanups.push(() => { abort.abort(); live.stop(); rmSync(checkout, { recursive: true, force: true }); });
  return { checkout, root, live, url, token, next, response };
}
const cli = (cwd: string, args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', timeout: 10_000, env: { ...process.env, NO_COLOR: '1' } });

it('serves the event stream only with the review token', async () => {
  const { url, response } = await start();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  expect((await fetch(`${url}/api/events`)).status).toBe(403);
});

it('pushes a rebuilt page when a node file changes, and reports a contradiction without dropping the last good page', async () => {
  const { root, next } = await start();
  updateNode(root, 'demo', '002', { summary: 'Runs every command' });
  const event = await next();
  expect(event.type === 'design' && event.pack.graph.nodes.find(node => node.id === '002')?.summary).toBe('Runs every command');
  updateNode(root, 'demo', '003', { body: block('kind: database') });
  const failure = await next();
  expect(failure.type === 'error' && failure.message).toContain('Node 003');
  updateNode(root, 'demo', '003', { body: block('kind: store') });
  expect((await next()).type).toBe('design');
});

it('pushes after a CLI node write and after design-review refresh', async () => {
  const { checkout, next } = await start();
  const write = cli(checkout, ['node', 'update', '003', '--map', 'demo', '--summary', 'Keeps every record']);
  expect(write.status, write.stderr).toBe(0);
  const event = await next();
  expect(event.type === 'design' && event.pack.graph.nodes.find(node => node.id === '003')?.summary).toBe('Keeps every record');
  const refresh = cli(checkout, ['design-review', 'refresh', 'demo']);
  expect(refresh.status, refresh.stderr).toBe(0);
  expect(refresh.stdout).toContain('Notified');
  expect((await next()).type).toBe('design');
});

it('reports element folder edits, such as fixtures, to change listeners before pushing', async () => {
  const { root, next } = await start();
  const seen: DesignChange[][] = [];
  const listener = (changes: DesignChange[]) => { seen.push(changes); };
  designChangeListeners.add(listener);
  cleanups.push(() => designChangeListeners.delete(listener));
  mkdirSync(join(root, 'maps/demo/elements/003'), { recursive: true });
  writeFileSync(join(root, 'maps/demo/elements/003/records.json'), '[{"id": 1}]');
  expect((await next()).type).toBe('design');
  expect(seen.flat().some(change => change.elementId === '003' && change.file.endsWith('records.json'))).toBe(true);
});

it('keeps comments from before a design change as obligations and names them in the handoff prompt', async () => {
  const { root, next, url, token, live } = await start();
  const first = live.lifecycle().review.reviewPath;
  const snapshot = await (await fetch(`${url}/api/annotations`, { headers: { 'x-review-token': token } })).json() as { packVersion: string; revision: number };
  const saved = await fetch(`${url}/api/annotations`, { method: 'POST', headers: { 'x-review-token': token, 'content-type': 'application/json', origin: url },
    body: JSON.stringify({ ...snapshot, annotations: [{ packVersion: snapshot.packVersion, target: { type: 'node', id: '002' }, comment: 'Name the command' }] }) });
  expect(saved.status).toBe(200);
  updateNode(root, 'demo', '002', { summary: 'Runs named commands' });
  const event = await next();
  if (event.type !== 'design') throw new Error('Expected a rebuilt design');
  expect(event.pack.packVersion).not.toBe(snapshot.packVersion);
  expect(live.lifecycle().review.reviewPath).not.toBe(first);
  expect(event.handoffPrompt).toContain(JSON.stringify(first));
  const status = live.lifecycle().status();
  expect(status.feedbackPaths).toContain(first);
  expect(status.approval.reason).toBe('The agent must finish addressing your saved feedback before you can approve.');
  expect(status.pendingFeedback).toEqual([{ reviewPath: first, commentCount: 1, reason: 'missing' }]);
  // The comment stays listed, tagged with the change that ended its revision.
  expect(status.earlier).toEqual([{ reviewPath: first, packVersion: snapshot.packVersion, label: 'before App changed', annotations: [expect.objectContaining({ comment: 'Name the command' })] }]);
  // The carry is recorded in the new review, so a restarted server still shows it.
  live.stop();
  const restarted = liveDesignDoc(root, 'demo');
  cleanups.push(() => restarted.stop());
  expect(restarted.lifecycle().status().earlier.map(entry => entry.label)).toEqual(['before App changed']);
});
