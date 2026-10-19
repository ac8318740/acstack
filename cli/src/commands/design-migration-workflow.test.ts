import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { renderAlignmentPackHtml } from '../lib/alignment-pack-renderer.js';
import { AlignmentPackSchema, type ReviewAnnotation } from '../lib/alignment-packs.js';

// Black-box tests of the shipped CLI; rebuild dist before the green run.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];
type Snapshot = { packVersion: string; revision: number; annotations: ReviewAnnotation[] };
type Target = { type: string; id: string };
type Mapping = { from: Target; to: Target };
const oldVersions = ['checkout-redesign@map-v6', 'checkout-redesign@map-v7'];
const decisionBytes = 'ts\tnode\tdecision\twhy\tevidence\tresult\n2026-10-12T10:00:00Z\t002\tKeep local storage\tPrivacy\tapp.yaml:1\tRetained';

// Shape and identifiers come from committed alignment-feedback/renderer tests.
function legacyPack(packVersion: string) {
  return AlignmentPackSchema.parse({
    packVersion,
    source: { map: { id: 'checkout-redesign', version: packVersion.endsWith('v6') ? 'map-v6' : 'map-v7' }, references: [
      { id: 'spec-checkout', kind: 'spec', title: 'Checkout redesign spec', uri: 'specs/checkout.md#goals' },
    ] },
    graph: {
      groups: [{ id: 'group-payment', label: 'Payment experience', summary: 'Customers can pay with saved or new methods.' }],
      nodes: [{ id: 'node-saved-card', groupId: 'group-payment', label: 'Saved card payment', technicalLabel: 'vault-token charge', summary: 'Lets returning customers pay with a card they already trust.', sourceRefs: ['spec-checkout'] }],
      edges: [{ id: 'edge-saved-card-risk', fromNodeId: 'node-saved-card', toNodeId: 'node-saved-card', relationship: 'conflicts', label: 'Saved card risk needs review', summary: 'Stored cards need fraud and compliance review before rollout.', sourceRefs: ['spec-checkout'] }],
      aggregateEdges: [],
    },
    viewState: { globalDepth: 2, expandedGroups: ['group-payment'], semanticZoom: 'business' },
    reviewState: { approval: { packVersion, status: 'approved', approvedBy: `Legacy reviewer ${packVersion}`, approvedAt: '2026-10-12T10:00:00.000Z' } },
  });
}
function oldComment(type = 'node', id = 'node-saved-card', comment = 'Trust claim needs source evidence.'): ReviewAnnotation {
  return { packVersion: oldVersions[1], target: { type: type as ReviewAnnotation['target']['type'], id }, selectedText: 'card they already trust', sourceRef: 'spec-checkout', comment, author: 'Reviewer A', time: '2026-10-12T10:15:00.000Z' };
}
function environment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'bin'), HOME: root, XDG_CONFIG_HOME: join(root, 'config'), NO_COLOR: '1', ACSTACK_ALIGN_PORT: '0' };
  delete env.SSH_CONNECTION;
  return env;
}
function cli(root: string, args: string[]) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, env: environment(root), encoding: 'utf8', timeout: 8_000 });
}
function accepted(result: ReturnType<typeof cli>) {
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}
function json(root: string, name: string, value: unknown) { writeFileSync(join(root, name), JSON.stringify(value)); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-migration-'));
  roots.push(root);
  mkdirSync(join(root, '.acstack/alignment-packs/checkout-redesign'), { recursive: true });
  mkdirSync(join(root, '.acstack/decision-logs'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  // Local Git discovery only; no commits, remotes, or repository history changes.
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  expect(git.status, git.stderr).toBe(0);
  writeFileSync(join(root, '.acstack/project.yaml'), 'name: migration-test\n');
  writeFileSync(join(root, 'design.yaml'), 'id: example\nname: Example\nsummary: Authored design, not inferred architecture\nelements: [app.yaml, data.yaml]\n');
  writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Runs commands\nkind: component\nrelationships: [{id: reads, from: app, to: data, direction: bidirectional, label: Reads and writes}]\n');
  writeFileSync(join(root, 'data.yaml'), 'id: data\nname: Data\nsummary: Keeps records\nkind: store\nrelationships: [{id: reads, from: app, to: data, direction: bidirectional, label: Reads and writes}]\n');
  const legacy = join(root, '.acstack/alignment-packs/checkout-redesign');
  for (const version of oldVersions) writeFileSync(join(legacy, `${version}.html`), renderAlignmentPackHtml(legacyPack(version)));
  writeFileSync(join(legacy, 'annotations.jsonl'), JSON.stringify(oldComment()) + '\n');
  writeFileSync(join(root, '.acstack/decision-logs/checkout-redesign.tsv'), decisionBytes);
  const mapping: Mapping[] = [{ from: { type: 'node', id: 'node-saved-card' }, to: { type: 'node', id: 'app' } }];
  json(root, 'mapping.json', mapping);
  return { root, legacy, mapping };
}
function migrate(f: ReturnType<typeof fixture>, feedback = false, legacy = f.legacy) {
  return cli(f.root, ['design-review', 'migrate', 'design.yaml', '--legacy-dir', legacy, '--mapping', 'mapping.json', ...(feedback ? ['--feedback', 'feedback.json'] : [])]);
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
async function review(root: string) {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No allocated port');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  expect([19990, 6420]).not.toContain(address.port);
  const child = spawn(process.execPath, [bin, 'design-doc', 'design.yaml', '--port', String(address.port)], { cwd: root, env: environment(root), stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (!url) throw new Error(`No live review URL: ${output}`);
  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, url), { ...init, signal: AbortSignal.timeout(5_000) });
  const page = await request('/');
  expect(page.status).toBe(200);
  const html = await page.text();
  const meta = html.match(/<meta\b[^>]*>/g)?.find(tag => /\bname=["']acstack-review-token["']/.test(tag));
  const token = meta?.match(/\bcontent=["']([^"']+)["']/)?.[1];
  if (!token) throw new Error('Missing review token');
  const headers = { 'x-review-token': token, 'content-type': 'application/json' };
  return {
    child,
    get: async () => { const response = await request('/api/annotations', { headers }); expect(response.status).toBe(200); return await response.json() as Snapshot; },
    save: (value: Snapshot) => request('/api/annotations', { method: 'POST', headers, body: JSON.stringify(value) }),
    approve: (expected: unknown) => request('/api/design-review', { method: 'POST', headers, body: JSON.stringify({ decision: 'approved', expected }) }),
  };
}
async function seed(root: string) {
  const server = await review(root);
  const initial = await server.get();
  const annotations: ReviewAnnotation[] = [{ packVersion: initial.packVersion, target: { type: 'node', id: 'data' }, comment: 'Preexisting feedback must survive' }];
  expect((await server.save({ ...initial, annotations })).status).toBe(200);
  const saved = await server.get();
  expect(saved).toEqual({ ...initial, revision: initial.revision + 1, annotations });
  await stop(server.child);
  return saved;
}
function snapshot(root: string, base = root): Record<string, string> {
  return Object.fromEntries(readdirSync(root).sort().flatMap(name => {
    const path = join(root, name);
    if (name === '.git') return [];
    const stat = lstatSync(path);
    return stat.isSymbolicLink() ? [[relative(base, path), `link:${readlinkSync(path)}`]] : stat.isDirectory() ? [[relative(base, path), 'directory'], ...Object.entries(snapshot(path, base))] : [[relative(base, path), readFileSync(path).toString('base64')]];
  }));
}
function reviews(root: string) { return Object.keys(snapshot(join(root, '.acstack/design-reviews'))).filter(path => path.endsWith('review.json')).map(path => join(root, '.acstack/design-reviews', path)); }
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}
function retained(value: unknown, expected: string[]) {
  const values = strings(value);
  for (const item of expected) expect(values, `Missing retained value: ${item}`).toContain(item);
}

describe('explicit legacy review migration through the shipped CLI', () => {
  it('appends mapped comments once across copied checkouts, retains history and exact decision bytes, and never promotes old approval', async () => {
    const f = fixture();
    const saved = await seed(f.root);
    writeFileSync(join(f.legacy, 'annotations.jsonl'), JSON.stringify({ ...oldComment(), id: 'persisted-comment', quoteAnchor: { prefix: 'with a ', suffix: '.' } }) + '\n');
    const group = oldComment('group', 'group-payment', 'Explain the payment group.');
    const edge = oldComment('edge', 'edge-saved-card-risk', 'Keep the risk visible.');
    f.mapping.push({ from: group.target, to: { type: 'group', id: 'design:root' } }, { from: edge.target, to: { type: 'edge', id: 'reads' } });
    json(f.root, 'mapping.json', f.mapping);
    json(f.root, 'feedback.json', { packVersion: oldVersions[1], reviewState: legacyPack(oldVersions[1]).reviewState, annotations: [oldComment(), { ...oldComment(), quoteAnchor: { prefix: 'with a ', suffix: '.' } }, group, edge] });
    const sources = snapshot(f.legacy);
    const authored = ['design.yaml', 'app.yaml', 'data.yaml'].map(path => readFileSync(join(f.root, path), 'utf8'));
    accepted(migrate(f, true));
    const server = await review(f.root);
    const current = await server.get();
    expect(Object.keys(current).sort()).toEqual(['annotations', 'packVersion', 'revision']);
    expect(current.packVersion).toBe(saved.packVersion);
    expect(current.revision).toBe(saved.revision + 1);
    expect(current.annotations).toHaveLength(4);
    expect(current.annotations).toContainEqual(saved.annotations[0]);
    for (const [annotation, target] of [[oldComment(), { type: 'node', id: 'app' }], [group, { type: 'group', id: 'design:root' }], [edge, { type: 'edge', id: 'reads' }]] as const) {
      expect(current.annotations).toContainEqual(expect.objectContaining({ packVersion: saved.packVersion, target, comment: annotation.comment, selectedText: annotation.selectedText }));
    }
    await stop(server.child);
    const paths = reviews(f.root);
    expect(paths).toHaveLength(1);
    const receipt: unknown = JSON.parse(readFileSync(paths[0], 'utf8'));
    retained(receipt, [...oldVersions, ...oldVersions.map(version => `Legacy reviewer ${version}`), '2026-10-12T10:00:00.000Z', oldComment().comment, 'card they already trust', 'Reviewer A', '2026-10-12T10:15:00.000Z', 'spec-checkout', 'specs/checkout.md#goals', decisionBytes]);
    const status = cli(f.root, ['design-review', 'status', 'design.yaml']);
    accepted(status);
    expect(JSON.parse(status.stdout)).toMatchObject({ approval: { valid: false } });
    expect(snapshot(f.legacy)).toEqual(sources);
    expect(readFileSync(join(f.root, '.acstack/decision-logs/checkout-redesign.tsv'), 'utf8')).toBe(decisionBytes);
    expect(['design.yaml', 'app.yaml', 'data.yaml'].map(path => readFileSync(join(f.root, path), 'utf8'))).toEqual(authored);
    const beforeRetry = snapshot(join(f.root, '.acstack/design-reviews'));
    accepted(migrate(f, true));
    expect(snapshot(join(f.root, '.acstack/design-reviews'))).toEqual(beforeRetry);
    const resumed = await review(f.root);
    expect(await resumed.get()).toEqual(current);
    await stop(resumed.child);
    const copiedRoot = mkdtempSync(join(tmpdir(), 'design-migration-copy-'));
    roots.push(copiedRoot);
    cpSync(f.root, copiedRoot, { recursive: true });
    const copied = { ...f, root: copiedRoot, legacy: join(copiedRoot, relative(f.root, f.legacy)) };
    const beforeCopiedRetry = snapshot(copiedRoot);
    accepted(migrate(copied, true));
    expect(snapshot(copiedRoot)).toEqual(beforeCopiedRetry);
    const copiedReview = await review(copiedRoot);
    expect(await copiedReview.get()).toEqual(current);
  }, 40_000);

  it('reads embedded pack JSON without executing unrelated legacy scripts and preserves source bytes and history', async () => {
    const f = fixture();
    const path = join(f.legacy, `${oldVersions[1]}.html`);
    writeFileSync(path, "<script>throw new Error('Legacy scripts must never execute')</script>\n" + readFileSync(path, 'utf8'));
    const sources = snapshot(f.legacy);
    accepted(migrate(f));
    expect(snapshot(f.legacy)).toEqual(sources);
    expect(readFileSync(join(f.root, '.acstack/decision-logs/checkout-redesign.tsv'), 'utf8')).toBe(decisionBytes);
    const paths = reviews(f.root);
    expect(paths).toHaveLength(1);
    retained(JSON.parse(readFileSync(paths[0], 'utf8')), [...oldVersions, ...oldVersions.map(version => `Legacy reviewer ${version}`), oldComment().comment, decisionBytes]);
    const server = await review(f.root);
    expect((await server.get()).annotations).toContainEqual(expect.objectContaining({ comment: oldComment().comment, target: { type: 'node', id: 'app' } }));
  }, 20_000);

  it('imports persisted feedback without an optional export and preserves distinct comments on one target', async () => {
    const f = fixture();
    const saved = await seed(f.root);
    const second = { ...oldComment(), comment: 'A separate concern on the same selected quote.' };
    writeFileSync(join(f.legacy, 'annotations.jsonl'), [oldComment(), second].map(value => JSON.stringify(value)).join('\n') + '\n');
    accepted(migrate(f));
    const server = await review(f.root);
    const current = await server.get();
    expect(current.revision).toBe(saved.revision + 1);
    expect(current.annotations.map(annotation => annotation.comment).sort()).toEqual(['Preexisting feedback must survive', oldComment().comment, second.comment].sort());
  }, 20_000);

  it.each(['different IDs and anchors', 'different IDs only', 'different anchors without IDs'] as const)('preserves two wire-identical comments with %s across retries and new receipts', async distinction => {
    const f = fixture();
    const firstAnchor = { prefix: 'first ', suffix: ' occurrence' };
    const secondAnchor = { prefix: 'second ', suffix: ' occurrence' };
    const originals = distinction === 'different anchors without IDs'
      ? [{ ...oldComment(), quoteAnchor: firstAnchor }, { ...oldComment(), quoteAnchor: secondAnchor }]
      : [{ ...oldComment(), id: 'comment-one', quoteAnchor: firstAnchor }, { ...oldComment(), id: 'comment-two', quoteAnchor: distinction === 'different IDs only' ? firstAnchor : secondAnchor }];
    writeFileSync(join(f.legacy, 'annotations.jsonl'), originals.map(value => JSON.stringify(value)).join('\n') + '\n');
    const sources = snapshot(f.legacy);
    accepted(migrate(f));
    const server = await review(f.root);
    const current = await server.get();
    expect(current.annotations).toHaveLength(2);
    const mapped = { ...oldComment(), packVersion: current.packVersion, target: { type: 'node', id: 'app' } };
    expect(current.annotations).toEqual([mapped, mapped]);
    await stop(server.child);
    expect(snapshot(f.legacy)).toEqual(sources);
    const receipt = () => JSON.parse(readFileSync(reviews(f.root)[0], 'utf8')) as { imports: { history: { annotations: unknown[] } }[] };
    expect(receipt().imports[0].history.annotations).toEqual(originals);
    const beforeRetry = snapshot(join(f.root, '.acstack/design-reviews'));
    accepted(migrate(f));
    expect(snapshot(join(f.root, '.acstack/design-reviews'))).toEqual(beforeRetry);

    const copiedRoot = mkdtempSync(join(tmpdir(), 'design-migration-copy-'));
    roots.push(copiedRoot);
    cpSync(f.root, copiedRoot, { recursive: true });
    const copied = { ...f, root: copiedRoot, legacy: join(copiedRoot, relative(f.root, f.legacy)) };
    const beforeCopiedRetry = snapshot(copiedRoot);
    accepted(migrate(copied));
    expect(snapshot(copiedRoot)).toEqual(beforeCopiedRetry);
    const copiedReview = await review(copiedRoot);
    expect(await copiedReview.get()).toEqual(current);
    await stop(copiedReview.child);

    const packPath = join(f.legacy, `${oldVersions[0]}.html`);
    writeFileSync(packPath, readFileSync(packPath, 'utf8') + '\n<!-- Additional source context -->\n');
    accepted(migrate(f));
    expect(receipt().imports).toHaveLength(2);
    const changedInputReview = await review(f.root);
    const changedInput = await changedInputReview.get();
    expect(changedInput).toMatchObject({ packVersion: current.packVersion, annotations: [mapped, mapped] });
    expect(Number.isSafeInteger(changedInput.revision)).toBe(true);
    expect(changedInput.revision).toBeGreaterThanOrEqual(current.revision);
    await stop(changedInputReview.child);

    json(f.root, 'mapping.json', [...f.mapping, { from: { type: 'group', id: 'group-payment' }, to: { type: 'group', id: 'design:root' } }]);
    accepted(migrate(f));
    expect(receipt().imports).toHaveLength(3);
    const changedMappingReview = await review(f.root);
    const changedMapping = await changedMappingReview.get();
    expect(changedMapping).toMatchObject({ packVersion: current.packVersion, annotations: [mapped, mapped] });
    expect(Number.isSafeInteger(changedMapping.revision)).toBe(true);
    expect(changedMapping.revision).toBeGreaterThanOrEqual(changedInput.revision);
  }, 40_000);

  it('invalidates a current exact-revision approval when migration imports feedback', async () => {
    const f = fixture();
    const server = await review(f.root);
    const initial = await server.get();
    const before = cli(f.root, ['design-review', 'status', 'design.yaml']);
    accepted(before);
    const status = JSON.parse(before.stdout) as { sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string };
    const expected = { sourceRevision: status.sourceRevision, reviewRevision: status.reviewRevision, commentsDigest: status.commentsDigest, mapInputsDigest: status.mapInputsDigest };
    expect((await server.approve(expected)).status).toBe(200);
    const approved = cli(f.root, ['design-review', 'status', 'design.yaml']);
    accepted(approved);
    expect(JSON.parse(approved.stdout)).toMatchObject({ approval: { valid: true } });
    await stop(server.child);
    accepted(migrate(f));
    const after = cli(f.root, ['design-review', 'status', 'design.yaml']);
    accepted(after);
    expect(JSON.parse(after.stdout)).toMatchObject({ reviewRevision: initial.revision + 1, approval: { valid: false } });
    const resumed = await review(f.root);
    expect((await resumed.get()).annotations).toContainEqual(expect.objectContaining({ comment: oldComment().comment, target: { type: 'node', id: 'app' } }));
  }, 20_000);

  const invalid = ['missing authored entry', 'missing mapping', 'malformed mapping', 'unsupported mapping', 'conflicting mapping', 'unknown legacy target', 'wrong legacy type', 'unknown design target', 'wrong design type', 'malformed JSONL', 'strict JSONL wire', 'foreign pack version', 'conflicting duplicate pack', 'malformed feedback', 'oversized feedback', 'malformed HTML', 'symlink directory', 'symlink artifact', 'unsafe directory'] as const;
  it.each(invalid)('rejects %s before changing any source or destination file', async kind => {
    const f = fixture();
    await seed(f.root);
    let source = f.legacy;
    let feedback = false;
    switch (kind) {
      case 'missing authored entry': rmSync(join(f.root, 'design.yaml')); break;
      case 'missing mapping': json(f.root, 'mapping.json', []); break;
      case 'malformed mapping': writeFileSync(join(f.root, 'mapping.json'), '{broken'); break;
      case 'unsupported mapping': json(f.root, 'mapping.json', [{ ...f.mapping[0], to: { type: 'inferred-domain', id: 'app' } }]); break;
      case 'conflicting mapping': json(f.root, 'mapping.json', [...f.mapping, { from: f.mapping[0].from, to: { type: 'node', id: 'data' } }]); break;
      case 'unknown legacy target': {
        const target = { type: 'node' as const, id: 'not-in-pack' };
        writeFileSync(join(f.legacy, 'annotations.jsonl'), JSON.stringify({ ...oldComment(), target }) + '\n');
        json(f.root, 'mapping.json', [{ from: target, to: f.mapping[0].to }]);
        break;
      }
      case 'wrong legacy type': {
        const target = { type: 'group' as const, id: 'node-saved-card' };
        writeFileSync(join(f.legacy, 'annotations.jsonl'), JSON.stringify({ ...oldComment(), target }) + '\n');
        json(f.root, 'mapping.json', [{ from: target, to: f.mapping[0].to }]);
        break;
      }
      case 'unknown design target': json(f.root, 'mapping.json', [{ ...f.mapping[0], to: { type: 'node', id: 'not-in-design' } }]); break;
      case 'wrong design type': json(f.root, 'mapping.json', [{ ...f.mapping[0], to: { type: 'edge', id: 'app' } }]); break;
      case 'malformed JSONL': writeFileSync(join(f.legacy, 'annotations.jsonl'), JSON.stringify(oldComment()) + '\n{broken\n'); break;
      case 'strict JSONL wire': writeFileSync(join(f.legacy, 'annotations.jsonl'), JSON.stringify({ ...oldComment(), unexpected: true }) + '\n'); break;
      case 'foreign pack version': writeFileSync(join(f.legacy, 'annotations.jsonl'), JSON.stringify({ ...oldComment(), packVersion: 'not-a-stored-pack' }) + '\n'); break;
      case 'conflicting duplicate pack': {
        const conflicting = legacyPack(oldVersions[1]);
        conflicting.graph.nodes[0].summary = 'Contradictory payload for the same stored pack version';
        writeFileSync(join(f.legacy, 'duplicate.html'), renderAlignmentPackHtml(conflicting));
        break;
      }
      case 'malformed feedback': writeFileSync(join(f.root, 'feedback.json'), '{broken'); feedback = true; break;
      // Deliberately far beyond the existing 1 MB review wire bound, not a new exact threshold.
      case 'oversized feedback': json(f.root, 'feedback.json', { packVersion: oldVersions[1], annotations: [{ ...oldComment(), comment: '界'.repeat(4_000_000) }] }); feedback = true; break;
      case 'malformed HTML': writeFileSync(join(f.legacy, `${oldVersions[0]}.html`), '<script id="alignment-pack-data" type="application/json">{broken</script>'); break;
      case 'symlink directory': renameSync(f.legacy, join(f.root, 'linked-source')); symlinkSync(join(f.root, 'linked-source'), f.legacy); break;
      case 'symlink artifact': renameSync(join(f.legacy, 'annotations.jsonl'), join(f.root, 'linked-annotations')); symlinkSync(join(f.root, 'linked-annotations'), join(f.legacy, 'annotations.jsonl')); break;
      case 'unsafe directory': renameSync(f.legacy, join(f.root, 'outside-metadata')); source = join(f.root, 'outside-metadata'); break;
    }
    const before = snapshot(f.root);
    const result = migrate(f, feedback, source);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/unknown command 'migrate'/);
    expect(result.stdout + result.stderr).toMatch(/mapping|target|legacy|feedback|annotation|pack|symlink|symbolic|size|limit|large|json|conflict|design|entry|ENOENT/i);
    expect(snapshot(f.root)).toEqual(before);
  }, 20_000);
});

describe('retired diagram commands and alignment configuration', () => {
  it('removes legacy help and rejects reserved names with replacements before external dispatch', () => {
    const f = fixture();
    const marker = join(f.root, 'external-dispatch');
    for (const command of ['acstack-map', 'acstack-align-viewer']) {
      const path = join(f.root, 'bin', command);
      writeFileSync(path, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'dispatched');\nprocess.exit(0);\n`);
      chmodSync(path, 0o755);
    }
    const help = cli(f.root, ['--help']);
    accepted(help);
    expect.soft(help.stdout).not.toMatch(/^\s+(?:map|align-viewer)(?:\s|\[|<)/m);
    // Missing planning nodes also keep the pre-retirement baseline from opening a viewer.
    rmSync(f.legacy, { recursive: true });
    for (const args of [['map', '--map', 'checkout-redesign'], ['align-viewer', '--map', 'checkout-redesign'], ['map'], ['align-viewer']]) {
      const result = cli(f.root, args);
      expect.soft(result.error, result.stderr).toBeUndefined();
      expect.soft(result.status, result.stdout + result.stderr).not.toBe(0);
      expect.soft(result.stdout + result.stderr).toContain('design-doc');
      expect.soft(result.stdout + result.stderr).toMatch(/design-review\s+migrate/);
      expect.soft(existsSync(marker)).toBe(false);
    }
  }, 40_000);

  it('does not offer obsolete alignment defaults or writes and leaves old user configuration untouched and ineffective', () => {
    const f = fixture();
    const keys = ['auto_generate', 'approval_gate', 'commit_generated_packs'];
    const clean = cli(f.root, ['config', 'show', '--json']);
    accepted(clean);
    expect(clean.stdout).not.toContain('workflow.alignment_packs');
    for (const key of keys) {
      const get = cli(f.root, ['config', 'get', `workflow.alignment_packs.${key}`]);
      expect.soft(get.status, get.stdout + get.stderr).not.toBe(0);
    }
    const beforeStatus = cli(f.root, ['design-review', 'status', 'design.yaml']);
    accepted(beforeStatus);
    const config = 'name: migration-test\n# User-owned legacy settings\nworkflow:\n  alignment_packs:\n    auto_generate: true\n    approval_gate: true\n    commit_generated_packs: true\n';
    writeFileSync(join(f.root, '.acstack/project.yaml'), config);
    for (const key of keys) {
      const dotted = `workflow.alignment_packs.${key}`;
      const set = cli(f.root, ['config', 'set', dotted, 'false']);
      expect.soft(set.status, set.stdout + set.stderr).not.toBe(0);
      expect.soft(readFileSync(join(f.root, '.acstack/project.yaml'), 'utf8')).toBe(config);
    }
    const effective = cli(f.root, ['config', 'show', '--json']);
    accepted(effective);
    expect(effective.stdout).not.toContain('workflow.alignment_packs');
    expect.soft(readFileSync(join(f.root, '.acstack/project.yaml'), 'utf8')).toBe(config);
    const afterStatus = cli(f.root, ['design-review', 'status', 'design.yaml']);
    accepted(afterStatus);
    expect(JSON.parse(afterStatus.stdout)).toEqual(JSON.parse(beforeStatus.stdout));
  }, 20_000);
});
