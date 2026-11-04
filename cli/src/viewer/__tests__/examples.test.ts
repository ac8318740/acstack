import { afterEach, expect, it } from 'vitest';
import { exampleDocument, FRAME_CSP, fixtureTable, frameUrl, parseCsv } from '../examples.js';

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

it('loads only web URLs in a URL frame', () => {
  expect(frameUrl('http://127.0.0.1:5180/designs/a.html')).toBe('http://127.0.0.1:5180/designs/a.html');
  expect(frameUrl('https://example.com/b')).toBe('https://example.com/b');
  for (const url of ['javascript:alert(1)', 'data:text/html,<p>', 'file:///etc/passwd', 'not a url']) expect(frameUrl(url)).toBeNull();
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
