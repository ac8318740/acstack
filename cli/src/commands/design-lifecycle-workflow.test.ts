import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { gitBinary, trackProject } from '../test-project.js';

// Black-box contract tests: the parent rebuilds cli/dist before the green run.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];
type Tuple = { sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string };
type Status = Tuple & { reviewPath: string; openQuestions: string[]; locked: string[]; warnings: string[]; blockers: Array<{ kind: string; targetId: string; label: string; nodeId: string }>; approval: { valid: boolean; reason?: string } };
type Snapshot = { packVersion: string; revision: number; annotations: Record<string, unknown>[] };
type Node = { id: string; kind: string; status: string; mode?: string; answers?: string; body?: string };
type Tracker = 'files' | 'github';
const element = (yaml: string) => `<details>\n<summary>Design element</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n</details>`;
const question = (yaml: string) => `Should retries keep the draft?\n\n<details>\n<summary>Design question</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n</details>`;
const base = (): Node[] => [
  { id: '101', kind: 'destination', status: 'open' },
  { id: '102', kind: 'element', status: 'open', answers: '101', body: `Runs commands.\n\n${element('kind: component\nconnections: [{to: 103, direction: one-way, label: Writes}]')}` },
  { id: '103', kind: 'element', status: 'open', answers: '101', body: element('kind: store') },
];
function fixture(tracker: Tracker = 'files', list: Node[] = base()) {
  const root = mkdtempSync(join(tmpdir(), 'design-lifecycle-'));
  roots.push(root);
  mkdirSync(join(root, '.acstack'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, '.acstack/project.yaml'), `name: lifecycle-test\nworkflow:\n  maps:\n    tracker: ${tracker}\n`);
  trackProject(root);
  symlinkSync(gitBinary, join(root, 'bin', 'git'));
  // A real subprocess substitutes only the external GitHub service, never an ACStack module.
  writeFileSync(join(root, 'bin/gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('gh-calls.jsonl', JSON.stringify(args) + '\\n');
const issues = () => JSON.parse(fs.readFileSync('issues.json', 'utf8'));
const issue = (all) => all.find(item => String(item.number) === args[2]);
if (args[0] === 'issue' && args[1] === 'list') process.stdout.write(fs.readFileSync('issues.json'));
else if (args[0] === 'issue' && args[1] === 'view') process.stdout.write(JSON.stringify({ body: issue(issues()).body }));
else if (args[0] === 'issue' && args[1] === 'edit') { const all = issues(); issue(all).body = fs.readFileSync(0, 'utf8'); fs.writeFileSync('issues.json', JSON.stringify(all)); }
else if (args[0] === 'issue' && args[1] === 'close') {
  if (fs.existsSync('fail-close') || fs.existsSync('fail-close-' + args[2])) { console.error('close failed'); process.exit(1); }
  const all = issues(); Object.assign(issue(all), { state: 'CLOSED', stateReason: 'COMPLETED' }); fs.writeFileSync('issues.json', JSON.stringify(all));
} else { console.error('Unexpected gh invocation: ' + args.join(' ')); process.exit(1); }
`);
  chmodSync(join(root, 'bin/gh'), 0o755);
  nodes(root, tracker, list);
  return root;
}
function nodes(root: string, tracker: Tracker, list: Node[]) {
  if (tracker === 'files') {
    const directory = join(root, '.acstack/maps/demo');
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    for (const node of list) writeFileSync(join(directory, `${node.id}-node.md`), `---\nstatus: ${node.status}\nmode: ${node.mode ?? 'hitl'}\nkind: ${node.kind}\nlabel: Node ${node.id}\n${node.answers ? `answers: "${node.answers}"\n` : ''}blocked-by: []\n---\n\n# Node ${node.id}\n\n${node.body ?? ''}\n`);
  } else {
    writeFileSync(join(root, 'issues.json'), JSON.stringify(list.map(node => ({
      number: Number(node.id), title: `Node ${node.id}`,
      body: `map: demo · root: ${node.answers ? '#101' : 'this'}${node.answers ? ` · answers: #${node.answers}` : ''} · label: Node ${node.id}\n\n${node.body ?? ''}`,
      labels: ['map:demo', `kind:${node.kind}`, ...(!node.answers ? ['root-node'] : []), ...(node.mode === 'afk' ? ['afk'] : []), ...(node.status === 'fog' ? ['fog'] : [])].map(name => ({ name })),
      state: ['resolved', 'out-of-scope'].includes(node.status) ? 'CLOSED' : 'OPEN', stateReason: node.status === 'out-of-scope' ? 'NOT_PLANNED' : node.status === 'resolved' ? 'COMPLETED' : '',
      url: `https://github.com/acme/fixture/issues/${node.id}`,
    }))));
  }
}
const fileNode = (root: string, id: string) => readFileSync(join(root, '.acstack/maps/demo', `${id}-node.md`), 'utf8');
const ghCalls = (root: string) => existsSync(join(root, 'gh-calls.jsonl')) ? readFileSync(join(root, 'gh-calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : [];
function env(root: string): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'bin'), HOME: root, XDG_CONFIG_HOME: root, GH_REPO: 'acme/fixture', NO_COLOR: '1' };
  delete value.SSH_CONNECTION;
  return value;
}
function cli(root: string, args: string[]) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, env: env(root), encoding: 'utf8', timeout: 10_000 });
}
function status(root: string): Status {
  const result = cli(root, ['design-review', 'status', 'demo']);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Status;
}
function tuple(value: Tuple): Tuple {
  return { sourceRevision: value.sourceRevision, reviewRevision: value.reviewRevision, commentsDigest: value.commentsDigest, mapInputsDigest: value.mapInputsDigest };
}
function reconcile(root: string, payload: unknown) {
  writeFileSync(join(root, 'receipt-input.json'), JSON.stringify(payload));
  return cli(root, ['design-review', 'reconcile', 'demo', '--input', 'receipt-input.json']);
}
function disposition(comments: number[], outcome = 'retained') {
  return { comments, outcome, rationale: 'Keep the documented local storage decision' };
}
function accepted(result: ReturnType<typeof cli>) { expect(result.status, result.stdout + result.stderr).toBe(0); }
function rejected(result: ReturnType<typeof cli>, explanation: string) {
  expect(result.error, explanation).toBeUndefined();
  expect(result.status, explanation + '\n' + result.stdout + result.stderr).not.toBe(0);
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
async function request(url: URL | string, init: RequestInit = {}) {
  // Synchronous CLI calls can outlast idle sockets before the client handles their close events.
  const headers = new Headers(init.headers);
  headers.set('Connection', 'close');
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(5_000) });
}
async function start(root: string) {
  // Allocate through port 0 without requiring the public CLI to accept --port 0.
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No allocated TCP port');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [bin, 'design-doc', 'demo', '--port', String(address.port)], { cwd: root, env: env(root), stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  let url = '';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    url = stripVTControlCharacters(output).match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s]*/)?.[0] ?? '';
    if (url) break;
    if (child.exitCode !== null) throw new Error(`design-doc exited: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!url) throw new Error(`No review URL: ${output}`);
  const page = await request(url);
  expect(page.status).toBe(200);
  const html = await page.text();
  const meta = html.match(/<meta\b[^>]*>/g)?.find(tag => /\bname=["']acstack-review-token["']/.test(tag));
  const token = meta?.match(/\bcontent=["']([^"']+)["']/)?.[1];
  if (!token) throw new Error('Missing review authentication token');
  const headers = { 'x-review-token': token, 'content-type': 'application/json', origin: new URL(url).origin };
  const api = new URL('/api/design-review', url);
  const annotations = new URL('/api/annotations', url);
  async function get<T>(path: URL): Promise<T> {
    const response = await request(path, { headers });
    expect(response.status).toBe(200);
    return await response.json() as T;
  }
  const post = (path: URL, value: unknown) => request(path, { method: 'POST', headers, body: JSON.stringify(value) });
  return {
    child, html, api, headers, get: () => get<Status>(api), comments: () => get<Snapshot>(annotations), save: (value: unknown) => post(annotations, value),
    approve: (expected: Tuple) => post(api, { decision: 'approved', expected: tuple(expected) }),
    answer: (expected: Tuple, body: Record<string, unknown>) => post(api, { ...body, expected: tuple(expected) }),
    lock: (expected: Tuple, id: string, capture?: Record<string, unknown>) => post(api, { lock: id, ...(capture && { capture }), expected: tuple(expected) }),
  };
}
function annotation(snapshot: Snapshot, comment = 'Keep records local') {
  return { packVersion: snapshot.packVersion, target: { type: 'node', id: '102' }, selectedText: 'Runs commands', comment };
}
async function savedComments(server: Awaited<ReturnType<typeof start>>) {
  const initial = await server.comments();
  const annotations = [annotation(initial), annotation(initial, 'Do not contact a tracker from the loader')];
  expect((await server.save({ ...initial, annotations })).ok).toBe(true);
  return annotations;
}
function denied(response: Response) { expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500); }

describe('map-sourced design lifecycle through the shipped CLI and HTTP', () => {
  it('keeps authenticated HTTP requests usable after the test client blocks beyond the idle timeout', async () => {
    const server = await start(fixture());
    const before = await server.get();
    const blocked = spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000)'], { timeout: 10_000 });
    expect(blocked.error).toBeUndefined();
    expect(blocked.status).toBe(0);
    expect(server.child.exitCode).toBeNull();
    expect(tuple(await server.get())).toEqual(tuple(before));
  }, 20_000);

  it.each<Tracker>(['files', 'github'])('%s: answering resolves the question through the tracker, then approval locks every element', async tracker => {
    const root = fixture(tracker, [...base(), { id: '104', kind: 'decision', status: 'open', answers: '102', body: question('choices: [Yes, No]\nmultiple: true') }]);
    const server = await start(root);
    const before = await server.get();
    expect(before.openQuestions).toEqual(['104']);
    expect(before.approval.reason).toBe('Open questions target this design');
    denied(await server.approve(before));
    denied(await server.answer({ ...before, mapInputsDigest: '0'.repeat(64) }, { questionId: '104', answer: '', choices: ['Yes'] }));
    denied(await server.answer(before, { questionId: '104', answer: '', choices: ['Maybe'] }));
    const answered = await server.answer(before, { questionId: '104', answer: 'Only on conflict', choices: ['Yes'] });
    expect(answered.status, await answered.clone().text()).toBe(200);
    const after = await server.get();
    expect(after.openQuestions).toEqual([]);
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.mapInputsDigest).not.toBe(before.mapInputsDigest);
    if (tracker === 'files') {
      expect(fileNode(root, '104')).toMatch(/^status: resolved$/m);
      expect(fileNode(root, '104')).toContain('## Answer\n\n- Yes\n- Other: Only on conflict');
    } else {
      const issue = (JSON.parse(readFileSync(join(root, 'issues.json'), 'utf8')) as Array<{ number: number; body: string; state: string }>).find(item => item.number === 104)!;
      expect(issue.state).toBe('CLOSED');
      expect(issue.body).toContain('## Answer\n\n- Yes\n- Other: Only on conflict');
      expect(issue.body.startsWith('map: demo')).toBe(true);
      expect(ghCalls(root).filter(args => args[1] !== 'list')).toEqual([
        ['issue', 'view', '104', '--json', 'body'], ['issue', 'edit', '104', '--body-file', '-'], ['issue', 'close', '104', '--reason', 'completed'],
      ]);
    }
    denied(await server.answer(after, { questionId: '104', answer: 'Again', choices: [] }));
    expect((await server.approve(after)).ok).toBe(true);
    const approved = await server.get();
    expect(approved.approval.valid).toBe(true);
    expect(approved.locked.sort()).toEqual(['102', '103']);
    if (tracker === 'files') for (const id of ['102', '103']) expect(fileNode(root, id)).toMatch(/^status: resolved$/m);
    else expect(ghCalls(root).filter(args => args[1] === 'close').map(args => args[2])).toEqual(['104', '102', '103']);
  }, 30_000);

  it('retries a GitHub answer whose close failed without appending the answer twice', async () => {
    const root = fixture('github', [...base(), { id: '104', kind: 'decision', status: 'open', answers: '102', body: question('{}') }]);
    const server = await start(root);
    writeFileSync(join(root, 'fail-close'), '');
    const response = await server.answer(await server.get(), { questionId: '104', answer: 'Keep it' });
    expect(response.ok).toBe(false);
    rmSync(join(root, 'fail-close'));
    expect((await server.answer(await server.get(), { questionId: '104', answer: 'Keep it' })).ok).toBe(true);
    const body = (JSON.parse(readFileSync(join(root, 'issues.json'), 'utf8')) as Array<{ number: number; body: string }>).find(item => item.number === 104)!.body;
    expect(body.split('## Answer').length).toBe(2);
    expect(ghCalls(root).filter(args => args[1] === 'edit')).toHaveLength(1);
  }, 30_000);

  it('holds approval on every open node targeting an element, in any mode, and on nothing else', async () => {
    const root = fixture('files', [...base(),
      { id: '104', kind: 'research', status: 'open', mode: 'afk', answers: '103' },
      { id: '105', kind: 'decision', status: 'fog', answers: '102' },
      { id: '106', kind: 'decision', status: 'open', answers: '101' },
    ]);
    const server = await start(root);
    const blocked = await server.get();
    expect(blocked.blockers).toEqual([
      { kind: 'question', targetId: '103', label: 'Node 104', nodeId: '104' },
      { kind: 'question', targetId: '102', label: 'Node 105', nodeId: '105' },
    ]);
    expect(blocked.openQuestions).toEqual([]);
    // Research and fog stay on the map; the page cannot answer them.
    denied(await server.answer(blocked, { questionId: '104', answer: 'Done' }));
    nodes(root, 'files', [...base(), { id: '104', kind: 'research', status: 'resolved', mode: 'afk', answers: '103' }, { id: '105', kind: 'decision', status: 'out-of-scope', answers: '102' }, { id: '106', kind: 'decision', status: 'open', answers: '101' }]);
    const clear = await server.get();
    expect(clear.blockers).toEqual([]);
    expect((await server.approve(clear)).ok).toBe(true);
  }, 30_000);

  it('locks one element from the page, unapproves it when its config changes, and re-approves it', async () => {
    const root = fixture();
    const server = await start(root);
    const before = await server.get();
    expect((await server.lock(before, '103', { variant: 'compact', tweaks: { density: 2 } })).ok).toBe(true);
    const review = JSON.parse(readFileSync(before.reviewPath, 'utf8')) as { lifecycle: { locks: Record<string, { capture?: unknown }> } };
    expect(review.lifecycle.locks['103'].capture).toEqual({ variant: 'compact', tweaks: { density: 2 } });
    const after = await server.get();
    expect(after.locked).toEqual(['103']);
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(fileNode(root, '103')).toMatch(/^status: resolved$/m);
    denied(await server.lock(after, '103'));
    denied(await server.lock(after, '101'));
    accepted(cli(root, ['design-doc', 'demo', '--check']));
    writeFileSync(join(root, '.acstack/maps/demo/103-node.md'), fileNode(root, '103').replace('kind: store', 'kind: store\nchannels: [web]'));
    // A tuple from before the edit names the old design, so it can no longer lock or answer.
    denied(await server.lock(after, '102'));
    const failed = cli(root, ['design-doc', 'demo', '--check']);
    rejected(failed, 'changed element');
    expect(failed.stderr).toContain('Changed since the user approved: 103');
    // The digest decides; the tracker node stays resolved.
    expect(fileNode(root, '103')).toMatch(/^status: resolved$/m);
    await stop(server.child);
    const reopened = await start(root);
    const changed = await reopened.get();
    expect(changed.locked).toEqual([]);
    expect(changed.blockers).toEqual([{ kind: 'changed', targetId: '103', label: 'Node 103', nodeId: '103' }]);
    expect(changed.approval.reason).toBe('Changed elements need re-approval');
    denied(await reopened.approve(changed));
    expect((await reopened.lock(changed, '103')).ok).toBe(true);
    expect((await reopened.get()).blockers).toEqual([]);
    accepted(cli(root, ['design-doc', 'demo', '--check']));
    // An agent re-approves only on the user's instruction, through the CLI.
    writeFileSync(join(root, '.acstack/maps/demo/103-node.md'), fileNode(root, '103').replace('channels: [web]', 'channels: [cli]'));
    rejected(cli(root, ['design-doc', 'demo', '--check']), 'changed again');
    accepted(cli(root, ['design-review', 'approve-element', 'demo', '103']));
    accepted(cli(root, ['design-doc', 'demo', '--check']));
    rejected(cli(root, ['design-review', 'approve-element', 'demo', '103']), 'already approved');
    expect(status(root).blockers).toEqual([]);
  }, 30_000);

  it('finishes an approval that failed midway without resolving any node twice', async () => {
    const root = fixture('github');
    const server = await start(root);
    writeFileSync(join(root, 'fail-close-103'), '');
    const first = await server.approve(await server.get());
    expect(first.ok).toBe(false);
    const halfway = await server.get();
    expect(halfway.locked).toEqual(['102']);
    expect(halfway.approval.valid).toBe(false);
    rmSync(join(root, 'fail-close-103'));
    expect((await server.approve(halfway)).ok).toBe(true);
    const done = await server.get();
    expect(done.approval.valid).toBe(true);
    expect(done.locked.sort()).toEqual(['102', '103']);
    expect(ghCalls(root).filter(args => args[1] === 'close').map(args => args[2])).toEqual(['102', '103', '103']);
    const review = JSON.parse(readFileSync(done.reviewPath, 'utf8')) as { lifecycle: { locks: Record<string, { config: string }> } };
    expect(Object.keys(review.lifecycle.locks).sort()).toEqual(['102', '103']);
  }, 30_000);

  it('requires every comment exactly once with a rationale and a current tuple', async () => {
    const root = fixture();
    const server = await start(root);
    await savedComments(server);
    const current = status(root);
    const valid = { ...tuple(current), decisions: [disposition([0], 'applied'), disposition([1])] };
    const attempts: Array<[string, unknown]> = [
      ['missing comment', { ...valid, decisions: [valid.decisions[0]] }],
      ['unknown comment', { ...valid, decisions: [disposition([0, 1, 2])] }],
      ['duplicate comment', { ...valid, decisions: [...valid.decisions, disposition([0])] }],
      ['missing rationale', { ...valid, decisions: [{ comments: [0, 1], outcome: 'retained' }] }],
      ['unknown outcome', { ...valid, decisions: [disposition([0, 1], 'ignored')] }],
      ['contributions are gone', { ...valid, decisions: [{ ...disposition([0, 1]), contributions: [] }] }],
    ];
    for (const key of ['sourceRevision', 'commentsDigest', 'mapInputsDigest'] as const) attempts.push([`stale ${key}`, { ...valid, [key]: '0'.repeat(64) }]);
    for (const [label, payload] of attempts) {
      rejected(reconcile(root, payload), label);
      expect(status(root).approval.valid, label).toBe(false);
    }
    accepted(reconcile(root, valid));
    const approval = await server.approve(await server.get());
    expect(approval.status, await approval.clone().text()).toBe(200);
  }, 30_000);

  it('preserves approval across restarts and rejects stale pages after the map changes', async () => {
    const root = fixture();
    const server = await start(root);
    expect(server.html).toContain('Approve this version');
    const initial = await server.get();
    for (const key of ['sourceRevision', 'commentsDigest', 'mapInputsDigest'] as const) denied(await server.approve({ ...initial, [key]: '0'.repeat(64) }));
    expect((await server.approve(initial)).ok).toBe(true);
    expect((await server.get()).approval.valid).toBe(true);
    await stop(server.child);
    const resumed = await start(root);
    const shown = await resumed.get();
    expect(shown.approval.valid).toBe(true);
    writeFileSync(join(root, '.acstack/maps/demo/102-node.md'), fileNode(root, '102').replace('Runs commands.', 'Runs new commands.'));
    expect(status(root).approval.valid).toBe(false);
    // The page's tuple names the design it showed, so it cannot approve the changed one.
    denied(await resumed.approve(shown));
    // The live server rebuilds and pushes the changed design; that revision needs its own approval.
    await vi.waitFor(async () => expect((await resumed.get()).sourceRevision).not.toBe(shown.sourceRevision), { timeout: 5_000 });
    expect((await resumed.get()).approval.valid).toBe(false);
    expect((await resumed.approve(await resumed.get())).ok).toBe(true);
  }, 30_000);

  it('authenticates lifecycle requests and keeps saved feedback intact', async () => {
    const root = fixture();
    const server = await start(root);
    const current = await server.get();
    for (const init of [
      {}, { headers: { 'x-review-token': 'wrong' } },
      { method: 'POST', body: JSON.stringify({ decision: 'approved', expected: tuple(current) }) },
      { method: 'POST', body: JSON.stringify({ lock: '102', expected: tuple(current) }) },
    ]) denied(await request(server.api, init));
    denied(await request(server.api, { method: 'POST', headers: server.headers, body: '{broken' }));
    expect(fileNode(root, '102')).toMatch(/^status: open$/m);
    const comments = await savedComments(server);
    const snapshot = await server.comments();
    for (const bad of [
      { ...snapshot, annotations: [{ ...comments[0], unexpected: true }] },
      { ...snapshot, annotations: [{ ...comments[0], target: { type: 'node', id: 'missing' } }] },
    ]) {
      denied(await server.save(bad));
      expect(await server.comments()).toEqual(snapshot);
    }
    denied(await server.approve(await server.get()));
  }, 30_000);

  it('checks a design doc without serving it, failing on contradictions and warning on oddities', () => {
    const root = fixture('files', [...base(), { id: '104', kind: 'element', status: 'fog', answers: '101', body: element('kind: actor\nconnections: [{to: 102, direction: one-way, label: Uses}]') }]);
    const checked = cli(root, ['design-doc', 'demo', '--check']);
    accepted(checked);
    expect(checked.stderr).toContain('warning: Element 104 is fog; it shows as loose');
    expect(checked.stdout).toContain('3 elements');
    nodes(root, 'files', [...base(), { id: '104', kind: 'element', status: 'open', answers: '101', body: element('kind: actor') }]);
    const failed = cli(root, ['design-doc', 'demo', '--check']);
    rejected(failed, 'isolated element');
    expect(failed.stderr).toContain('Element 104 has no connection or parent');
    expect(readdirSync(join(root, '.acstack')).sort()).toEqual(['maps', 'project.yaml']);
  });
});
