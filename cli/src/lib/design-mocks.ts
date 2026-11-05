import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';
import type { MockSummary } from './alignment-packs.js';
import { parseCsv } from './csv.js';
import { mapDir } from './nodes.js';
import { defaultFor, type Tweak } from '../viewer/od-bridge/tweaks.js';

const file = z.string().trim().min(1).max(500);
const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
// One mock per entry, keyed by its kind. `od` names an OpenDesigner design and page; the OpenDesigner skills defer to this key.
export const MockEntrySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  od: z.object({ design: name, page: name }).strict().optional(),
  html: file.optional(), markdown: file.optional(), mermaid: file.optional(), fixture: file.optional(),
  schema: file.optional(),
  illustrative: z.boolean().optional(),
}).strict().superRefine((entry, context) => {
  const kinds = (['od', 'html', 'markdown', 'mermaid', 'fixture'] as const).filter(kind => entry[kind] !== undefined);
  if (kinds.length !== 1) context.addIssue({ code: 'custom', message: 'A mock needs exactly one of od, html, markdown, mermaid, or fixture' });
  if (entry.schema && !entry.fixture) context.addIssue({ code: 'custom', message: 'Only a fixture takes a schema' });
});
export type MockEntry = z.infer<typeof MockEntrySchema>;


export const FIXTURE_LIMIT = 20 * 1024;
export const LARGE_MOCK = 5 * 1024 * 1024;
const OD_DIR = '.open-designer';

type MockElement = { id: string; locked: boolean; mocks?: MockEntry[] };
export const elementFolder = (root: string, map: string, id: string) => join(mapDir(root, map), 'elements', id);
export const mockPath = (entry: MockEntry) => entry.od ? `od:${entry.od.design}/${entry.od.page}` : (entry.html ?? entry.markdown ?? entry.mermaid ?? entry.fixture)!;

// Paths stay inside the element folder: no absolute paths, no `..`, and no symlink out.
export function insideFolder(folder: string, path: string, owner: string): string {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) throw new Error(`Element ${owner}: mock path ${path} must be relative and stay inside ${folder}`);
  const full = join(folder, path);
  if (!existsSync(full)) throw new Error(`Element ${owner}: mock file ${full} does not exist`);
  const real = realpathSync(full), base = realpathSync(folder);
  if (!real.startsWith(base + sep) || !statSync(real).isFile()) throw new Error(`Element ${owner}: mock path ${path} must be a file inside ${folder}`);
  return real;
}

function fixtureValue(path: string, text: string): unknown {
  if (!path.endsWith('.csv')) return JSON.parse(text);
  const [columns = [], ...rows] = parseCsv(text);
  return rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])));
}

// Typed fixtures are requirements, so a mismatch with their JSON Schema fails the build.
export function validateFixture(owner: string, fixture: string, schema?: string): void {
  const text = readFileSync(fixture, 'utf8');
  if (Buffer.byteLength(text) > FIXTURE_LIMIT) throw new Error(`Element ${owner}: fixture ${fixture} is over 20 KB; fixtures show structure, so trim it`);
  let value: unknown;
  try { value = fixtureValue(fixture, text); } catch (error) { throw new Error(`Element ${owner}: fixture ${fixture} is not valid JSON: ${(error as Error).message}`); }
  if (!schema) return;
  let definition: { $schema?: unknown } & Record<string, unknown>;
  try { definition = JSON.parse(readFileSync(schema, 'utf8')) as { $schema?: unknown } & Record<string, unknown>; } catch (error) { throw new Error(`Element ${owner}: schema ${schema} is not valid JSON: ${(error as Error).message}`); }
  // Draft 2020-12 unless the schema names an older draft.
  const ajv = typeof definition.$schema === 'string' && /draft-0[4-7]/.test(definition.$schema) ? new Ajv.default({ allErrors: true, strict: false }) : new Ajv2020.default({ allErrors: true, strict: false });
  let check;
  try { check = ajv.compile(definition as object); } catch (error) { throw new Error(`Element ${owner}: schema ${schema} is not a valid JSON Schema: ${(error as Error).message}`); }
  if (!check(value)) throw new Error(`Element ${owner}: fixture ${fixture} does not match ${schema}: ${ajv.errorsText(check.errors, { separator: '; ' })}`);
}

