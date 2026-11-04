import { describe, expect, it, vi } from 'vitest';
import { createReviewSync } from '../review-sync.js';
import type { ReviewAnnotation } from '../../lib/alignment-packs.js';

type Cache = Parameters<typeof createReviewSync>[0]['initial'];
const packVersion = 'design-v1';
const token = 'private-review-token';
const wire = (comment = 'Keep records local'): ReviewAnnotation => ({
  packVersion, target: { type: 'node', id: 'app' }, selectedText: 'Runs commands', comment,
});
const local = (comment = 'Keep records local') => ({
  ...wire(comment), id: 'local-comment', quoteAnchor: { prefix: 'Before ', suffix: ' after' },
});
const snapshot = (revision: number, annotations: ReviewAnnotation[] = []) => ({ packVersion, revision, annotations });

function transport() {
  const calls: {
    method: string; url: string; headers: Headers; body: unknown;
    resolve: (response: Response) => void; reject: (error: Error) => void;
  }[] = [];
  const fetcher: typeof fetch = (input, init) => new Promise<Response>((resolve, reject) => {
    calls.push({
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined,
      resolve, reject,
    });
  });
  const next = async (index: number) => {
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(index));
    return calls[index];
  };
  const reply = async (index: number, body: unknown, status = 200) => {
    const call = await next(index);
    call.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  };
  return { calls, fetcher, next, reply };
}

function setup(initial: Cache = { annotations: [], pending: false }, net = transport()) {
  const persisted: Cache[] = [];
  let counter = 0;
  const controller = createReviewSync({
    packVersion, token, initial,
    persist: cache => { persisted.push(structuredClone(cache)); },
    id: () => `hydrated-${++counter}`,
    fetch: net.fetcher,
  });
  const state = controller.getSnapshot;
  const saved = async () => { await vi.waitFor(() => expect(state().status).toBe('Saved')); };
  const failed = async () => { await vi.waitFor(() => expect(state().status).toBe('Not synced')); };
  const cache = () => {
    expect(persisted.length).toBeGreaterThan(0);
    return persisted[persisted.length - 1];
  };
  return { controller, state, saved, failed, cache, net };
}

