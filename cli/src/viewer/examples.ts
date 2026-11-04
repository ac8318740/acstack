import { parseCsv } from '../lib/csv.js';
import { defaultFor, type Tweak } from './od-bridge/tweaks.js';

declare const OD_BRIDGE_JS: string;

// One OpenDesigner variant and its own tweaks, in OpenDesigner's index.json shape.
export type ExampleVariant = { id: string; label?: string; tweaks?: Tweak[] };

// One example attached to a design element. `path` is relative to the element folder and is the example's identity.
export type ElementExample = {
  path: string;
  title: string;
  illustrative?: boolean;
} & (
  | { kind: 'html'; html: string }
  // One example is one page, built as one file holding every variant. `tweaks` holds the design- and
  // page-level tweaks; each variant adds its own. `tokens` are the design system's custom properties.
  | { kind: 'od-build'; html: string; variants: ExampleVariant[]; tweaks?: Tweak[]; tokens?: Record<string, string> }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'fixture'; format: 'json' | 'csv'; data: string }
);

// Loaded example content, kept for the page's lifetime so reopening and lock captures need no refetch.
// Each entry keeps the source revision it was loaded at; a newer revision in the pack means refetch.
const contents = new Map<string, { revision?: string; example: ElementExample }>();
export const cachedExample = (nodeId: string, path: string) => contents.get(`${nodeId}\n${path}`)?.example;
export const isCurrent = (nodeId: string, summary: { path: string; revision?: string }) => contents.get(`${nodeId}\n${summary.path}`)?.revision === summary.revision && contents.has(`${nodeId}\n${summary.path}`);
export const cacheExample = (nodeId: string, example: ElementExample, revision?: string) => { contents.set(`${nodeId}\n${example.path}`, { revision, example }); };

// OpenDesigner's `od-variant` meta picks the variant a single-file build renders.
export function withVariant(html: string, variant: string): string {
  const id = variant.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
  return html.replace(/<meta name="od-variant" content="[^"]*">/, () => `<meta name="od-variant" content="${id}">`);
}

// What the reviewer last had on screen per example. It outlives the modal, because Lock sits in the Details tab.
export type ExampleView = { variant?: string; values: Record<string, string> };
const views = new Map<string, ExampleView>();
export const exampleView = (nodeId: string, path: string): ExampleView => views.get(`${nodeId}\n${path}`) ?? { values: {} };
export const setExampleView = (nodeId: string, path: string, view: ExampleView) => { views.set(`${nodeId}\n${path}`, view); };

// A lock records each viewed OpenDesigner example's variant, its tweak values, and every state that variant offers.
export function exampleCapture(nodeId: string, examples: ElementExample[]): { examples: Record<string, { variant: string; tweaks: Record<string, string>; states: Record<string, string[]> }> } | undefined {
  const captured = examples.flatMap(example => {
    const view = views.get(`${nodeId}\n${example.path}`);
    if (example.kind !== 'od-build' || !view) return [];
    const variant = example.variants.find(item => item.id === view.variant) ?? example.variants[0];
    if (!variant) return [];
    const tweaks = [...example.tweaks ?? [], ...variant.tweaks ?? []];
    return [[example.path, {
      variant: variant.id,
      tweaks: Object.fromEntries(tweaks.filter(tweak => tweak.type !== 'state').map(tweak => [tweak.id, view.values[tweak.id] ?? defaultFor(tweak)])),
      states: Object.fromEntries(tweaks.flatMap(tweak => tweak.type === 'state' ? [[tweak.id, (tweak.options ?? []).map(option => typeof option === 'string' ? option : option.value)]] : [])),
    }] as const];
  });
  return captured.length ? { examples: Object.fromEntries(captured) } : undefined;
}

// Bridge spec, Frame CSP. HTTPS only, so frame scripts cannot reach any local server.
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob:; connect-src https:; form-action 'none'; base-uri 'none'";

// Prepending, not searching for <head>, keeps the policy first even when the author's markup hides a <head> in a comment or script.
// The parser then folds the author's doctype, <html>, and <head> into this head.
export function exampleDocument(html: string): string {
  // Decided with the user: OpenDesigner's single-file build inlines its own marked bridge; ACStack injects only into unmarked inline HTML.
  // OpenDesigner builds already carry the bridge, and two copies would both answer the host.
  // Skipping it only costs interaction: the sandbox and CSP, not the bridge, keep the frame contained.
  const bridge = typeof OD_BRIDGE_JS === 'undefined' || html.includes('data-od-bridge') ? '' : `<script data-od-bridge>${OD_BRIDGE_JS.replace(/<\/script/gi, '<\\/script')}</script>`;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">${bridge}${html}`;
}

export type FixtureTable = { columns: string[]; rows: string[][] } | { error: string };

const cell = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value) ?? '';

// Fixtures render as text cells only; nested values show as JSON text.
export function fixtureTable(format: 'json' | 'csv', data: string): FixtureTable {
  if (format === 'csv') {
    const [columns = [], ...rows] = parseCsv(data);
    return { columns, rows };
  }
  let value: unknown;
  try { value = JSON.parse(data); } catch { return { error: 'This fixture is not valid JSON.' }; }
  const records = Array.isArray(value) ? value : [value];
  if (!records.every(record => record && typeof record === 'object' && !Array.isArray(record))) return { columns: ['Value'], rows: records.map(record => [cell(record)]) };
  const columns = [...new Set(records.flatMap(record => Object.keys(record as object)))];
  return { columns, rows: records.map(record => columns.map(column => column in (record as object) ? cell((record as Record<string, unknown>)[column]) : '')) };
}
