import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

// Black-box contract tests: the parent rebuilds cli/dist before the green run.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];
type Tuple = { sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string };
type Status = Tuple & { planning: { tracker: Tracker; map: string } | null; reviewPath: string; contributions: unknown[]; blockingQuestions: unknown[]; approval: { valid: boolean; reason?: string } };
type Snapshot = { packVersion: string; revision: number; annotations: Record<string, unknown>[] };
type Proposal = { id: string; designId: string; targets: string[]; statement: string };
type Node = { id: string; kind: string; status: string; answers?: string; body?: string };
type Tracker = 'files' | 'github';
const proposal: Proposal = { id: 'storage', designId: 'example', targets: ['app'], statement: 'Keep records local' };
function block(items: unknown = [proposal]) { return `## Design contributions\n\n\`\`\`json\n${JSON.stringify(items)}\n\`\`\`\n`; }
function fixture(tracker?: Tracker) {
  const root = mkdtempSync(join(tmpdir(), 'design-lifecycle-'));
  roots.push(root);
  mkdirSync(join(root, '.acstack'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, '.acstack/project.yaml'), `name: lifecycle-test\nworkflow:\n  maps:\n    tracker: ${tracker ?? 'files'}\n`);
  writeFileSync(join(root, 'design.yaml'), `id: example\nname: Example\nsummary: Review this design\nelements: [app.yaml]\ndetail: detail.md\n${tracker ? `planning: {tracker: ${tracker}, map: demo}\n` : ''}`);
  writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs commands\nkind: component\n');
  writeFileSync(join(root, 'detail.md'), '# Details\n\nKeep authored inputs.\n');
  // A real subprocess substitutes only the external GitHub service, never an ACStack module.
  writeFileSync(join(root, 'bin/gh'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync('gh-calls.jsonl', JSON.stringify(args) + '\\n');\nif (args[0] === 'issue' && args[1] === 'list') process.stdout.write(fs.readFileSync('issues.json'));\nelse if (args[0] === 'repo' && args[1] === 'view') process.stdout.write(JSON.stringify({nameWithOwner:'acme/fixture'}));\nelse { console.error('Unexpected gh invocation: ' + args.join(' ')); process.exit(1); }\n`);
  chmodSync(join(root, 'bin/gh'), 0o755);
  return root;
}
function env(root: string): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'bin'), HOME: root, XDG_CONFIG_HOME: root, GH_REPO: 'acme/fixture', NO_COLOR: '1' };
  delete value.SSH_CONNECTION;
  return value;
}
function cli(root: string, args: string[]) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, env: env(root), encoding: 'utf8', timeout: 10_000 });
}
function success(root: string, args: string[]) {
  const result = cli(root, args);
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.stdout;
}
function status(root: string, review?: string): Status {
  return JSON.parse(success(root, ['design-review', 'status', 'design.yaml', ...(review ? ['--review-file', review] : [])])) as Status;
}
function tuple(value: Tuple): Tuple {
  return { sourceRevision: value.sourceRevision, reviewRevision: value.reviewRevision, commentsDigest: value.commentsDigest, mapInputsDigest: value.mapInputsDigest };
}
function reviewPath(root: string, value: Status) { return isAbsolute(value.reviewPath) ? value.reviewPath : join(root, value.reviewPath); }
function reconcile(root: string, payload: unknown, review?: string) {
  writeFileSync(join(root, 'receipt-input.json'), JSON.stringify(payload));
  return cli(root, ['design-review', 'reconcile', 'design.yaml', '--input', 'receipt-input.json', ...(review ? ['--review-file', review] : [])]);
}
function disposition(comments: number[] = [], contributions: string[] = [], outcome = 'retained') {
  return { comments, contributions, outcome, rationale: 'Keep the documented local storage decision' };
}
function accepted(result: ReturnType<typeof cli>) { expect(result.status, result.stdout + result.stderr).toBe(0); }
function rejected(result: ReturnType<typeof cli>, explanation: string) {
  expect(result.error, explanation).toBeUndefined();
  expect(result.status, explanation + '\n' + result.stdout + result.stderr).not.toBe(0);
  expect(result.stdout + result.stderr, explanation).toMatch(/invalid|stale|missing|unknown|duplicate|disposition|rationale|canonical|review|contribution|map|provenance|cycle|exist/i);
}
function nodes(root: string, tracker: Tracker, list: Node[]) {
  list = list.map(node => node.kind === 'destination' && node.body === undefined ? { ...node, body: 'Design entry: design.yaml' } : node);
  if (tracker === 'files') {
    const directory = join(root, '.acstack/maps/demo');
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    for (const node of list) writeFileSync(join(directory, `${node.id}-node.md`), `---\nstatus: ${node.status}\nmode: hitl\nkind: ${node.kind}\nlabel: Node ${node.id}\n${node.answers ? `answers: "${node.answers}"\n` : ''}blocked-by: []\n---\n\n# Node ${node.id}\n\n${node.body ?? ''}\n`);
  } else {
    writeFileSync(join(root, 'issues.json'), JSON.stringify(list.map(node => ({
      number: Number(node.id), title: `Node ${node.id}`,
      body: `map: demo · root: ${node.answers ? '#101' : 'this'}${node.answers ? ` · answers: #${node.answers}` : ''} · label: Node ${node.id}\n\n${node.body ?? ''}`,
      labels: ['map:demo', `kind:${node.kind}`, ...(!node.answers ? ['root-node'] : []), ...(node.status === 'out-of-scope' ? ['out-of-scope'] : [])].map(name => ({ name })),
      state: ['resolved', 'out-of-scope'].includes(node.status) ? 'CLOSED' : 'OPEN', stateReason: node.status === 'out-of-scope' ? 'NOT_PLANNED' : node.status === 'resolved' ? 'COMPLETED' : '',
      url: `https://github.com/acme/fixture/issues/${node.id}`,
    }))));
  }
}
function mapNodes(body = block()): Node[] {
  return [{ id: '101', kind: 'destination', status: 'open' }, { id: '102', kind: 'work', status: 'open', answers: '101', body }];
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
  return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
}
async function start(root: string) {
  // Allocate through port 0 without requiring the public CLI to accept --port 0.
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No allocated TCP port');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [bin, 'design-doc', 'design.yaml', '--port', String(address.port)], { cwd: root, env: env(root), stdio: ['ignore', 'pipe', 'pipe'] });
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
  expect(new URL(url).port).not.toBe('19990');
  const page = await request(url);
  expect(page.status).toBe(200);
  const html = await page.text();
  const meta = html.match(/<meta\b[^>]*>/g)?.find(tag => /\bname=["']acstack-review-token["']/.test(tag));
  const token = meta?.match(/\bcontent=["']([^"']+)["']/)?.[1];
  if (!token) throw new Error('Missing review authentication token');
  const headers = { 'x-review-token': token, 'content-type': 'application/json' };
  const api = new URL('/api/design-review', url);
  const annotations = new URL('/api/annotations', url);
  async function get<T>(path: URL): Promise<T> {
    const response = await request(path, { headers });
    expect(response.status).toBe(200);
    return await response.json() as T;
  }
  const post = (path: URL, value: unknown) => request(path, { method: 'POST', headers, body: JSON.stringify(value) });
  return { child, html, api, headers, annotations, get: () => get<Status>(api), comments: () => get<Snapshot>(annotations), save: (value: unknown) => post(annotations, value), approve: (expected: Tuple) => post(api, { decision: 'approved', expected: tuple(expected) }) };
}
function annotation(snapshot: Snapshot, comment = 'Keep records local') {
  return { packVersion: snapshot.packVersion, target: { type: 'node', id: 'app' }, selectedText: 'Runs commands', comment };
}
async function savedComments(server: Awaited<ReturnType<typeof start>>) {
  const initial = await server.comments();
  const annotations = [annotation(initial), annotation(initial, 'Do not contact a tracker from the loader')];
  expect((await server.save({ ...initial, annotations })).ok).toBe(true);
  expect(await server.comments()).toEqual({ ...initial, revision: initial.revision + 1, annotations });
  return annotations;
}
function denied(response: Response) { expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500); }

describe('authored design lifecycle through the shipped CLI and HTTP', () => {
  it('rejects malformed reconciliation JSON before creating canonical review state', () => {
    const root = fixture();
    const directory = join(root, '.acstack/design-reviews');
    expect(existsSync(directory)).toBe(false);
    writeFileSync(join(root, 'receipt-input.json'), '{"broken":');
    const result = cli(root, ['design-review', 'reconcile', 'design.yaml', '--input', 'receipt-input.json']);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/JSON|receipt-input\.json/i);
    expect(result.stdout + result.stderr).toMatch(/parse|unexpected|invalid|syntax|expected/i);
    expect(existsSync(directory)).toBe(false);
  });

  it('reports null planning for an unbound design', () => {
    expect(status(fixture()).planning).toBeNull();
  });

  it.each<Tracker>(['files', 'github'])('%s status reports the actual bound map even when another map root references the same entry', tracker => {
    const root = fixture(tracker);
    nodes(root, tracker, mapNodes());
    // Map B (demo) is reciprocal; an active map A can still point at its entry.
    if (tracker === 'files') {
      const directory = join(root, '.acstack/maps/active-a');
      mkdirSync(directory, { recursive: true });
      cpSync(join(root, '.acstack/maps/demo/101-node.md'), join(directory, '201-node.md'));
    } else {
      const issues = JSON.parse(readFileSync(join(root, 'issues.json'), 'utf8')) as Array<{ number: number; body: string; labels: Array<{ name: string }>; url: string }>;
      const boundRoot = issues[0];
      issues.push({
        ...boundRoot, number: 201, body: boundRoot.body.replace('map: demo', 'map: active-a'),
        labels: boundRoot.labels.map(label => ({ name: label.name === 'map:demo' ? 'map:active-a' : label.name })),
        url: 'https://github.com/acme/fixture/issues/201',
      });
      writeFileSync(join(root, 'issues.json'), JSON.stringify(issues));
    }
    expect(status(root).planning).toEqual({ tracker, map: 'demo' });
  });

  it('reports an unapproved exact revision and preserves it across unrelated presentation edits', () => {
    const root = fixture();
    const first = status(root);
    expect(first.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toMatchObject({ reviewRevision: 0, contributions: [], blockingQuestions: [], approval: { valid: false } });
    expect(first.commentsDigest).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(root, 'README.md'), 'Generated presentation\n');
    writeFileSync(join(root, 'review.html'), '<h1>Different presentation</h1>');
    expect(tuple(status(root))).toEqual(tuple(first));
  });

  it('invalidates exact YAML bytes, supporting detail bytes, and filenames without relocating unchanged parsed snapshots', () => {
    const root = fixture();
    const first = status(root);
    const original = readFileSync(join(root, 'app.yaml'), 'utf8');
    writeFileSync(join(root, 'app.yaml'), original + '# source-only comment\n');
    const commented = status(root);
    expect(commented.sourceRevision).not.toBe(first.sourceRevision);
    expect(commented.reviewPath).toBe(first.reviewPath);
    writeFileSync(join(root, 'app.yaml'), original.replaceAll('\n', '\r\n'));
    expect(status(root).sourceRevision).not.toBe(first.sourceRevision);
    writeFileSync(join(root, 'app.yaml'), original);
    expect(status(root).sourceRevision).toBe(first.sourceRevision);
    writeFileSync(join(root, 'detail.md'), '# Details\n\nDifferent authored detail.\n');
    expect(status(root).sourceRevision).not.toBe(first.sourceRevision);
    writeFileSync(join(root, 'detail.md'), '# Details\n\nKeep authored inputs.\n');
    renameSync(join(root, 'app.yaml'), join(root, 'renamed.yaml'));
    writeFileSync(join(root, 'design.yaml'), readFileSync(join(root, 'design.yaml'), 'utf8').replace('app.yaml', 'renamed.yaml'));
    expect(status(root).sourceRevision).not.toBe(first.sourceRevision);
  });

  it.each<Tracker>(['files', 'github'])('%s adapter tracks contributions and provenance, not implementation completion', async tracker => {
    const root = fixture(tracker);
    nodes(root, tracker, mapNodes(block([proposal, { ...proposal, id: 'foreign', designId: 'another-design' }])));
    const initial = status(root);
    expect(initial.contributions).toHaveLength(1);
    expect(JSON.stringify(initial.contributions)).toContain('102/storage');
    expect(JSON.stringify(initial.contributions)).not.toContain('foreign');
    expect(initial.blockingQuestions).toEqual([]);
    const server = await start(root);
    denied(await server.approve(initial));
    accepted(reconcile(root, { ...tuple(initial), decisions: [disposition([], ['102/storage'])] }));
    expect((await server.approve(await server.get())).ok).toBe(true);
    const changed = mapNodes();
    changed[1].status = 'resolved';
    nodes(root, tracker, changed);
    expect(status(root).mapInputsDigest).toBe(initial.mapInputsDigest);
    expect(status(root).approval.valid).toBe(true);
    changed.push({ id: '103', kind: 'research', status: 'open', answers: '101' });
    changed[1].answers = '103';
    nodes(root, tracker, changed);
    expect(status(root).mapInputsDigest).not.toBe(initial.mapInputsDigest);
    expect(status(root).approval.valid).toBe(false);
    denied(await server.approve(initial));
    const provenanceDigest = status(root).mapInputsDigest;
    changed[1].body = block([{ ...proposal, statement: 'Keep records encrypted and local' }]);
    nodes(root, tracker, changed);
    expect(status(root).mapInputsDigest).not.toBe(provenanceDigest);
    expect(status(root).approval.valid).toBe(false);
    if (tracker === 'github') expect(readFileSync(join(root, 'gh-calls.jsonl'), 'utf8')).toContain('"issue","list"');
  }, 30_000);

  it.each<Tracker>(['files', 'github'])('%s adapter rejects invalid contributions, unavailable maps, and broken provenance', tracker => {
    const root = fixture(tracker);
    for (const [label, body] of [
      ['unknown target', block([{ ...proposal, targets: ['missing'] }])],
      ['duplicate ID', block([proposal, proposal])],
      ['malformed JSON', '## Design contributions\n\n```json\n{broken\n```'],
      ['wrong payload', block({ id: 'not-an-array' })],
    ]) {
      nodes(root, tracker, mapNodes(body));
      rejected(cli(root, ['design-review', 'status', 'design.yaml']), label);
    }
    const broken = mapNodes();
    broken[1].answers = '999';
    nodes(root, tracker, broken);
    rejected(cli(root, ['design-review', 'status', 'design.yaml']), 'missing provenance parent');
    broken[1].answers = '103';
    broken.push({ id: '103', kind: 'work', status: 'open', answers: '102' });
    nodes(root, tracker, broken);
    rejected(cli(root, ['design-review', 'status', 'design.yaml']), 'cyclic provenance');
    nodes(root, tracker, []);
    rejected(cli(root, ['design-review', 'status', 'design.yaml']), 'unavailable bound map');
  }, 30_000);

  it('requires every comment and contribution exactly once with a rationale and a current tuple', async () => {
    const root = fixture('files');
    nodes(root, 'files', mapNodes());
    const server = await start(root);
    await savedComments(server);
    const current = status(root);
    const valid = { ...tuple(current), decisions: [disposition([0], ['102/storage'], 'applied'), disposition([1])] };
    const attempts: Array<[string, unknown]> = [
      ['missing comment', { ...valid, decisions: [valid.decisions[0]] }],
      ['missing contribution', { ...valid, decisions: [disposition([0, 1])] }],
      ['unknown comment', { ...valid, decisions: [disposition([0, 1, 2], ['102/storage'])] }],
      ['unknown contribution', { ...valid, decisions: [disposition([0, 1], ['102/storage', '102/nope'])] }],
      ['duplicate comment', { ...valid, decisions: [...valid.decisions, disposition([0])] }],
      ['duplicate contribution', { ...valid, decisions: [...valid.decisions, disposition([], ['102/storage'])] }],
      ['missing rationale', { ...valid, decisions: [{ comments: [0, 1], contributions: ['102/storage'], outcome: 'retained' }] }],
      ['blank rationale', { ...valid, decisions: [{ ...disposition([0, 1], ['102/storage']), rationale: '  ' }] }],
      ['unknown outcome', { ...valid, decisions: [disposition([0, 1], ['102/storage'], 'ignored')] }],
    ];
    for (const key of ['sourceRevision', 'commentsDigest', 'mapInputsDigest'] as const) attempts.push([`stale ${key}`, { ...valid, [key]: '0'.repeat(64) }]);
    attempts.push(['stale reviewRevision', { ...valid, reviewRevision: current.reviewRevision + 1 }]);
    for (const [label, payload] of attempts) {
      rejected(reconcile(root, payload), label);
      expect(tuple(status(root)), label).toEqual(tuple(current));
      expect(status(root).approval.valid, label).toBe(false);
    }
    accepted(reconcile(root, valid));
    expect((await server.approve(await server.get())).ok).toBe(true);
  }, 30_000);

  it('blocks needs-human and unresolved decisions while allowing unfinished work after explicit settlement', async () => {
    const root = fixture('files');
    const list = mapNodes();
    list.push({ id: '103', kind: 'decision', status: 'open', answers: '101' });
    nodes(root, 'files', list);
    const server = await start(root);
    const first = await server.get();
    expect(JSON.stringify(first.blockingQuestions)).toContain('103');
    accepted(reconcile(root, { ...tuple(first), decisions: [disposition([], ['102/storage'], 'needs-human')] }));
    denied(await server.approve(await server.get()));
    list[2].status = 'out-of-scope';
    nodes(root, 'files', list);
    expect((await server.get()).blockingQuestions).toEqual([]);
    denied(await server.approve(await server.get()));
    accepted(reconcile(root, { ...tuple(await server.get()), decisions: [disposition([], ['102/storage'], 'retained')] }));
    expect((await server.approve(await server.get())).ok).toBe(true);
    expect(status(root).approval.valid).toBe(true);
    const history = readFileSync(reviewPath(root, status(root)), 'utf8');
    expect(history).toContain('needs-human');
    expect(history).toContain('retained');
    await stop(server.child);
    expect((await (await start(root)).get()).approval.valid).toBe(true);
  }, 30_000);

  it.each(['needs-human', 'retained'])('carries selected historical %s feedback across later authored revisions without copying comments', async outcome => {
    const root = fixture();
    const original = await start(root);
    await savedComments(original);
    const oldPath = reviewPath(root, status(root));
    const oldBytes = readFileSync(oldPath, 'utf8');
    await stop(original.child);
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Revision B\nkind: component\n');
    accepted(reconcile(root, { ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], [], outcome)] }, oldPath));

    for (const revision of ['C', 'D']) {
      writeFileSync(join(root, 'app.yaml'), `id: app\nname: App\nsummary: Revision ${revision}\nkind: component\n`);
      const server = await start(root);
      const current = await server.get();
      expect((await server.comments()).annotations).toEqual([]);
      expect(current.approval.valid).toBe(false);
      denied(await server.approve(current));
      expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
      accepted(reconcile(root, { ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], [], 'retained')] }, oldPath));
      // Empty current snapshots must not become obligations requiring their own reconciliation.
      expect((await server.approve(await server.get())).ok).toBe(true);
      expect(status(root).approval.valid).toBe(true);
      expect((await server.comments()).annotations).toEqual([]);
      expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
      await stop(server.child);
    }
  }, 30_000);

  it.each<readonly [Tracker, string]>([
    ['files', 'missing'], ['files', 'mismatched'], ['files', 'duplicate'],
    ['github', 'missing'], ['github', 'mismatched'], ['github', 'duplicate'],
  ])('rejects %s map roots with %s reciprocal entry references without changing canonical evidence', async (tracker, mode) => {
    const root = fixture(tracker);
    nodes(root, tracker, mapNodes());
    const server = await start(root);
    accepted(reconcile(root, { ...tuple(await server.get()), decisions: [disposition([], ['102/storage'])] }));
    expect((await server.approve(await server.get())).ok).toBe(true);
    const approved = status(root);
    const path = reviewPath(root, approved);
    const before = readFileSync(path, 'utf8');
    const list = mapNodes();
    list[0].body = mode === 'missing' ? '' : mode === 'mismatched' ? 'Design entry: other.yaml' : 'Design entry: design.yaml\nDesign entry: other.yaml';
    writeFileSync(join(root, 'other.yaml'), readFileSync(join(root, 'design.yaml'), 'utf8'));
    nodes(root, tracker, list);
    rejected(cli(root, ['design-review', 'status', 'design.yaml']), 'invalid reciprocal root reference');
    rejected(reconcile(root, { ...tuple(approved), decisions: [disposition([], ['102/storage'])] }), 'invalid reciprocal root reconciliation');
    expect((await server.approve(approved)).ok).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(before);
  }, 30_000);

  it('reconciles older canonical feedback into current source without modifying the old snapshot', async () => {
    const root = fixture();
    const oldServer = await start(root);
    await savedComments(oldServer);
    const old = status(root);
    const path = reviewPath(root, old);
    await stop(oldServer.child);
    // Pre-lifecycle canonical snapshots remain accepted without new metadata.
    const legacy = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
    writeFileSync(path, JSON.stringify({ packVersion: legacy.packVersion, revision: legacy.revision, annotations: legacy.annotations }));
    const before = readFileSync(path, 'utf8');
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs updated commands\nkind: component\n');
    const current = status(root);
    const historical = status(root, path);
    expect(historical.sourceRevision).toBe(current.sourceRevision);
    expect(historical.reviewRevision).toBe(old.reviewRevision);
    accepted(reconcile(root, { ...tuple(historical), decisions: [disposition([0], [], 'applied'), disposition([1])] }, path));
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(reviewPath(root, current)).not.toBe(path);
    const receipt = readFileSync(reviewPath(root, current), 'utf8');
    expect(receipt).toContain(historical.commentsDigest);
    expect(receipt).toContain(current.sourceRevision);
    writeFileSync(join(root, 'unrelated.json'), before);
    rejected(cli(root, ['design-review', 'status', 'design.yaml', '--review-file', 'unrelated.json']), 'copied noncanonical JSON');
    expect(readFileSync(path, 'utf8')).toBe(before);
  }, 30_000);

  it('keeps historical needs-human feedback blocking an empty current review and rechecks later historical edits', async () => {
    const root = fixture();
    const oldServer = await start(root);
    await savedComments(oldServer);
    const oldStatus = status(root);
    const oldPath = reviewPath(root, oldStatus);
    const oldSnapshot = await oldServer.comments();
    await stop(oldServer.child);
    const oldBytes = readFileSync(oldPath, 'utf8');
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs revised commands\nkind: component\n');
    const server = await start(root);
    expect((await server.comments()).annotations).toEqual([]);
    const selected = status(root, oldPath);
    expect(selected.sourceRevision).not.toBe(oldStatus.sourceRevision);
    expect(selected.reviewRevision).toBe(oldSnapshot.revision);
    accepted(reconcile(root, {
      ...tuple(selected), decisions: [disposition([0], [], 'needs-human'), disposition([1])],
    }, oldPath));
    expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
    expect((await server.get()).approval.valid).toBe(false);
    denied(await server.approve(await server.get()));
    accepted(reconcile(root, {
      ...tuple(status(root, oldPath)), decisions: [disposition([0], [], 'applied'), disposition([1])],
    }, oldPath));
    expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
    expect((await server.approve(await server.get())).ok).toBe(true);
    expect((await server.get()).approval.valid).toBe(true);
    expect((await server.comments()).annotations).toEqual([]);

    // Simulate a valid save to the selected older canonical snapshot, not the current pack.
    writeFileSync(oldPath, JSON.stringify({
      ...oldSnapshot, revision: oldSnapshot.revision + 1,
      annotations: [{ ...oldSnapshot.annotations[0], comment: 'Require encryption before retaining local records' }, oldSnapshot.annotations[1]],
    }));
    const editedBytes = readFileSync(oldPath, 'utf8');
    const edited = status(root, oldPath);
    expect(edited.reviewRevision).toBe(oldSnapshot.revision + 1);
    expect(edited.commentsDigest).not.toBe(selected.commentsDigest);
    expect(status(root).approval.valid).toBe(false);
    expect((await server.get()).approval.valid).toBe(false);
    denied(await server.approve(await server.get()));
    accepted(reconcile(root, {
      ...tuple(edited), decisions: [disposition([0], [], 'retained'), disposition([1], [], 'applied')],
    }, oldPath));
    expect(readFileSync(oldPath, 'utf8')).toBe(editedBytes);
    expect((await server.approve(await server.get())).ok).toBe(true);
    expect((await server.get()).approval.valid).toBe(true);
    expect((await server.comments()).annotations).toEqual([]);
  }, 30_000);

  it.each(['map contribution change', 'new current comment'] as const)('preserves historical needs-human blockers after %s and current-only reconciliation', async change => {
    const root = fixture('files');
    nodes(root, 'files', mapNodes());
    const oldServer = await start(root);
    await savedComments(oldServer);
    const oldPath = reviewPath(root, status(root));
    await stop(oldServer.child);
    const oldBytes = readFileSync(oldPath, 'utf8');
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs updated commands\nkind: component\n');
    const server = await start(root);
    expect((await server.comments()).annotations).toEqual([]);
    accepted(reconcile(root, {
      ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], ['102/storage'], 'needs-human')],
    }, oldPath));
    expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
    denied(await server.approve(await server.get()));

    const beforeChange = await server.get();
    const currentIndices: number[] = [];
    if (change === 'map contribution change') {
      nodes(root, 'files', mapNodes(block([{ ...proposal, statement: 'Encrypt the local records' }])));
      expect((await server.get()).mapInputsDigest).not.toBe(beforeChange.mapInputsDigest);
    } else {
      const current = await server.comments();
      expect((await server.save({ ...current, annotations: [{ ...annotation(current), selectedText: 'Runs updated commands' }] })).ok).toBe(true);
      expect(await server.comments()).toMatchObject({ revision: current.revision + 1, annotations: [{ comment: 'Keep records local' }] });
      currentIndices.push(0);
    }
    accepted(reconcile(root, {
      ...tuple(await server.get()), decisions: [disposition(currentIndices, ['102/storage'], 'applied')],
    }));
    expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
    // Settling a different feedback snapshot must not erase the historical question.
    denied(await server.approve(await server.get()));
    expect((await server.get()).approval.valid).toBe(false);

    accepted(reconcile(root, {
      ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], ['102/storage'], 'retained')],
    }, oldPath));
    accepted(reconcile(root, {
      ...tuple(await server.get()), decisions: [disposition(currentIndices, ['102/storage'], 'applied')],
    }));
    expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
    expect((await server.approve(await server.get())).ok).toBe(true);
    expect((await server.get()).approval.valid).toBe(true);
  }, 30_000);

  it('keeps GitHub decisions with case-insensitive Map header keys visible and blocking until resolved', async () => {
    const root = fixture('github');
    const list: Node[] = [
      { id: '101', kind: 'destination', status: 'open' },
      { id: '103', kind: 'decision', status: 'open', answers: '101' },
    ];
    const writeIssues = () => {
      nodes(root, 'github', list);
      const issues = JSON.parse(readFileSync(join(root, 'issues.json'), 'utf8')) as Array<{ number: number; body: string }>;
      issues.find(issue => issue.number === 103)!.body = issues.find(issue => issue.number === 103)!.body.replace('map: demo', 'Map: demo');
      writeFileSync(join(root, 'issues.json'), JSON.stringify(issues));
    };
    writeIssues();
    const server = await start(root);
    const blocked = await server.get();
    expect(JSON.stringify(blocked.blockingQuestions)).toContain('103');
    expect(JSON.stringify(status(root).blockingQuestions)).toContain('103');
    denied(await server.approve(blocked));
    list[1].status = 'resolved';
    writeIssues();
    expect((await server.get()).blockingQuestions).toEqual([]);
    expect((await server.approve(await server.get())).ok).toBe(true);
    expect(status(root).approval.valid).toBe(true);
  }, 30_000);

  it('requires renewed human approval after reconciling changed historical feedback and exposes its digest in default status', async () => {
    const root = fixture();
    const oldServer = await start(root);
    await savedComments(oldServer);
    const oldPath = reviewPath(root, status(root));
    const oldSnapshot = await oldServer.comments();
    await stop(oldServer.child);
    const oldBytes = readFileSync(oldPath, 'utf8');
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs updated commands\nkind: component\n');
    const server = await start(root);
    accepted(reconcile(root, {
      ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], [], 'retained')],
    }, oldPath));
    expect(readFileSync(oldPath, 'utf8')).toBe(oldBytes);
    expect((await server.approve(await server.get())).ok).toBe(true);
    const approved = status(root);
    const approvedPage = await server.get();
    expect(approved.approval.valid).toBe(true);
    writeFileSync(oldPath, JSON.stringify({
      ...oldSnapshot, revision: oldSnapshot.revision + 1,
      annotations: [{ ...oldSnapshot.annotations[0], comment: 'Encrypt all local records before approval' }, oldSnapshot.annotations[1]],
    }));
    const editedBytes = readFileSync(oldPath, 'utf8');
    const changed = status(root);
    expect(changed.approval.valid).toBe(false);
    expect.soft(changed.commentsDigest, 'Default CLI tuple must expose changed historical feedback').not.toBe(approved.commentsDigest);
    expect.soft((await server.get()).commentsDigest, 'Page tuple must expose changed historical feedback').not.toBe(approvedPage.commentsDigest);
    accepted(reconcile(root, {
      ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], [], 'applied')],
    }, oldPath));
    expect(readFileSync(oldPath, 'utf8')).toBe(editedBytes);
    // Reconciliation settles feedback; it is not a renewed approval decision.
    expect.soft(status(root).approval.valid, 'An older approval must not become valid again after reconciliation').toBe(false);
    expect.soft((await server.get()).approval.valid, 'The page must still require a new approval action').toBe(false);
    expect((await server.approve(await server.get())).ok).toBe(true);
    expect(status(root).approval.valid).toBe(true);
  }, 30_000);

  it('rejects potentially truncated GitHub retrieval instead of approving a partial bound map', () => {
    const root = fixture('github');
    nodes(root, 'github', [{ id: '101', kind: 'destination', status: 'open' }]);
    const [boundRoot] = JSON.parse(readFileSync(join(root, 'issues.json'), 'utf8')) as Array<Record<string, unknown>>;
    const unrelated = Array.from({ length: 999 }, (_, index) => ({
      ...boundRoot, number: 200 + index, title: `Other map ${index}`,
      body: `map: other-${index} · root: this · label: Other map ${index}\n\nUnrelated repository issue.`,
      labels: [{ name: `map:other-${index}` }, { name: 'kind:destination' }, { name: 'root-node' }],
      url: `https://github.com/acme/fixture/issues/${200 + index}`,
    }));
    writeFileSync(join(root, 'issues.json'), JSON.stringify([boundRoot, ...unrelated]));
    const result = cli(root, ['design-review', 'status', 'design.yaml']);
    expect(result.error, result.stderr).toBeUndefined();
    expect.soft(result.status, 'A retrieval at its cap cannot establish complete map inputs').not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/incomplete|truncat|paginat|retrieval.{0,40}limit|limit.{0,40}(?:issue|map|reach)/i);
  });

  it('preserves approved historical feedback across checkout relocation and detects edits in the relocated history', async () => {
    const root = fixture();
    const oldServer = await start(root);
    await savedComments(oldServer);
    const oldPath = reviewPath(root, status(root));
    const oldSnapshot = await oldServer.comments();
    await stop(oldServer.child);
    writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs updated commands\nkind: component\n');
    const server = await start(root);
    accepted(reconcile(root, {
      ...tuple(status(root, oldPath)), decisions: [disposition([0, 1], [], 'retained')],
    }, oldPath));
    expect((await server.approve(await server.get())).ok).toBe(true);
    const approved = status(root);
    const selected = status(root, oldPath);
    expect(approved.approval.valid).toBe(true);
    await stop(server.child);

    const relocated = mkdtempSync(join(tmpdir(), 'design-lifecycle-relocated-'));
    roots.push(relocated);
    cpSync(root, relocated, { recursive: true });
    const relocatedOldPath = join(relocated, relative(root, oldPath));
    // Remove the original checkout so history cannot accidentally resolve back into it.
    rmSync(root, { recursive: true, force: true });
    const copied = status(relocated);
    expect(tuple(copied)).toEqual(tuple(approved));
    expect(copied.approval.valid).toBe(true);
    const copiedSelected = status(relocated, relocatedOldPath);
    expect(tuple(copiedSelected)).toEqual(tuple(selected));
    expect(copiedSelected.approval.valid).toBe(selected.approval.valid);
    writeFileSync(relocatedOldPath, JSON.stringify({
      ...oldSnapshot, revision: oldSnapshot.revision + 1,
      annotations: [{ ...oldSnapshot.annotations[0], comment: 'Require encryption in this copied checkout' }, oldSnapshot.annotations[1]],
    }));
    const edited = status(relocated);
    expect(edited.approval.valid).toBe(false);
    expect(edited.commentsDigest).not.toBe(copied.commentsDigest);
    expect(status(relocated, relocatedOldPath).reviewRevision).toBe(oldSnapshot.revision + 1);
  }, 30_000);

  it('preserves approval evidence across restarts, rejects stale pages, and retains comment history', async () => {
    const root = fixture();
    const server = await start(root);
    expect(server.html).toContain('Approve this version');
    const initial = await server.get();
    for (const key of ['sourceRevision', 'commentsDigest', 'mapInputsDigest'] as const) denied(await server.approve({ ...initial, [key]: '0'.repeat(64) }));
    denied(await server.approve({ ...initial, reviewRevision: initial.reviewRevision + 1 }));
    expect((await server.get()).approval.valid).toBe(false);
    expect((await server.approve(initial)).ok).toBe(true);
    expect((await server.get()).approval.valid).toBe(true);
    const path = reviewPath(root, status(root));
    const approved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(join(root, 'README.md'), 'Presentation only\n');
    expect(status(root).approval.valid).toBe(true);
    await stop(server.child);
    const resumed = await start(root);
    expect((await resumed.get()).approval.valid).toBe(true);
    const snapshot = await resumed.comments();
    const comment = annotation(snapshot);
    expect((await resumed.save({ ...snapshot, annotations: [comment] })).ok).toBe(true);
    expect((await resumed.get()).approval.valid).toBe(false);
    denied(await resumed.approve(initial));
    const fresh = await resumed.get();
    accepted(reconcile(root, { ...tuple(fresh), decisions: [disposition([0])] }));
    expect((await resumed.approve(await resumed.get())).ok).toBe(true);
    expect((await resumed.comments()).annotations).toEqual([comment]);
    writeFileSync(join(root, 'app.yaml'), readFileSync(join(root, 'app.yaml'), 'utf8') + '# exact new source\n');
    expect(status(root).approval.valid).toBe(false);
    // Even a fresh status tuple cannot let this old rendered page approve new bytes.
    denied(await resumed.approve(await resumed.get()));
    const after = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    // Preserve all metadata evidence without imposing an unspecified history field name.
    const metadata = Object.keys(approved).filter(key => !['packVersion', 'revision', 'annotations'].includes(key));
    expect(metadata.length).toBeGreaterThan(0);
    for (const key of metadata) {
      if (Array.isArray(approved[key])) expect(after[key]).toEqual(expect.arrayContaining(approved[key] as unknown[]));
    }
    expect(JSON.stringify(after)).toContain(initial.sourceRevision);
  }, 30_000);

  it('authenticates lifecycle requests and keeps strict annotation compatibility and saved feedback intact', async () => {
    const root = fixture();
    const server = await start(root);
    const current = await server.get();
    for (const init of [
      {}, { headers: { 'x-review-token': 'wrong' } },
      { method: 'POST', body: JSON.stringify({ decision: 'approved', expected: tuple(current) }) },
    ]) denied(await request(server.api, init));
    denied(await request(server.api, { method: 'POST', headers: server.headers, body: '{broken' }));
    denied(await request(server.api, { method: 'POST', headers: server.headers, body: JSON.stringify({ decision: 'approved', expected: {} }) }));
    expect((await server.get()).approval.valid).toBe(false);
    const comments = await savedComments(server);
    const snapshot = await server.comments();
    expect(Object.keys(snapshot).sort()).toEqual(['annotations', 'packVersion', 'revision']);
    for (const bad of [
      { ...snapshot, annotations: [{ ...comments[0], unexpected: true }] },
      { ...snapshot, annotations: [{ ...comments[0], target: { type: 'node', id: 'missing' } }] },
      { ...snapshot, packVersion: 'foreign' },
    ]) {
      denied(await server.save(bad));
      expect(await server.comments()).toEqual(snapshot);
    }
    denied(await server.approve(await server.get()));
    expect((await server.comments()).annotations).toEqual(comments);
  }, 30_000);
});