describe('live review synchronization public contract', () => {
  it('hydrates the server without posting default empty comments and makes repeated start calls idempotent', async () => {
    const f = setup();
    const listener = vi.fn();
    const unsubscribe = f.controller.subscribe(listener);
    f.controller.start();
    f.controller.start();
    const get = await f.net.next(0);
    expect(get.method).toBe('GET');
    expect(new URL(get.url, 'http://localhost').pathname).toBe('/api/annotations');
    expect(get.headers.get('x-review-token')).toBe(token);
    await f.net.reply(0, snapshot(4, [wire()]));
    await f.saved();
    expect(f.state().annotations.map(({ comment, target }) => ({ comment, target }))).toEqual([
      { comment: 'Keep records local', target: { type: 'node', id: 'app' } },
    ]);
    expect(f.net.calls.map(call => call.method)).toEqual(['GET']);
    expect(f.cache()).toMatchObject({ revision: 4, pending: false });
    unsubscribe();
  });

  it('preserves matching local identity and quote context when hydrating acknowledged server comments', async () => {
    const f = setup({ annotations: [local()], revision: 2, pending: false });
    f.controller.start();
    await f.net.reply(0, snapshot(2, [wire()]));
    await f.saved();
    expect(f.state().annotations).toEqual([local()]);
    expect(f.net.calls.map(call => call.method)).toEqual(['GET']);
  });

  it('uploads pending legacy comments with strict wire fields and reports Saved only after acknowledgment', async () => {
    const f = setup({ annotations: [local()], pending: true });
    f.controller.start();
    await f.net.reply(0, snapshot(0));
    const post = await f.net.next(1);
    expect(post.method).toBe('POST');
    expect(new URL(post.url, 'http://localhost').pathname).toBe('/api/annotations');
    expect(post.headers.get('x-review-token')).toBe(token);
    expect(post.body).toEqual(snapshot(0, [wire()]));
    expect(f.state().status).not.toBe('Saved');
    expect(f.state().annotations).toEqual([local()]);
    expect(f.cache().pending).toBe(true);
    await f.net.reply(1, snapshot(1, [wire()]));
    await f.saved();
    expect(f.state().annotations).toEqual([local()]);
    expect(f.cache()).toMatchObject({ revision: 1, pending: false });
  });

  it('serializes post, edit, and last-comment deletion without letting an older acknowledgment erase newer edits', async () => {
    const f = setup();
    f.controller.start();
    await f.net.reply(0, snapshot(0));
    await f.saved();
    f.controller.setAnnotations([local('First')]);
    expect((await f.net.next(1)).body).toEqual(snapshot(0, [wire('First')]));
    f.controller.setAnnotations([local('Second')]);
    f.controller.setAnnotations([local('Latest')]);
    expect(f.net.calls).toHaveLength(2);
    expect(f.state().annotations).toEqual([local('Latest')]);
    await f.net.reply(1, snapshot(1, [wire('First')]));
    expect((await f.net.next(2)).body).toEqual(snapshot(1, [wire('Latest')]));
    expect(f.state().status).not.toBe('Saved');
    expect(f.state().annotations).toEqual([local('Latest')]);
    await f.net.reply(2, snapshot(2, [wire('Latest')]));
    await f.saved();
    f.controller.setAnnotations([]);
    expect((await f.net.next(3)).body).toEqual(snapshot(2));
    expect(f.state().status).not.toBe('Saved');
    await f.net.reply(3, snapshot(3));
    await f.saved();
    expect(f.state().annotations).toEqual([]);
    expect(f.cache()).toMatchObject({ revision: 3, pending: false, annotations: [] });
  });

  it('retains failed edits in durable cache and uploads them after reload only when the server base is unchanged', async () => {
    const f = setup();
    f.controller.start();
    await f.net.reply(0, snapshot(3));
    await f.saved();
    f.controller.setAnnotations([local('Recover this edit')]);
    (await f.net.next(1)).reject(new Error('Network offline'));
    await f.failed();
    expect(f.state().annotations).toEqual([local('Recover this edit')]);
    expect(f.cache()).toMatchObject({ revision: 3, pending: true, annotations: [local('Recover this edit')] });
    const resumed = setup(f.cache());
    resumed.controller.start();
    await resumed.net.reply(0, snapshot(3));
    expect((await resumed.net.next(1)).body).toEqual(snapshot(3, [wire('Recover this edit')]));
    await resumed.net.reply(1, snapshot(4, [wire('Recover this edit')]));
    await resumed.saved();
    expect(resumed.state().annotations).toEqual([local('Recover this edit')]);
  });

  it('retries a failed save without losing local comments', async () => {
    const f = setup({ annotations: [local()], revision: 0, pending: true });
    f.controller.start();
    await f.net.reply(0, snapshot(0));
    await f.net.reply(1, { error: 'Unavailable' }, 503);
    await f.failed();
    expect(f.state().annotations).toEqual([local()]);
    expect(f.cache().pending).toBe(true);
    f.controller.retry();
    const retry = await f.net.next(2);
    if (retry.method === 'GET') {
      await f.net.reply(2, snapshot(0));
      expect((await f.net.next(3)).body).toEqual(snapshot(0, [wire()]));
      await f.net.reply(3, snapshot(1, [wire()]));
    } else {
      expect(retry.method).toBe('POST');
      expect(retry.body).toEqual(snapshot(0, [wire()]));
      await f.net.reply(2, snapshot(1, [wire()]));
    }
    await f.saved();
    expect(f.state().annotations).toEqual([local()]);
    expect(f.cache().pending).toBe(false);
  });

  it('preserves conflicting local edits without overwriting an advanced server during reload or retry', async () => {
    const f = setup({ annotations: [local('Unsaved local edit')], revision: 2, pending: true });
    f.controller.start();
    await f.net.reply(0, snapshot(3, [wire('Other reviewer edit')]));
    await f.failed();
    expect(f.state().annotations).toEqual([local('Unsaved local edit')]);
    expect(f.cache()).toMatchObject({ pending: true, annotations: [local('Unsaved local edit')] });
    expect(f.net.calls.map(call => call.method)).toEqual(['GET']);
    f.controller.retry();
    // A retry may recheck the server, but cannot authorize overwriting its newer snapshot.
    await new Promise(resolve => setTimeout(resolve, 25));
    if (f.net.calls.length === 2) await f.net.reply(1, snapshot(3, [wire('Other reviewer edit')]));
    await f.failed();
    expect(f.net.calls.every(call => call.method === 'GET')).toBe(true);
    expect(f.state().annotations).toEqual([local('Unsaved local edit')]);
  });

  it.each([false, true])('recovers a lost acknowledgment while preserving a newer pending edit: %s', async newerEdit => {
    const f = setup({ annotations: [local('Accepted before disconnect')], revision: 0, pending: true });
    f.controller.start();
    await f.net.reply(0, snapshot(0));
    expect((await f.net.next(1)).body).toEqual(snapshot(0, [wire('Accepted before disconnect')]));
    if (newerEdit) f.controller.setAnnotations([local('Newer pending edit')]);
    f.net.calls[1].reject(new Error('Response lost after server commit'));
    await f.failed();
    const resumed = setup(f.cache());
    resumed.controller.start();
    await resumed.net.reply(0, snapshot(1, [wire('Accepted before disconnect')]));
    await vi.waitFor(() => expect(resumed.state().status === 'Saved' || resumed.net.calls.length > 1).toBe(true));
    let nextPost = 1;
    const oldAttempt = snapshot(0, [wire('Accepted before disconnect')]);
    if (resumed.net.calls[1] && JSON.stringify(resumed.net.calls[1].body) === JSON.stringify(oldAttempt)) {
      expect(resumed.net.calls[1].method).toBe('POST');
      expect(resumed.state().status).not.toBe('Saved');
      expect(resumed.state().annotations).toEqual([local(newerEdit ? 'Newer pending edit' : 'Accepted before disconnect')]);
      await resumed.net.reply(1, snapshot(1, [wire('Accepted before disconnect')]));
      nextPost = 2;
    }
    if (newerEdit) {
      const request = await resumed.net.next(nextPost);
      expect(request.method).toBe('POST');
      expect(request.body).toEqual(snapshot(1, [wire('Newer pending edit')]));
      expect(resumed.state().status).not.toBe('Saved');
      expect(resumed.state().annotations).toEqual([local('Newer pending edit')]);
      await resumed.net.reply(nextPost, snapshot(2, [wire('Newer pending edit')]));
    }
    await resumed.saved();
    expect(resumed.state().annotations).toEqual([local(newerEdit ? 'Newer pending edit' : 'Accepted before disconnect')]);
    expect(resumed.cache().pending).toBe(false);
    expect(resumed.net.calls).toHaveLength(newerEdit ? nextPost + 1 : nextPost);
  });

  it.each(['wrong version', 'different comments'] as const)('does not acknowledge a pending edit when the POST response has %s', async mismatch => {
    const f = setup({ annotations: [local()], revision: 0, pending: true });
    f.controller.start();
    await f.net.reply(0, snapshot(0));
    await f.net.next(1);
    await f.net.reply(1, mismatch === 'wrong version'
      ? { ...snapshot(1, [wire()]), packVersion: 'foreign-version' }
      : snapshot(1, [wire('Not the submitted comment')]));
    await f.failed();
    expect(f.state().annotations).toEqual([local()]);
    expect(f.cache()).toMatchObject({ pending: true, annotations: [local()] });
  });
});

