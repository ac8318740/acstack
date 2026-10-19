import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadDesignDoc } from './design-doc.js';

// Exercise Windows containment paths against real files and symlinks on this host.
vi.mock('node:path', async importOriginal => {
  const path = await importOriginal<typeof import('node:path')>();
  return { ...path, relative: (from: string, to: string) => path.win32.relative(from, to) };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(['element', 'document detail', 'element detail'])('rejects a resolved Windows symlink escape in %s', kind => {
  const root = mkdtempSync(join(tmpdir(), 'design-path-'));
  const outside = mkdtempSync(join(tmpdir(), 'design-outside-'));
  roots.push(root, outside);
  const entry = { id: 'example', name: 'Example', summary: 'Example', elements: ['app.yaml'], ...(kind === 'document detail' ? { detail: 'escape' } : {}) };
  const app = { id: 'app', name: 'App', summary: 'App', kind: 'component', ...(kind === 'element detail' ? { detail: 'escape' } : {}) };
  writeFileSync(join(root, 'design.yaml'), stringify(entry));
  writeFileSync(join(root, 'app.yaml'), stringify(app));
  writeFileSync(join(outside, 'file'), kind === 'element' ? stringify(app) : 'Outside detail');
  symlinkSync(join(outside, 'file'), join(root, kind === 'element' ? 'app-link.yaml' : 'escape'));
  if (kind === 'element') writeFileSync(join(root, 'design.yaml'), stringify({ ...entry, elements: ['app-link.yaml'] }));
  expect(() => loadDesignDoc(join(root, 'design.yaml'))).toThrow(/escapes source directory/);
});
