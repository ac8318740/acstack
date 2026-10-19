import { useEffect, useState } from 'react';
import type { AlignmentPack, ReviewAnnotation } from '../lib/alignment-packs.js';
import { PACK_DATA_ID, REVIEW_HANDOFF_ID, REVIEW_MODE_META, REVIEW_TOKEN_META } from '../lib/alignment-review-protocol.js';
import { createReviewSync, type ReviewSyncCache } from './review-sync.js';

export const pack = JSON.parse(document.getElementById(PACK_DATA_ID)?.textContent ?? '{}') as AlignmentPack;

// Local metadata never goes to the CLI; null marks a quote outside eligible source text.
export type Annotation = ReviewAnnotation & { id: string; quoteAnchor?: import('./quote-anchors.js').QuoteAnchor | null };

// getRandomValues also works on HTTP previews, where randomUUID is unavailable.
export const annotationId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export type Draft = { target: Annotation['target']; selectedText?: string; anchor: DOMRect; range: Range };

// Selection ids: item:<node>, group:<group>, edge:<edge>. An edge id may sit inside a merged arrow.
export const diagramId = (target: Annotation['target']) => `${target.type === 'node' ? 'item' : target.type}:${target.id}`;

const labelOf = (id: string) => pack.graph.nodes.find(node => node.id === id)?.label ?? id;

export function targetLabel(target: Annotation['target']): string {
  if (target.type === 'edge') {
    const edge = pack.graph.edges.find(item => item.id === target.id);
    return edge ? `${labelOf(edge.fromNodeId)} → ${labelOf(edge.toNodeId)}` : target.id;
  }
  const list = target.type === 'node' ? pack.graph.nodes : pack.graph.groups;
  return list.find(item => item.id === target.id)?.label ?? target.id;
}

// Comments survive a reload so a reviewer can work across sittings; the key pins them to this pack version.
export function useStored<T>(name: string, initial: T, enabled = true): [T, (value: T) => void] {
  const key = `alignment-pack:${pack.packVersion}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be off for file:// pages; comments then last for the session only.
    }
  }, [key, value, enabled]);
  return [value, setValue];
}

const token = document.querySelector<HTMLMetaElement>(`meta[name="${REVIEW_TOKEN_META}"]`)?.content;
export const liveComments = Boolean(token && document.querySelector<HTMLMetaElement>(`meta[name="${REVIEW_MODE_META}"]`)?.content === 'comments');
export const handoffPrompt = (() => {
  if (!liveComments) return null;
  try {
    const prompt: unknown = JSON.parse(document.getElementById(REVIEW_HANDOFF_ID)?.textContent ?? 'null');
    return typeof prompt === 'string' ? prompt : null;
  } catch { return null; }
})();
const annotationKey = `alignment-pack:${pack.packVersion}:annotations`;
const syncKey = `${annotationKey}:sync`;
const initialCache = (): ReviewSyncCache => {
  try {
    const saved = localStorage.getItem(syncKey);
    if (saved) return JSON.parse(saved) as ReviewSyncCache;
    const annotations = JSON.parse(localStorage.getItem(annotationKey) ?? '[]') as Annotation[];
    return { annotations, pending: annotations.length > 0 };
  } catch { return { annotations: [], pending: false }; }
};
const sync = liveComments ? createReviewSync({
  packVersion: pack.packVersion, token: token ?? '', initial: initialCache(), id: annotationId,
  persist: cache => {
    try {
      localStorage.setItem(syncKey, JSON.stringify(cache));
      localStorage.setItem(annotationKey, JSON.stringify(cache.annotations));
    } catch { /* The in-memory draft remains editable when storage is unavailable. */ }
  },
}) : null;

export function useReviewAnnotations() {
  const [local, setLocal] = useStored<Annotation[]>('annotations', [], !liveComments);
  const [state, setState] = useState(sync?.getSnapshot());
  useEffect(() => {
    if (!sync) return;
    const unsubscribe = sync.subscribe(() => setState(sync.getSnapshot()));
    setState(sync.getSnapshot());
    sync.start();
    return unsubscribe;
  }, []);
  return { annotations: state?.annotations ?? local, setAnnotations: sync?.setAnnotations ?? setLocal, syncState: state, flush: sync?.flush, retry: () => sync?.retry() };
}
