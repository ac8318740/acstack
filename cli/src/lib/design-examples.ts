import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';
import type { ExampleSummary } from './alignment-packs.js';
import { parseCsv } from './csv.js';
import { mapDir } from './nodes.js';

const file = z.string().trim().min(1).max(500);
const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
// One example per entry, keyed by its kind. `od` names an OpenDesigner design and page; the OpenDesigner skills defer to this key.
export const ExampleEntrySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  od: z.object({ design: name, page: name }).strict().optional(),
  html: file.optional(), markdown: file.optional(), mermaid: file.optional(), fixture: file.optional(),
  schema: file.optional(),
  illustrative: z.boolean().optional(),
}).strict().superRefine((entry, context) => {
  const kinds = (['od', 'html', 'markdown', 'mermaid', 'fixture'] as const).filter(kind => entry[kind] !== undefined);
  if (kinds.length !== 1) context.addIssue({ code: 'custom', message: 'An example needs exactly one of od, html, markdown, mermaid, or fixture' });
  if (entry.schema && !entry.fixture) context.addIssue({ code: 'custom', message: 'Only a fixture takes a schema' });
});
export type ExampleEntry = z.infer<typeof ExampleEntrySchema>;


export const FIXTURE_LIMIT = 20 * 1024;
export const LARGE_EXAMPLE = 5 * 1024 * 1024;
const OD_DIR = '.open-designer';

type ExampleElement = { id: string; locked: boolean; examples?: ExampleEntry[] };
export const elementFolder = (root: string, map: string, id: string) => join(mapDir(root, map), 'elements', id);
export const examplePath = (entry: ExampleEntry) => entry.od ? `od:${entry.od.design}/${entry.od.page}` : (entry.html ?? entry.markdown ?? entry.mermaid ?? entry.fixture)!;

// Paths stay inside the element folder: no absolute paths, no `..`, and no symlink out.
export function insideFolder(folder: string, path: string, owner: string): string {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) throw new Error(`Element ${owner}: example path ${path} must be relative and stay inside ${folder}`);
  const full = join(folder, path);
  if (!existsSync(full)) throw new Error(`Element ${owner}: example file ${full} does not exist`);
  const real = realpathSync(full), base = realpathSync(folder);
  if (!real.startsWith(base + sep) || !statSync(real).isFile()) throw new Error(`Element ${owner}: example path ${path} must be a file inside ${folder}`);
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

type OdIndex = { pages?: { id: string; variants?: { id: string }[] }[] };
function odVariants(checkout: string, owner: string, od: { design: string; page: string }): string[] {
  const index = join(checkout, OD_DIR, 'designs', od.design, 'index.json');
  let parsed: OdIndex;
  try { parsed = JSON.parse(readFileSync(index, 'utf8')) as OdIndex; } catch { throw new Error(`Element ${owner}: OpenDesigner design ${od.design} has no readable ${index}`); }
  const page = parsed.pages?.find(item => item.id === od.page);
  if (!page) throw new Error(`Element ${owner}: OpenDesigner design ${od.design} has no page ${od.page}`);
  return (page.variants ?? []).map(variant => variant.id);
}

/** Check every element's examples against the files on disk. Throws on a broken reference; warns on oddities. */
export function checkElementExamples(root: string, map: string, items: readonly ExampleElement[], checkout: string): { summaries: Map<string, ExampleSummary[]>; warnings: string[] } {
  const warnings: string[] = [];
  const summaries = new Map<string, ExampleSummary[]>();
  const odInstalled = existsSync(join(checkout, OD_DIR));
  for (const item of items) {
    if (!item.examples?.length) continue;
    const folder = elementFolder(root, map, item.id);
    const list: ExampleSummary[] = [];
    for (const entry of item.examples) {
      const path = examplePath(entry);
      if (list.some(summary => summary.path === path)) throw new Error(`Element ${item.id}: example ${path} is listed twice`);
      const title = entry.title ?? (entry.od ? `${entry.od.design} ${entry.od.page}` : path);
      const base = { path, title, ...(entry.illustrative && { illustrative: true }) };
      if (entry.od) {
        const variants = odVariants(checkout, item.id, entry.od);
        if (!item.locked && variants.length < 2) warnings.push(`Element ${item.id}: mock ${path} has ${variants.length} variant; add another so the reviewer can compare options`);
        list.push({ kind: 'od-build', ...base, variants });
        continue;
      }
      const full = insideFolder(folder, path, item.id);
      if (entry.fixture) {
        validateFixture(item.id, full, entry.schema && insideFolder(folder, entry.schema, item.id));
        list.push({ kind: 'fixture', ...base });
        continue;
      }
      if (statSync(full).size > LARGE_EXAMPLE) warnings.push(`Element ${item.id}: example ${path} is over 5 MB and will be slow to open`);
      if (entry.html) {
        if (odInstalled) warnings.push(`Element ${item.id}: ${path} is inline HTML; OpenDesigner is installed, so consider an od mock with variants`);
        else if (!item.locked) warnings.push(`Element ${item.id}: mock ${path} has 1 variant; add another so the reviewer can compare options`);
      }
      list.push({ kind: entry.html ? 'html' : 'markdown', ...base });
    }
    if (item.locked && list.every(summary => summary.illustrative)) warnings.push(`Element ${item.id} is locked but has only illustrative examples, so none is a requirement`);
    summaries.set(item.id, list);
  }
  return { summaries, warnings };
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
/** The example's content for the modal. OpenDesigner examples are built fresh through its CLI. */
export async function loadExampleContent(root: string, map: string, elementId: string, entry: ExampleEntry, checkout: string, log: (message: string) => void = console.error): Promise<Record<string, unknown>> {
  const folder = elementFolder(root, map, elementId);
  const path = examplePath(entry);
  if (entry.od) {
    // shortcut: builds on every open; cache by the design's files once builds get slow.
    let stdout: string;
    try { ({ stdout } = await run('open-designer', ['build', entry.od.design, '--page', entry.od.page], { cwd: checkout, timeout: 120_000, maxBuffer: 1024 * 1024 })); }
    catch (error) { throw new Error(`OpenDesigner could not build ${path}: ${((error as { stderr?: string }).stderr ?? (error as Error).message).trim().slice(0, 2000)}`); }
    const built = JSON.parse(stdout) as { path: string; size: number };
    if (built.size > LARGE_EXAMPLE) log(`warning: Element ${elementId}: OpenDesigner build of ${path} is ${(built.size / 1024 / 1024).toFixed(1)} MB`);
    const html = readFileSync(built.path, 'utf8');
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
