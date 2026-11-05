import { parseCsv } from '../lib/csv.js';
import { defaultFor, type Tweak } from './od-bridge/tweaks.js';

declare const OD_BRIDGE_JS: string;

// One OpenDesigner variant and its own tweaks, in OpenDesigner's index.json shape.
export type MockVariant = { id: string; label?: string; tweaks?: Tweak[] };

// One mock attached to a design element. `path` is relative to the element folder and is the mock's identity.
export type ElementMock = {
  path: string;
  title: string;
  illustrative?: boolean;
} & (
  | { kind: 'html'; html: string }
  // One mock is one page, built as one file holding every variant. `tweaks` holds the design- and
  // page-level tweaks; each variant adds its own. `tokens` are the design system's custom properties.
  | { kind: 'od-build'; html: string; variants: MockVariant[]; tweaks?: Tweak[]; tokens?: Record<string, string> }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'fixture'; format: 'json' | 'csv'; data: string }
);

// Loaded mock content, kept for the page's lifetime so reopening and lock captures need no refetch.
// Each entry keeps the source revision it was loaded at; a newer revision in the pack means refetch.
const contents = new Map<string, { revision?: string; mock: ElementMock }>();
export const cachedMock = (nodeId: string, path: string) => contents.get(`${nodeId}\n${path}`)?.mock;
export const isCurrent = (nodeId: string, summary: { path: string; revision?: string }) => contents.get(`${nodeId}\n${summary.path}`)?.revision === summary.revision && contents.has(`${nodeId}\n${summary.path}`);
export const cacheMock = (nodeId: string, mock: ElementMock, revision?: string) => { contents.set(`${nodeId}\n${mock.path}`, { revision, mock }); };

// OpenDesigner's `od-variant` meta picks the variant a single-file build renders.
export function withVariant(html: string, variant: string): string {
  const id = variant.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
  return html.replace(/<meta name="od-variant" content="[^"]*">/, () => `<meta name="od-variant" content="${id}">`);
}

// What the reviewer last had on screen per mock: the variant, and tweak values per variant ('' when there are none).
// It lasts the browser session, so a reload keeps the tweaks; it never goes into the review.
export type MockView = { variant?: string; values: Record<string, Record<string, string>> };
const views = new Map<string, MockView>();
const storageKey = (nodeId: string, path: string) => `acstack-mock-view:${nodeId}\n${path}`;
function storedView(nodeId: string, path: string): MockView | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(nodeId, path)) ?? 'null') as MockView | null;
    return value && typeof value === 'object' && typeof value.values === 'object' ? value : undefined;
  } catch { return undefined; }
}
export const mockView = (nodeId: string, path: string): MockView => views.get(`${nodeId}\n${path}`) ?? storedView(nodeId, path) ?? { values: {} };
export const setMockView = (nodeId: string, path: string, view: MockView) => {
  views.set(`${nodeId}\n${path}`, view);
  try { sessionStorage.setItem(storageKey(nodeId, path), JSON.stringify(view)); } catch { /* Without storage the view lasts until reload. */ }
};
export const valuesOf = (view: MockView, variant?: string): Record<string, string> => view.values[variant ?? ''] ?? {};

// A lock records each viewed OpenDesigner mock's variant, its tweak values, and every state that variant offers.
export function mockCapture(nodeId: string, mocks: ElementMock[]): { mocks: Record<string, { variant: string; tweaks: Record<string, string>; states: Record<string, string[]> }> } | undefined {
  const captured = mocks.flatMap(mock => {
    const view = views.get(`${nodeId}\n${mock.path}`);
    if (mock.kind !== 'od-build' || !view) return [];
    const variant = mock.variants.find(item => item.id === view.variant) ?? mock.variants[0];
    if (!variant) return [];
    const tweaks = [...mock.tweaks ?? [], ...variant.tweaks ?? []];
    return [[mock.path, {
      variant: variant.id,
      tweaks: Object.fromEntries(tweaks.filter(tweak => tweak.type !== 'state').map(tweak => [tweak.id, valuesOf(view, variant.id)[tweak.id] ?? defaultFor(tweak)])),
      states: Object.fromEntries(tweaks.flatMap(tweak => tweak.type === 'state' ? [[tweak.id, (tweak.options ?? []).map(option => typeof option === 'string' ? option : option.value)]] : [])),
    }] as const];
  });
  return captured.length ? { mocks: Object.fromEntries(captured) } : undefined;
}

// Bridge spec, Frame CSP. HTTPS only, so frame scripts cannot reach any local server.
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob:; connect-src https:; form-action 'none'; base-uri 'none'";

// Prepending, not searching for <head>, keeps the policy first even when the author's markup hides a <head> in a comment or script.
// The parser then folds the author's doctype, <html>, and <head> into this head.
export function mockDocument(html: string): string {
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
