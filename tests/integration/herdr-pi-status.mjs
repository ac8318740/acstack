// Exercise the reporter's real JSON writer; only the external socket is fake.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const reporter = pathToFileURL(process.argv[2]);
let instance = 0;
const drain = async () => {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
};

async function session(run, mode = 'tui') {
  const savedConnect = net.createConnection;
  const savedEnv = { ...process.env };
  const requests = [];
  net.createConnection = () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.write = line => {
      requests.push(JSON.parse(line));
      queueMicrotask(() => socket.emit('data', Buffer.from('{}\n')));
      return true;
    };
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
  Object.assign(process.env, {
    HERDR_ENV: '1', HERDR_SOCKET_PATH: '/fake/herdr.sock', HERDR_PANE_ID: 'parent-pane',
  });
  const bus = new EventEmitter();
  const hooks = new Map();
  let idle = true;
  const ctx = {
    mode, hasUI: true, isIdle: () => idle,
    sessionManager: {
      getSessionId: () => 'parent-session',
      getSessionFile: () => '/fake/parent-session.jsonl',
    },
  };
  const api = {
    events: { on: (name, fn) => { bus.on(name, fn); return () => bus.off(name, fn); } },
    on(name, fn) {
      const handlers = hooks.get(name) ?? [];
      handlers.push(fn);
      hooks.set(name, handlers);
    },
  };
  async function hook(name, event = {}) {
    for (const fn of hooks.get(name) ?? []) await fn(event, ctx);
    await drain();
  }
  const states = () => requests.filter(request => request.method === 'pane.report_agent');
  const expectState = expected => {
    const reports = states();
    assert.ok(reports.length, 'real reporter must write a state request');
    const params = reports.at(-1).params;
    assert.equal(params.state, expected);
    assert.equal(params.pane_id, 'parent-pane');
    assert.equal(params.source, 'herdr:pi');
  };
  try {
    const extension = await import(`${reporter.href}?test=${instance++}`);
    await extension.default(api);
    await hook('session_start', { reason: 'startup' });
    await run({
      requests, expectState,
      async emit(name, payload) { bus.emit(name, payload); await drain(); },
      async start() { idle = false; await hook('agent_start'); },
      async settle() { idle = true; await hook('agent_settled'); },
    });
  } finally {
    await drain();
    net.createConnection = savedConnect;
    process.env = savedEnv;
  }
}

test('parent settle with two children stays working until the final completion or failure', async () => {
  await session(async s => {
    s.expectState('idle');
    await s.start();
    s.expectState('working');
    await s.emit('subagents:started', { id: 'one' });
    await s.emit('subagents:started', { id: 'two' });
    await s.settle();
    s.expectState('working');
    await s.emit('subagents:completed', { id: 'one' });
    s.expectState('working');
    await s.emit('subagents:failed', { id: 'two' });
    s.expectState('idle');
  });
});

test('duplicate starts and unknown completions do not leak or release child activity', async () => {
  await session(async s => {
    await s.emit('subagents:started', { id: 'child' });
    await s.emit('subagents:started', { id: 'child' });
    s.expectState('working');
    await s.emit('subagents:completed', { id: 'unknown' });
    await s.emit('subagents:failed', { id: 'unknown' });
    s.expectState('working');
    await s.emit('subagents:completed', { id: 'child' });
    s.expectState('idle');
  });
});

test('balanced busy intervals compose with child IDs and never clear an active parent', async () => {
  await session(async s => {
    await s.emit('herdr:busy', { active: true });
    await s.emit('herdr:busy', { active: true });
    await s.emit('subagents:started', { id: 'child' });
    s.expectState('working');
    await s.emit('herdr:busy', { active: false });
    s.expectState('working');
    await s.emit('subagents:completed', { id: 'child' });
    s.expectState('working');
    await s.emit('herdr:busy', { active: false });
    s.expectState('idle');
    await s.start();
    await s.emit('herdr:busy', { active: true });
    await s.emit('herdr:busy', { active: false });
    s.expectState('working');
    await s.settle();
    s.expectState('idle');
  });
});

test('blocked takes precedence over parent and child activity', async () => {
  await session(async s => {
    await s.start();
    await s.emit('herdr:blocked', { active: true });
    s.expectState('blocked');
    await s.emit('subagents:started', { id: 'child' });
    await s.emit('herdr:busy', { active: true });
    await s.settle();
    s.expectState('blocked');
    await s.emit('herdr:blocked', { active: false });
    s.expectState('working');
    await s.emit('subagents:completed', { id: 'child' });
    await s.emit('herdr:busy', { active: false });
    s.expectState('idle');
  });
});

test('malformed child data cannot start or release activity', async () => {
  await session(async s => {
    const malformed = [undefined, null, {}, { id: 42 }, { active: 'true' }];
    for (const data of malformed) {
      await s.emit('subagents:started', data);
      s.expectState('idle');
    }
    await s.emit('subagents:started', { id: 'child' });
    for (const data of malformed) {
      await s.emit('subagents:completed', data);
      await s.emit('subagents:failed', data);
      s.expectState('working');
    }
    await s.emit('subagents:completed', { id: 'child' });
    s.expectState('idle');
  });
});

for (const mode of ['print', 'rpc']) {
  test(`${mode} child cannot write to the inherited parent pane`, async () => {
    await session(async s => {
      await s.start();
      await s.emit('subagents:started', { id: 'nested' });
      await s.emit('herdr:busy', { active: true });
      await s.emit('herdr:blocked', { active: true });
      await s.settle();
      await s.emit('subagents:completed', { id: 'nested' });
      await s.emit('herdr:busy', { active: false });
      await s.emit('herdr:blocked', { active: false });
      assert.deepEqual(s.requests, [], 'headless child must send no requests to parent socket');
    }, mode);
  });
}
