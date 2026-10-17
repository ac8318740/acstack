// Drives installed Pi extensions through the published event contracts only.
// Run by test-terminal-workspace.sh, with HOME pointing at its offline fixture.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [agentDir, scenario] = process.argv.slice(2);
const events = new EventEmitter();
const hooks = new Map();
const subscribers = [];
const api = {
  events: {
    on(name, handler) {
      events.on(name, handler);
      return () => events.off(name, handler);
    },
    emit: (name, payload) => events.emit(name, payload),
  },
  on(name, handler) {
    const handlers = hooks.get(name) ?? [];
    handlers.push(handler);
    hooks.set(name, handlers);
  },
};
async function extensionFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await extensionFiles(file));
    else if (/\.(ts|js|mjs)$/.test(entry.name)) files.push(file);
  }
  return files;
}
for (const file of await extensionFiles(path.join(agentDir, 'extensions'))) {
  const before = events.listenerCount('rpiv:ask-user:blocked');
  const extension = await import(pathToFileURL(file).href);
  if (typeof extension.default === 'function') await extension.default(api);
  if (events.listenerCount('rpiv:ask-user:blocked') > before) subscribers.push(file);
}
if (scenario === 'locate') {
  console.log(subscribers.join('\n'));
  process.exit(0);
}

// Herdr v8's public contract is a balanced reference count, not last-write wins.
let count = 0;
let floor = 0;
let ceiling = Infinity;
events.on('herdr:blocked', ({ active }) => {
  count += active ? 1 : -1;
  assert.ok(count >= floor, `blocked count ${count} fell below ${floor}`);
  assert.ok(count <= ceiling, `blocked count ${count} exceeded ${ceiling}`);
});
const settle = () => new Promise(resolve => setImmediate(resolve));
const publicWait = active => events.emit('rpiv:ask-user:blocked', { active });
const herdrWait = active => events.emit('herdr:blocked', { active });
const dualWait = active => { publicWait(active); herdrWait(active); };
const expectCount = (expected, message) => assert.equal(count, expected, message);

// Give extensions the ordinary Pi session lifecycle before producer events.
for (const handler of hooks.get('session_start') ?? []) {
  await handler({}, { hasUI: true, ui: { setStatus() {} } });
}
if (['pristine-answer', 'pristine-cancel', 'pristine-error'].includes(scenario)) {
  publicWait(true);
  await settle();
  expectCount(1, 'pristine question must enter blocked while awaiting input');
  // Answer, cancellation and error all end the published active interval.
  publicWait(false);
  await settle();
  expectCount(0, `${scenario.slice(9)} must clear the question blocker`);
} else if (scenario === 'pristine-unrelated') {
  herdrWait(true);
  publicWait(true);
  await settle();
  expectCount(2, 'pristine question must have its own blocker');
  publicWait(false);
  await settle();
  expectCount(1, 'ending a pristine question must preserve unrelated blocker');
  herdrWait(false);
  await settle();
  expectCount(0, 'all waits released');
} else if (scenario === 'dual-unrelated') {
  // Both possible release orders, repeated in the same session.
  for (const unrelatedFirst of [true, false, true, false]) {
    herdrWait(true);
    floor = 1;
    ceiling = 3;
    dualWait(true);
    await settle();
    expectCount(3, 'public and anonymous native sources contribute independent blockers');
    if (unrelatedFirst) {
      herdrWait(false);
      await settle();
      expectCount(2, 'question sources must stay blocked when unrelated wait ends');
      floor = 0;
      dualWait(false);
    } else {
      dualWait(false);
      await settle();
      expectCount(1, 'unrelated wait must survive question completion');
      floor = 0;
      herdrWait(false);
    }
    await settle();
    expectCount(0, 'dual interval must leave no leaked blocker');
    ceiling = Infinity;
  }
  // Compatibility must not turn off pristine producers in a mixed session.
  publicWait(true);
  await settle();
  expectCount(1, 'pristine question still blocks after dual producer cycles');
  publicWait(false);
  await settle();
  expectCount(0, 'mixed session leaves no blocker');
} else {
  throw new Error(`Unknown scenario: ${scenario}`);
}
console.log(`ok ${scenario}`);