type OdIndex = { tweaks?: Tweak[]; pages?: { id: string; tweaks?: Tweak[]; variants?: { id: string; file?: string; tweaks?: Tweak[] }[] }[] };
// A symlinked design folder, or a build path OpenDesigner reports, must not lead out of the checkout.
function insideCheckout(checkout: string, path: string, what: string): string {
  const real = realpathSync(path), base = realpathSync(checkout);
  if (!real.startsWith(base + sep)) throw new Error(`${what} ${path} resolves outside the checkout`);
  return real;
}
function odFolder(checkout: string, owner: string, design: string): string {
  const folder = join(checkout, OD_DIR, 'designs', design);
  return existsSync(folder) ? insideCheckout(checkout, folder, `Element ${owner}: OpenDesigner design`) : folder;
}
function odPage(checkout: string, owner: string, od: { design: string; page: string }) {
  const index = join(odFolder(checkout, owner, od.design), 'index.json');
  let parsed: OdIndex;
  try { parsed = JSON.parse(readFileSync(index, 'utf8')) as OdIndex; } catch { throw new Error(`Element ${owner}: OpenDesigner design ${od.design} has no readable ${index}`); }
  const page = parsed.pages?.find(item => item.id === od.page);
  if (!page) throw new Error(`Element ${owner}: OpenDesigner design ${od.design} has no page ${od.page}`);
  return { design: parsed, page };
}
const odVariants = (checkout: string, owner: string, od: { design: string; page: string }) => (odPage(checkout, owner, od).page.variants ?? []).map(variant => variant.id);

type Capture = { mocks?: Record<string, { variant?: unknown }> };
/** The multi-variant mocks a lock capture leaves without a valid chosen variant. */
// Illustrative mocks bind nothing, so they never need a chosen variant.
export function unchosenMocks(item: { mockSummaries?: MockSummary[] }, capture?: Capture): MockSummary[] {
  return (item.mockSummaries ?? []).filter(mock => !mock.illustrative && (mock.variants?.length ?? 0) > 1 && !mock.variants!.includes(capture?.mocks?.[mock.path]?.variant as string));
}

/** A variant's tweak defaults and every state it offers, read from OpenDesigner's index.json. */
export function variantDefaults(item: { id: string; mocks: MockEntry[] }, path: string, variant: string, checkout: string) {
  const entry = item.mocks.find(mock => mockPath(mock) === path);
  if (!entry?.od) throw new Error(`Element ${item.id} has no OpenDesigner mock ${path}`);
  const { design, page } = odPage(checkout, item.id, entry.od);
  const tweaks = [...design.tweaks ?? [], ...page.tweaks ?? [], ...page.variants?.find(item => item.id === variant)?.tweaks ?? []];
  return {
    tweaks: Object.fromEntries(tweaks.filter(tweak => tweak.type !== 'state').map(tweak => [tweak.id, defaultFor(tweak)])),
    states: Object.fromEntries(tweaks.flatMap(tweak => tweak.type === 'state' ? [[tweak.id, (tweak.options ?? []).map(option => typeof option === 'string' ? option : option.value)]] : [])),
  };
}

/**
 * The lock capture for variants the user named to the agent. Tweaks take the variant's
 * defaults, and every state of the variant is kept, as when the user locks in the viewer.
 */
export function variantCapture(item: { id: string; mocks: MockEntry[]; mockSummaries?: MockSummary[] }, chosen: Record<string, string>, checkout: string) {
  const builds = item.mockSummaries?.filter(summary => summary.kind === 'od-build') ?? [];
  for (const path of Object.keys(chosen)) if (!builds.some(mock => mock.path === path)) throw new Error(`Element ${item.id} has no OpenDesigner mock ${path}`);
  const missing = unchosenMocks(item, { mocks: Object.fromEntries(Object.entries(chosen).map(([path, variant]) => [path, { variant }])) });
  if (missing.length) throw new Error(`Element ${item.id} has several variants for ${missing.map(mock => `${mock.path} (${mock.variants!.join(', ')})`).join('; ')}; pass --variant <path>=<variant> for each, as the user chose`);
  const mocks = Object.fromEntries(Object.entries(chosen).map(([path, variant]) => [path, { variant, ...variantDefaults(item, path, variant, checkout) }]));
  return Object.keys(mocks).length ? { mocks } : undefined;
}

const fileDigest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
// What an od mock defines: its page entry and the source of each variant file. Built output is not deterministic, so it stays out.
function odSourceDigest(checkout: string, owner: string, od: { design: string; page: string }): unknown {
  const { page } = odPage(checkout, owner, od);
  const folder = odFolder(checkout, owner, od.design);
  return [page, (page.variants ?? []).map(variant => variant.file ? fileDigest(insideFolder(folder, variant.file, owner)) : null)];
}

/**
 * Check every element's mocks against the files on disk. Throws on a broken reference; warns on oddities.
 * `bindings` digests each element's binding mocks, the ones a lock approves; illustrative ones stay out.
 */
