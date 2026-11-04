import type { AlignmentPack, MapQuestion } from '../lib/alignment-packs.js';
import type { Diagram } from './alignment-graph.js';

export const questionScopeForSelection = (selected: string | null): string => selected && selected !== 'group:design:root' ? `selection:${selected}` : 'all';

export function questionsForScope(questions: MapQuestion[], scope: string, diagram: Diagram, graph: AlignmentPack['graph']): MapQuestion[] {
  if (scope === 'all') return questions;
  return questions.filter(question => scope.startsWith('selection:')
    ? questionLocation(question, diagram, graph) === scope.slice(10)
    : `${question.target.type === 'node' ? 'item' : 'edge'}:${question.target.id}` === scope);
}

// Project hidden targets onto their visible container or merged relationship.
export function questionLocation(question: MapQuestion, diagram: Diagram, graph: AlignmentPack['graph']): string {
  if (question.target.type === 'node') return diagram.nodeToVisible[question.target.id] ?? `item:${question.target.id}`;
  const visible = diagram.edges.find(edge => edge.childEdgeIds.includes(question.target.id));
  if (visible) return `edge:${visible.childEdgeIds[0]}`;
  const edge = graph.edges.find(edge => edge.id === question.target.id);
  const from = edge && diagram.nodeToVisible[edge.fromNodeId];
  const to = edge && diagram.nodeToVisible[edge.toNodeId];
  return from && from === to ? from : `edge:${question.target.id}`;
}
