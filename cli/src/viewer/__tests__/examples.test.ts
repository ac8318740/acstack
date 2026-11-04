import { afterEach, expect, it } from 'vitest';
import { exampleDocument, FRAME_CSP, fixtureTable, parseCsv } from '../examples.js';
import { ReviewAnnotationSchema } from '../../lib/alignment-packs.js';

const global = globalThis as { OD_BRIDGE_JS?: string };
afterEach(() => { delete global.OD_BRIDGE_JS; });

it('puts the frame CSP first in head, ahead of any author markup', () => {
  const author = '<!-- <head> --><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://evil.test/"></head><body>Hi</body></html>';
  const document = exampleDocument(author);
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
  const document = exampleDocument('<p>Mock</p>');
  expect(document).toContain('<script data-od-bridge>const end = "<\\/script><img');
  expect(document.indexOf('data-od-bridge')).toBeLessThan(document.indexOf('<p>Mock</p>'));
  expect(document.match(/<\/script>/g)).toHaveLength(1);
});

it('keeps the CSP but adds no second bridge to an OpenDesigner build that carries one', () => {
  global.OD_BRIDGE_JS = 'vendored()';
  const document = exampleDocument('<script data-od-bridge>built()</script><p>Build</p>');
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

it('stores a multi-element example anchor with variant and tweak values in the review', () => {
  const example = { path: 'cart', variant: 'a', tweaks: { radius: '8' }, selections: [
    { selector: '#pay', text: 'Pay', rect: { x: 0, y: 0, width: 10, height: 10 }, component: { name: 'PayButton', props: { size: 'lg' }, fixture: 'fixtures/order.json' } },
    { selector: '#total', rect: { x: 0, y: 20, width: 10, height: 10 } },
  ] };
  const annotation = { packVersion: 'v1', target: { type: 'node', id: 'checkout' }, example, comment: 'Align these' } as const;
  expect(ReviewAnnotationSchema.parse(annotation).example).toEqual(example);
  expect(() => ReviewAnnotationSchema.parse({ ...annotation, example: { ...example, html: '<p>' } })).toThrow();
  expect(() => ReviewAnnotationSchema.parse({ ...annotation, example: { ...example, selections: Array(21).fill(example.selections[1]) } })).toThrow();
});
