import { existsSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { mapDir } from './nodes.js';

/** One changed file. `elementId` is set when the file sits in an element's folder, such as a fixture. */
export type DesignChange = { file: string; elementId?: string };

/**
 * Extra directories a running design doc watches, such as the OpenDesigner
 * designs its examples reference. Node 011 registers one; each call returns
 * absolute paths, and missing ones are skipped.
 */
export const designWatchRoots: Array<(root: string, map: string) => string[]> = [];

/**
 * Called with each settled batch before the server rebuilds the page, so a
 * cache, such as node 011's example loader, can drop what changed.
 */
export const designChangeListeners = new Set<(changes: DesignChange[]) => void>();

const reviewsDir = (root: string, map: string) => join(root, 'design-reviews', map);

/**
 * Tell a running design doc to rebuild. The files tracker needs no call, since
 * the server watches the map folder; GitHub writes go through `gh`, so agents
 * run `design-doc refresh` after one. Writes nothing when no review was ever opened.
 */
export function notifyDesign(root: string, map: string): boolean {
  const dir = reviewsDir(root, map);
  if (!existsSync(dir)) return false;
  writeFileSync(join(dir, 'notify'), `${Date.now()}\n`);
  return true;
}

/**
 * Watch a design doc's sources and report each settled batch of changes.
 * Review records live beside the notify file, so that folder reports only `notify`.
 */
export function watchDesign(root: string, map: string, onChange: (changes: DesignChange[]) => void, settleMs = 100): () => void {
  const pending = new Map<string, DesignChange>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elements = join(mapDir(root, map), 'elements');
  const report = (file: string) => {
    const inElements = relative(elements, file);
    const elementId = !inElements.startsWith('..') && inElements !== '' ? inElements.split(sep)[0] : undefined;
    pending.set(file, { file, ...(elementId && { elementId }) });
    clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending.values()];
      pending.clear();
      for (const listener of designChangeListeners) listener(batch);
      onChange(batch);
    }, settleMs);
  };
  const watchers = new Map<string, FSWatcher>();
  // One flat watcher per folder: Node's recursive mode on Linux polls existing files, which lags by seconds.
  const add = (dir: string, recursive: boolean, keep: (name: string) => boolean = () => true, fresh = false) => {
    if (watchers.has(dir) || !existsSync(dir)) return;
    watchers.set(dir, watch(dir, (event, name) => {
      if (!name || !keep(name)) return;
      const file = resolve(dir, name);
      // A new folder, such as a fresh element folder, needs its own watcher.
      if (recursive && event === 'rename') scan(file);
      report(file);
    }));
    // Files written into a fresh folder before its watcher existed still count as changes.
    for (const entry of recursive ? readdirSync(dir, { withFileTypes: true }) : []) {
      if (entry.isDirectory()) add(join(dir, entry.name), true, keep, fresh);
      else if (fresh) report(join(dir, entry.name));
    }
  };
  const scan = (path: string) => { try { if (statSync(path).isDirectory()) add(path, true, undefined, true); } catch { /* Removed before we looked. */ } };
  add(mapDir(root, map), true);
  add(reviewsDir(root, map), false, name => name === 'notify');
  for (const roots of designWatchRoots) for (const dir of roots(root, map)) add(dir, true);
  return () => { clearTimeout(timer); for (const watcher of watchers.values()) watcher.close(); };
}
