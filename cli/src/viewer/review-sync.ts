import type { ReviewAnnotation } from '../lib/alignment-packs.js';
import { ANNOTATIONS_PATH, REVIEW_TOKEN_HEADER } from '../lib/alignment-review-protocol.js';
import type { Annotation } from './pack.js';
import { toReviewAnnotation } from './quote-anchors.js';

type Snapshot = { packVersion: string; revision: number; annotations: ReviewAnnotation[] };
export type ReviewSyncState = { annotations: Annotation[]; status: 'Saved' | 'Saving' | 'Not synced'; error?: string };
export type ReviewSyncCache = { annotations: Annotation[]; revision?: number; pending: boolean; attempted?: ReviewAnnotation[] };
const wire = (annotations: Annotation[]) => annotations.map(toReviewAnnotation);
const equal = (a: ReviewAnnotation[], b: ReviewAnnotation[]) => JSON.stringify(a) === JSON.stringify(b);

// One controller survives React StrictMode effect replay; requests never overlap.
export function createReviewSync(options: {
  packVersion: string;
  token: string;
  initial: ReviewSyncCache;
  persist: (cache: ReviewSyncCache) => void;
  id: () => string;
  fetch?: typeof fetch;
}) {
  const request = options.fetch ?? fetch;
  let cache = options.initial;
  let state: ReviewSyncState = { annotations: cache.annotations, status: 'Saving' };
  let initialized = false;
  let running: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (status: ReviewSyncState['status'], error?: string) => {
    state = { annotations: cache.annotations, status, error };
    options.persist(cache);
    for (const listener of listeners) listener();
  };
  const read = async (method: 'GET' | 'POST', body?: Snapshot): Promise<Snapshot> => {
    const response = await request(ANNOTATIONS_PATH, {
      method, headers: { [REVIEW_TOKEN_HEADER]: options.token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Comment sync failed (${response.status})`);
    if (result.packVersion !== options.packVersion || !Number.isSafeInteger(result.revision) || result.revision < 0 || !Array.isArray(result.annotations)) throw new Error('Invalid comment sync response');
    return result;
  };
  const restore = (annotations: ReviewAnnotation[]) => {
    const remaining = [...cache.annotations];
    return annotations.map(annotation => {
      const index = remaining.findIndex(local => equal(wire([local]), [annotation]));
      if (index >= 0) return remaining.splice(index, 1)[0];
      return { ...annotation, id: options.id() };
    });
  };
  const run = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      publish('Saving');
      try {
        if (!initialized) {
          const server = await read('GET');
          const same = equal(server.annotations, wire(cache.annotations));
          const acknowledgedAttempt = cache.attempted && equal(server.annotations, cache.attempted) && server.revision === (cache.revision ?? 0) + 1;
          if (cache.pending && !same && server.revision > 0 && server.revision !== cache.revision && !acknowledgedAttempt) {
            throw new Error('Comments changed in another page. Local drafts are preserved; reconcile them before retrying.');
          }
          if (acknowledgedAttempt && cache.attempted) {
            // GET discovers a lost response; only the idempotent POST retry acknowledges that write.
            const acknowledged = await read('POST', { packVersion: options.packVersion, revision: cache.revision ?? 0, annotations: cache.attempted });
            if (acknowledged.revision !== server.revision || !equal(acknowledged.annotations, cache.attempted)) throw new Error('Comment sync acknowledgement did not match');
            cache = { ...cache, revision: acknowledged.revision, attempted: undefined, pending: !equal(wire(cache.annotations), acknowledged.annotations) };
          } else if (!cache.pending || same) cache = { annotations: restore(server.annotations), revision: server.revision, pending: false };
          else cache = { ...cache, revision: server.revision, attempted: undefined };
          initialized = true;
        }
        while (cache.pending) {
          const annotations = wire(cache.annotations);
          cache = { ...cache, attempted: annotations };
          options.persist(cache);
          const result = await read('POST', { packVersion: options.packVersion, revision: cache.revision ?? 0, annotations });
          if (!equal(result.annotations, annotations) || result.revision !== (cache.revision ?? 0) + 1) throw new Error('Comment sync acknowledgement did not match');
          cache = { ...cache, revision: result.revision, attempted: undefined, pending: !equal(wire(cache.annotations), annotations) };
          publish(cache.pending ? 'Saving' : 'Saved');
        }
        publish('Saved');
      } catch (error) {
        initialized = false;
        publish('Not synced', error instanceof Error ? error.message : String(error));
      }
    })().finally(() => { running = undefined; });
    return running;
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    flush: async (): Promise<void> => {
      await run();
      if (state.status !== 'Saved' || cache.pending) throw new Error(state.error ?? 'Comments are not synced');
    },
    start: () => { void run(); },
    retry: () => { void run(); },
    setAnnotations: (annotations: Annotation[]) => {
      cache = { ...cache, annotations, pending: true };
      publish('Saving');
      void run();
    },
  };
}
