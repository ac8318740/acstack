import { useEffect, useState } from 'react';
import type { AlignmentPack, ReviewAnnotation } from '../lib/alignment-packs.js';
import { PACK_DATA_ID } from '../lib/alignment-review-protocol.js';

export const pack = JSON.parse(document.getElementById(PACK_DATA_ID)?.textContent ?? '{}') as AlignmentPack;

// A comment as the CLI accepts it, plus a local id the viewer drops on export.
export type Annotation = ReviewAnnotation & { id: string };

export type Draft = { target: Annotation['target']; selectedText?: string; anchor: DOMRect };

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
export function useStored<T>(name: string, initial: T): [T, (value: T) => void] {
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be off for file:// pages; comments then last for the session only.
    }
  }, [key, value]);
  return [value, setValue];
}
