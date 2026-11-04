import type { AlignmentPack } from './alignment-packs.js';
import { PACK_DATA_ID } from './alignment-review-protocol.js';
import { VIEWER_CSS, VIEWER_JS } from './alignment-viewer.generated.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function embeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

// The viewer (src/viewer) is inlined whole, so a pack opens offline with no remote scripts, styles, or fonts.
export function renderAlignmentPackHtml(pack: AlignmentPack): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pack.source.map.id)} · ${pack.documentKind === 'design' ? 'Design document' : 'Alignment review'}</title>
  <style>${VIEWER_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>This review artifact needs JavaScript to draw its diagram.</noscript>
  <script id="${PACK_DATA_ID}" type="application/json">${embeddedJson(pack)}</script>
  <script>${VIEWER_JS}</script>
</body>
</html>`;
}
