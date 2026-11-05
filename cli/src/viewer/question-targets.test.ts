import { expect, it } from 'vitest';
import { AlignmentPackSchema, type MapQuestion } from '../lib/alignment-packs.js';
import { projectDiagram } from './alignment-graph.js';
import { questionLocation, questionScopeForSelection, questionsForScope } from './question-targets.js';

it('projects and filters questions across folded nodes, hidden internal edges, and merged edges', () => {
  const graph = AlignmentPackSchema.parse({
    packVersion: 'questions@v1', source: { map: { id: 'questions', version: 'v1' } }, viewState: { globalDepth: 1, expandedGroups: [], semanticZoom: 'business' },
    graph: {
      groups: [{ id: 'inside', label: 'Inside', summary: 'Inside' }, { id: 'outside', label: 'Outside', summary: 'Outside' }],
      nodes: ['a', 'b', 'c'].map(id => ({ id, groupId: id === 'c' ? 'outside' : 'inside', label: id, summary: id })),
      edges: [['internal', 'a', 'b'], ['first', 'a', 'c'], ['second', 'b', 'c']].map(([id, fromNodeId, toNodeId]) => ({ id, fromNodeId, toNodeId, label: 'uses', relationship: 'uses', summary: 'uses' })),
    },
  }).graph;
  const question = (type: 'node' | 'edge', id: string): MapQuestion => ({ id: `question-${id}`, target: { type, id }, question: 'Proceed?' });
  const folded = projectDiagram(graph, []);
  expect(questionLocation(question('node', 'a'), folded, graph)).toBe(folded.nodeToVisible.a);
  expect(questionLocation(question('edge', 'internal'), folded, graph)).toBe(folded.nodeToVisible.a);
  const merged = folded.edges.find(edge => edge.childEdgeIds.includes('first'))!;
  expect(merged.childEdgeIds).toContain('second');
  for (const id of ['first', 'second']) expect(questionLocation(question('edge', id), folded, graph)).toBe(`edge:${merged.childEdgeIds[0]}`);
  const questions = [question('node', 'a'), question('edge', 'internal'), question('edge', 'first'), question('edge', 'second'), question('node', 'c')];
  expect(questionScopeForSelection(null)).toBe('all');
  expect(questionScopeForSelection('group:design:root')).toBe('all');
  expect(questionScopeForSelection('item:a')).toBe('selection:item:a');
  expect(questionsForScope(questions, 'all', folded, graph)).toEqual(questions);
  expect(questionsForScope(questions, `selection:${folded.nodeToVisible.a}`, folded, graph).map(q => q.id)).toEqual(['question-a', 'question-internal']);
  expect(questionsForScope(questions, `selection:edge:${merged.childEdgeIds[0]}`, folded, graph).map(q => q.id)).toEqual(['question-first', 'question-second']);
  expect(questionsForScope(questions, 'item:a', folded, graph).map(q => q.id)).toEqual(['question-a']);
  expect(questionsForScope(questions, 'edge:second', folded, graph).map(q => q.id)).toEqual(['question-second']);
  expect(questionsForScope(questions, 'item:unknown', folded, graph)).toEqual([]);
  const expanded = projectDiagram(graph, ['inside', 'outside']);
  expect(questionsForScope(questions, questionScopeForSelection('item:a'), expanded, graph).map(q => q.id)).toEqual(['question-a']);
  expect(questionLocation(question('node', 'a'), expanded, graph)).toBe('item:a');
  expect(questionLocation(question('edge', 'internal'), expanded, graph)).toBe('edge:internal');
});