export function checkElementMocks(root: string, map: string, items: readonly MockElement[], checkout: string): { summaries: Map<string, MockSummary[]>; bindings: Map<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  const summaries = new Map<string, MockSummary[]>();
  const bindings = new Map<string, string>();
  const odInstalled = existsSync(join(checkout, OD_DIR));
  for (const item of items) {
    if (!item.mocks?.length) continue;
    const folder = elementFolder(root, map, item.id);
    const list: MockSummary[] = [];
    const bound: unknown[] = [];
    for (const entry of item.mocks) {
      const path = mockPath(entry);
      if (list.some(summary => summary.path === path)) throw new Error(`Element ${item.id}: mock ${path} is listed twice`);
      const title = entry.title ?? (entry.od ? `${entry.od.design} ${entry.od.page}` : path);
      // The mock's sources, hashed once for both the lock digest and the viewer's refetch revision.
      const record = (sources: unknown) => {
        if (!entry.illustrative) bound.push([path, sources]);
        return createHash('sha256').update(JSON.stringify(sources)).digest('hex');
      };
      if (entry.od) {
        const variants = odVariants(checkout, item.id, entry.od);
        const base = { path, title, ...(entry.illustrative && { illustrative: true }), revision: record(odSourceDigest(checkout, item.id, entry.od)) };
        if (!item.locked && variants.length < 2) warnings.push(`Element ${item.id}: mock ${path} has ${variants.length} variant; add another so the reviewer can compare options`);
        list.push({ kind: 'od-build', ...base, variants });
        continue;
      }
      const full = insideFolder(folder, path, item.id);
      const schema = entry.schema && insideFolder(folder, entry.schema, item.id);
      const base = { path, title, ...(entry.illustrative && { illustrative: true }), revision: record([fileDigest(full), schema ? fileDigest(schema) : null]) };
      if (entry.fixture) {
        validateFixture(item.id, full, schema);
        list.push({ kind: 'fixture', ...base });
        continue;
      }
      if (statSync(full).size > LARGE_MOCK) warnings.push(`Element ${item.id}: mock ${path} is over 5 MB and will be slow to open`);
      if (entry.html) {
        if (odInstalled) warnings.push(`Element ${item.id}: ${path} is inline HTML; OpenDesigner is installed, so consider an od mock with variants`);
        else if (!item.locked) warnings.push(`Element ${item.id}: mock ${path} has 1 variant; add another so the reviewer can compare options`);
      }
      list.push({ kind: entry.html ? 'html' : 'markdown', ...base });
    }
    if (item.locked && list.every(summary => summary.illustrative)) warnings.push(`Element ${item.id} is locked but has only illustrative mocks, so none is a requirement`);
    summaries.set(item.id, list);
    if (bound.length) bindings.set(item.id, createHash('sha256').update(JSON.stringify(bound)).digest('hex'));
  }
  return { summaries, bindings, warnings };
}

const run = promisify(execFile);
// Custom properties in the build's token sheets, so `add` and `scale` tweaks have a base value.
export function tokenMap(html: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, css] of html.matchAll(/<style data-od-tokens[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const [, key, value] of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) tokens[key] = value.trim();
  }
  return tokens;
}

type OdPage = { page: { tweaks?: unknown[] }; designTweaks?: unknown[]; variants: { id: string; label?: string; tweaks?: unknown[] }[] };
/** The mock's content for the modal. OpenDesigner mocks are built fresh through its CLI. */
export async function loadMockContent(root: string, map: string, elementId: string, entry: MockEntry, checkout: string, log: (message: string) => void = console.error): Promise<Record<string, unknown>> {
  const folder = elementFolder(root, map, elementId);
  const path = mockPath(entry);
  if (entry.od) {
    // shortcut: builds on every open with no cache; cache by odSourceDigest once builds get slow.
    let stdout: string;
    try { ({ stdout } = await run('open-designer', ['build', entry.od.design, '--page', entry.od.page], { cwd: checkout, timeout: 120_000, maxBuffer: 1024 * 1024 })); }
    catch (error) { throw new Error(`OpenDesigner could not build ${path}: ${((error as { stderr?: string }).stderr ?? (error as Error).message).trim().slice(0, 2000)}`); }
    const built = JSON.parse(stdout) as { path: string; size: number };
    if (built.size > LARGE_MOCK) log(`warning: Element ${elementId}: OpenDesigner build of ${path} is ${(built.size / 1024 / 1024).toFixed(1)} MB`);
    const html = readFileSync(insideCheckout(checkout, resolve(checkout, built.path), `OpenDesigner build of ${path}`), 'utf8');
    const meta = /<script type="application\/json" id="od-page">([\s\S]*?)<\/script>/.exec(html);
    if (!meta) throw new Error(`OpenDesigner build of ${path} has no od-page metadata`);
    const page = JSON.parse(meta[1]) as OdPage;
    return { kind: 'od-build', html, tweaks: [...page.designTweaks ?? [], ...page.page.tweaks ?? []], variants: page.variants.map(({ id, label, tweaks }) => ({ id, ...(label && { label }), tweaks: tweaks ?? [] })), tokens: tokenMap(html) };
  }
  const text = readFileSync(insideFolder(folder, path, elementId), 'utf8');
  if (entry.html) return { kind: 'html', html: text };
  if (entry.fixture) return { kind: 'fixture', format: path.endsWith('.csv') ? 'csv' : 'json', data: text };
  if (entry.markdown) return { kind: 'markdown', markdown: text };
  // A fence longer than any backtick run in the source keeps the diagram inside it.
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return { kind: 'markdown', markdown: `${fence}mermaid\n${text}\n${fence}` };
}