describe('flush barrier', () => {
  it('waits for coalesced edits and real acknowledgments without overlapping requests', async () => {
    const f = setup();
    const flushed = vi.fn();
    const barrier = f.controller.flush().then(flushed);
    await f.net.reply(0, snapshot(0));
    await barrier;
    expect(f.net.calls).toHaveLength(1);
    f.controller.setAnnotations([local('First')]);
    const pending = f.controller.flush().then(flushed);
    f.controller.setAnnotations([local('Latest')]);
    await f.net.reply(1, snapshot(1, [wire('First')]));
    expect((await f.net.next(2)).body).toEqual(snapshot(1, [wire('Latest')]));
    expect(flushed).toHaveBeenCalledTimes(1);
    await f.net.reply(2, snapshot(2, [wire('Latest')]));
    await pending;
    expect(flushed).toHaveBeenCalledTimes(2);
    await f.controller.flush();
    expect(f.net.calls).toHaveLength(3);
  });

  it.each(['failure', 'conflict', 'invalid acknowledgment', 'invalid revision'])('rejects %s without discarding drafts', async failure => {
    const f = setup({ annotations: [local()], revision: 0, pending: true });
    const result = expect(f.controller.flush()).rejects.toThrow();
    await f.net.reply(0, failure === 'conflict' ? snapshot(3, [wire('Remote')]) : snapshot(0));
    if (failure !== 'conflict') await f.net.reply(1, failure === 'failure' ? { error: 'Unavailable' }
      : failure === 'invalid revision' ? snapshot(7, [wire()]) : snapshot(1, [wire('Wrong')]), failure === 'failure' ? 503 : 200);
    await result;
    expect(f.state().annotations).toEqual([local()]);
    expect(f.cache().pending).toBe(true);
  });

  it('retries a lost acknowledgment before flushing a newer edit', async () => {
    const f = setup({ annotations: [local()], revision: 0, pending: true });
    const result = expect(f.controller.flush()).rejects.toThrow('Response lost');
    await f.net.reply(0, snapshot(0));
    (await f.net.next(1)).reject(new Error('Response lost'));
    await result;
    const barrier = f.controller.flush();
    f.controller.setAnnotations([local('Newer')]);
    await f.net.reply(2, snapshot(1, [wire()]));
    expect((await f.net.next(3)).body).toEqual(snapshot(0, [wire()]));
    await f.net.reply(3, snapshot(1, [wire()]));
    expect((await f.net.next(4)).body).toEqual(snapshot(1, [wire('Newer')]));
    await f.net.reply(4, snapshot(2, [wire('Newer')]));
    await barrier;
    expect(f.cache().pending).toBe(false);
  });
});
