import { afterEach, expect, it } from 'vitest';
import { cacheMock, cachedMock, mockDocument, FRAME_CSP, fixtureTable, isCurrent, withVariant } from '../mocks.js';
import { parseCsv } from '../../lib/csv.js';
import { ReviewAnnotationSchema } from '../../lib/alignment-packs.js';

const global = globalThis as { OD_BRIDGE_JS?: string };
afterEach(() => { delete global.OD_BRIDGE_JS; });

it('puts the frame CSP first in head, ahead of any author markup', () => {
  const author = '<!-- <head> --><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://evil.test/"></head><body>Hi</body></html>';
  const document = mockDocument(author);
  expect(document.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`)).toBe(true);
  expect(document.endsWith(author)).toBe(true);
});

it('allows HTTPS network but no http: or local connections', () => {
  expect(FRAME_CSP).toContain('connect-src https:;');
  expect(FRAME_CSP).toContain("default-src 'none'");
  expect(FRAME_CSP).toContain("form-action 'none'");
  expect(FRAME_CSP).toContain("base-uri 'none'");
  expect(FRAME_CSP).not.toMatch(/http:|localhost|127\.0\.0\.1/);
});

it('injects the vendored bridge before author markup and keeps it inside its script element', () => {
  global.OD_BRIDGE_JS = 'const end = "</script><img src=x onerror=alert(1)>";';
  const document = mockDocument('<p>Mock</p>');
  expect(document).toContain('<script data-od-bridge>const end = "<\\/script><img');
  expect(document.indexOf('data-od-bridge')).toBeLessThan(document.indexOf('<p>Mock</p>'));
  expect(document.match(/<\/script>/g)).toHaveLength(1);
});

it('keeps the CSP but adds no second bridge to an OpenDesigner build that carries one', () => {
  global.OD_BRIDGE_JS = 'vendored()';
  const document = mockDocument('<script data-od-bridge>built()</script><p>Build</p>');
  expect(document.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`)).toBe(true);
  expect(document).not.toContain('vendored()');
});

it('turns JSON fixtures into text cells', () => {
  expect(fixtureTable('json', '[{"id":1,"name":"<b>Ann</b>"},{"id":2,"tags":["a"]}]')).toEqual({
    columns: ['id', 'name', 'tags'],
    rows: [['1', '<b>Ann</b>', ''], ['2', '', '["a"]']],
  });
  expect(fixtureTable('json', '{"plan":"pro"}')).toEqual({ columns: ['plan'], rows: [['pro']] });
  expect(fixtureTable('json', '[1,"two"]')).toEqual({ columns: ['Value'], rows: [['1'], ['two']] });
  expect(fixtureTable('json', '{oops')).toEqual({ error: 'This fixture is not valid JSON.' });
});

it('parses quoted CSV fields', () => {
  expect(parseCsv('name,note\r\n"Smith, J","said ""hi""\nthen left"\nLee,\n')).toEqual([['name', 'note'], ['Smith, J', 'said "hi"\nthen left'], ['Lee', '']]);
  expect(fixtureTable('csv', 'a,b\n1,2')).toEqual({ columns: ['a', 'b'], rows: [['1', '2']] });
});

it('stores a multi-element mock anchor with variant and tweak values in the review', () => {
  const mock = { path: 'cart', variant: 'a', tweaks: { radius: '8' }, selections: [
    { selector: '#pay', text: 'Pay', rect: { x: 0, y: 0, width: 10, height: 10 }, component: { name: 'PayButton', props: { size: 'lg' }, fixture: 'fixtures/order.json' } },
    { selector: '#total', rect: { x: 0, y: 20, width: 10, height: 10 } },
  ] };
  const annotation = { packVersion: 'v1', target: { type: 'node', id: 'checkout' }, mock, comment: 'Align these' } as const;
  expect(ReviewAnnotationSchema.parse(annotation).mock).toEqual(mock);
  expect(() => ReviewAnnotationSchema.parse({ ...annotation, mock: { ...mock, html: '<p>' } })).toThrow();
  expect(() => ReviewAnnotationSchema.parse({ ...annotation, mock: { ...mock, selections: Array(21).fill(mock.selections[1]) } })).toThrow();
});

it('switches a single-file build to one variant through its od-variant meta', () => {
  const build = '<meta name="od-variant" content="a"><script type="application/json" id="od-page">{}</script>';
  expect(withVariant(build, 'b')).toBe('<meta name="od-variant" content="b"><script type="application/json" id="od-page">{}</script>');
  expect(withVariant(build, '$&"<x')).toContain('content="$&#38;&#34;&#60;x"');
});

it('keeps showing cached content while a newer source revision refetches', () => {
  const mock = { kind: 'html' as const, path: 'a.html', title: 'A', html: '<p>Old</p>' };
  cacheMock('n', mock, '1'.repeat(64));
  expect(isCurrent('n', { path: 'a.html', revision: '1'.repeat(64) })).toBe(true);
  expect(isCurrent('n', { path: 'a.html', revision: '2'.repeat(64) })).toBe(false);
  expect(isCurrent('n', { path: 'b.html' })).toBe(false);
  expect(cachedMock('n', 'a.html')).toBe(mock);
});
