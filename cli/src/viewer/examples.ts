declare const OD_BRIDGE_JS: string;

// One example attached to a design element. `path` is relative to the element folder and is the example's identity.
export type ElementExample = {
  path: string;
  title: string;
  illustrative?: boolean;
} & (
  // An OpenDesigner build is one self-contained HTML file, shown exactly like inline HTML.
  | { kind: 'html' | 'od-build'; html: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'fixture'; format: 'json' | 'csv'; data: string }
);

// shortcut: no example source ships yet; node 011 replaces this with the map's element examples.
let source: (nodeId: string) => ElementExample[] = () => [];
export const examplesFor = (nodeId: string) => source(nodeId);
export const setExampleSource = (next: (nodeId: string) => ElementExample[]) => { source = next; };

// Bridge spec, Frame CSP. HTTPS only, so frame scripts cannot reach any local server.
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob:; connect-src https:; form-action 'none'; base-uri 'none'";

// Prepending, not searching for <head>, keeps the policy first even when the author's markup hides a <head> in a comment or script.
// The parser then folds the author's doctype, <html>, and <head> into this head.
export function exampleDocument(html: string): string {
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

// RFC 4180: quoted fields may hold commas, newlines, and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
