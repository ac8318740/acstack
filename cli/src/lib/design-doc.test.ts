import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designDocToPack, designFromNodes, renderDesignDocMarkdown, targetingNodes } from './design-doc.js';
import { generateDesignDoc } from '../commands/design-doc.js';
import { createNode, type GraphNode } from './nodes.js';
import { buildDiagram, initialExpandedGroups } from '../viewer/alignment-graph.js';
import { EX, EXAMPLE_ROOT, exampleDesign } from '../example-design.js';

const block = (summary: string, yaml: string) => `<details>\n<summary>${summary}</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n</details>`;
const node = (id: string, fields: Partial<GraphNode> = {}): GraphNode => ({
  id, title: `Node ${id}`, status: 'open', mode: 'hitl', kind: 'element', label: `Node ${id}`, answers: '001', blockedBy: [], pinned: false, ...fields,
});
function fixture(): GraphNode[] {
  return [
    node('001', { kind: 'destination', answers: undefined, title: 'Example', summary: 'A reviewable design', body: `Overview\n\n${block('Design doc', 'concerns:\n  - {id: privacy, name: Privacy, elements: [002, "003"], requirement: Keep records local, response: Both components use local files}')}` }),
    node('002', { label: 'App', summary: 'Runs commands', body: `App detail\n\n${block('Design element', 'kind: component\nchannels: [cli, agent]\nconnections:\n  - {to: 003, direction: bidirectional, label: Reads and writes}')}\n\n<!-- acstack:diagram -->\nmap diagram\n<!-- /acstack:diagram -->` }),
    node('003', { label: 'Data', summary: 'Keeps records', status: 'resolved', body: block('Design element', 'kind: store') }),
  ];
}
const build = (nodes: GraphNode[]) => designFromNodes('example', nodes);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('design docs built from map nodes', () => {
  it('turns element nodes into a pack with kinds, channels, concerns, edges, and lock state', () => {
    const { doc, warnings } = build(fixture());
    expect(warnings).toEqual([]);
    const pack = designDocToPack(doc);
    expect(pack.designDocument).toMatchObject({ id: 'example', name: 'Example', summary: 'A reviewable design', detail: 'Overview' });
    expect(pack.graph.edges).toEqual([expect.objectContaining({ id: '002-003', fromNodeId: '002', toNodeId: '003', direction: 'bidirectional', label: 'Reads and writes' })]);
    expect(pack.graph.nodes.find(n => n.id === '002')).toMatchObject({ label: 'App', summary: 'Runs commands', elementKind: 'component', channels: ['cli', 'agent'], locked: false });
    expect(pack.graph.nodes.find(n => n.id === '003')).toMatchObject({ elementKind: 'store', locked: true });
    const detail = pack.graph.nodes.find(n => n.id === '002')!.technicalSummary!;
    expect(detail).toContain('App detail');
    expect(detail).toContain('Keep records local');
    expect(detail).not.toContain('Design element');
    expect(detail).not.toContain('map diagram');
  });
  it('nests children in their parent and counts nesting as a connection', () => {
    const nodes = [...fixture(), node('004', { body: block('Design element', 'kind: component\nparent: "002"') })];
    const pack = designDocToPack(build(nodes).doc);
    expect(pack.graph.groups.find(group => group.id === 'design:container:002')).toMatchObject({ ownerNodeId: '002', parentGroupId: 'design:root' });
    expect(pack.graph.nodes.find(n => n.id === '004')?.groupId).toBe('design:container:002');
    expect(renderDesignDocMarkdown(build(nodes).doc)).toContain('subgraph element_002["App"]');
  });
  it('keeps source identity when locking or answering, and changes it when the design text changes', () => {
    const base = build(fixture()).doc.sourceRevision;
    const locked = fixture().map(n => n.id === '002' ? { ...n, status: 'resolved' as const } : n);
    expect(build(locked).doc.sourceRevision).toBe(base);
    const edited = fixture().map(n => n.id === '002' ? { ...n, body: n.body!.replace('App detail', 'Changed') } : n);
    expect(build(edited).doc.sourceRevision).not.toBe(base);
  });
  it('changes orientation without changing source identity', () => {
    const { doc } = build(fixture());
    const vertical = designDocToPack(doc);
    const horizontal = designDocToPack(doc, 'left-to-right');
    expect(horizontal.viewState.orientation).toBe('left-to-right');
    expect({ ...horizontal, viewState: vertical.viewState }).toEqual(vertical);
    expect(renderDesignDocMarkdown(doc, 'left-to-right')).toBe(renderDesignDocMarkdown(doc).replace('flowchart TD', 'flowchart LR'));
  });
  it('shows hitl questions that target an element, with choices and highlights, and holds approval on every open targeting node', () => {
    const nodes = [...fixture(),
      node('010', { kind: 'decision', answers: '002', title: 'Retry a conflict?', body: `Recommend yes.\n\n${block('Design question', 'choices: [Yes, No]\nhighlights: [App detail]')}` }),
      node('011', { kind: 'research', mode: 'afk', answers: '002' }),
      node('012', { kind: 'decision', status: 'fog', answers: '002' }),
      node('013', { kind: 'decision', status: 'resolved', answers: '002' }),
      node('014', { kind: 'decision', answers: '001' }),
    ];
    const { doc } = build(nodes);
    expect(doc.questions).toEqual([{ id: '010', target: { type: 'node', id: '002' }, question: 'Retry a conflict?', detail: 'Recommend yes.', choices: ['Yes', 'No'],
      highlights: [{ element: '002', start: { line: 1, column: 1 }, end: { line: 1, column: 11 } }] }]);
    expect(targetingNodes(nodes).map(n => n.id)).toEqual(['010', '011', '012']);
    expect(designDocToPack(doc).designDocument?.questions).toHaveLength(1);
  });
  it.each([
    ['no design elements', (nodes: GraphNode[]) => nodes.filter(n => n.kind !== 'element'), /no design elements/],
    ['an element without config', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: 'prose only' } : n), /needs a Design element block/],
    ['a config block on another kind', (nodes: GraphNode[]) => [...nodes, node('009', { kind: 'work', body: block('Design element', 'kind: store') })], /needs kind element/],
    ['two config blocks', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: `${n.body}\n\n${n.body}` } : n), /more than one/],
    ['a malformed block', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: '<details><summary>Design element</summary>kind: store</details>' } : n), /malformed/],
    ['an invalid kind', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: block('Design element', 'kind: database') } : n), /invalid Design element/],
    ['an unknown connection', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: block('Design element', 'kind: store\nconnections: [{to: 099, direction: one-way, label: X}]') } : n), /not a design element/],
    ['a connection to itself', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: block('Design element', 'kind: store\nconnections: [{to: 003, direction: one-way, label: X}]') } : n), /itself/],
    ['a duplicate connection', (nodes: GraphNode[]) => nodes.map(n => n.id === '002' ? { ...n, body: block('Design element', 'kind: component\nconnections: [{to: 003, direction: one-way, label: X}, {to: 003, direction: one-way, label: Y}]') } : n), /declared twice/],
    ['a connection to an out-of-scope element', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, status: 'out-of-scope' as const } : n), /out of scope/],
    ['an isolated element', (nodes: GraphNode[]) => [...nodes, node('004', { body: block('Design element', 'kind: actor') })], /no connection or parent/],
    ['a containment cycle', (nodes: GraphNode[]) => [...nodes, node('004', { body: block('Design element', 'kind: actor\nparent: "005"') }), node('005', { body: block('Design element', 'kind: actor\nparent: "004"') })], /cycle/],
    ['an edge to a descendant', (nodes: GraphNode[]) => nodes.map(n => n.id === '003' ? { ...n, body: block('Design element', 'kind: store\nparent: "002"') } : n), /ancestor/],
    ['a concern naming a non-element', (nodes: GraphNode[]) => nodes.map(n => n.id === '001' ? { ...n, body: block('Design doc', 'concerns: [{id: c, name: C, elements: [002, 001], requirement: R, response: S}]') } : n), /not a design element/],
    ['a highlight missing from the target', (nodes: GraphNode[]) => [...nodes, node('010', { kind: 'decision', answers: '002', body: block('Design question', 'highlights: [Nowhere]') })], /highlight not found/],
    ['multiple without choices', (nodes: GraphNode[]) => [...nodes, node('010', { kind: 'decision', answers: '002', body: block('Design question', 'multiple: true') })], /requires choices/],
  ])('fails on %s', (_name, mutate, error) => {
    expect(() => build(mutate(fixture()))).toThrow(error);
  });
  it('allows a lone element with no connection', () => {
    expect(build(fixture().filter(n => n.id !== '002').map(n => n.id === '001' ? { ...n, body: '' } : n)).doc.items).toHaveLength(1);
  });
  it('warns on fog elements, locked elements inside loose ones, and open questions on locked elements', () => {
    const [root] = fixture();
    const nodes = [root,
      node('002', { body: block('Design element', 'kind: component') }),
      node('003', { status: 'resolved', body: block('Design element', 'kind: store\nparent: "002"') }),
      node('004', { status: 'fog', body: block('Design element', 'kind: actor\nconnections: [{to: 002, direction: one-way, label: Uses}]') }),
      node('010', { kind: 'decision', answers: '003' }),
    ];
    expect(build(nodes).warnings).toEqual([
      'Element 004 is fog; it shows as loose',
      'Locked element 003 sits inside loose element 002',
      'Node 010 is open on locked element 003',
    ]);
  });
  it('writes safe offline HTML and the same-source Markdown from a files map', () => {
    const root = mkdtempSync(join(tmpdir(), 'design-doc-'));
    dirs.push(root);
    for (const n of fixture()) {
      createNode(root, 'example', { title: n.id === '002' ? 'App </script><script>alert(1)</script>' : n.title, kind: n.kind, label: n.label, summary: n.summary, answers: n.answers, status: n.status, body: n.body });
    }
    generateDesignDoc(root, 'example', join(root, 'review.html'), join(root, 'README.md'));
    const html = readFileSync(join(root, 'review.html'), 'utf8');
    expect(html).toContain('Example · Design document');
    expect(html).toContain('Keep records local');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('flowchart TD');
    expect(() => generateDesignDoc(root, 'example', join(root, 'review.html'))).toThrow(/EEXIST/);
  });
  it('loads the worked example and keeps its companion derived from the map', () => {
    const doc = exampleDesign();
    const pack = designDocToPack(doc);
    expect(doc.items).toHaveLength(9);
    expect(pack.graph.edges.map(edge => edge.id).sort()).toEqual(['002-004', '002-010', '004-007', '005-004', '007-008', '007-009']);
    expect(doc.items.filter(item => item.parent).map(item => [item.id, item.parent]).sort()).toEqual([
      [EX.skills, EX.acstack], [EX.host, EX.acstack], [EX.cli, EX.acstack], [EX['review-runtime'], EX.cli], [EX.viewer, EX.cli],
    ]);
    expect(doc.concerns.find(concern => concern.id === 'offline-review')?.elements).toEqual([EX['review-runtime'], EX.viewer, EX['design-source']]);
    expect(pack.graph.nodes.find(node => node.id === EX.viewer)?.technicalSummary).toContain('Design response:');
    expect(renderDesignDocMarkdown(doc)).toBe(readFileSync(join(EXAMPLE_ROOT, 'README.md'), 'utf8'));
  });
  it('lays out the worked example at useful initial depth and every component expansion', async () => {
    const doc = exampleDesign();
    const pack = designDocToPack(doc);
    const initial = initialExpandedGroups(pack);
    expect(initial).toEqual(['design:root']);
    const { projectDiagram } = await import('../viewer/alignment-graph.js');
    for (const [expanded, edgeCount] of [[initial, 3], [pack.graph.groups.map(group => group.id), 6], [['design:root', `design:container:${EX.acstack}`], 5]] as const) {
      const projection = projectDiagram(pack.graph, [...expanded]);
      const measured = { nodes: Object.fromEntries(projection.nodes.map(node => [node.id, { width: 300, height: node.kind === 'group' ? 140 : 164 }])), labels: Object.fromEntries(projection.edges.map(edge => [edge.id, { width: 196, height: 72 }])) };
      const diagram = await buildDiagram(pack.graph, [...expanded], measured);
      expect(diagram.edges).toHaveLength(edgeCount);
      if (expanded === initial) {
        expect(diagram.nodes.map(node => node.id).sort()).toEqual([`group:design:container:${EX.acstack}`, `item:${EX.user}`, `item:${EX['design-source']}`, `item:${EX.github}`].sort());
        const width = Math.max(...diagram.nodes.map(node => node.x + node.width), ...diagram.edges.map(edge => edge.labelBox!.x + edge.labelBox!.width));
        const height = Math.max(...diagram.nodes.map(node => node.y + node.height), ...diagram.edges.map(edge => edge.labelBox!.y + edge.labelBox!.height));
        // A normal desktop canvas fits the overview at native text size, including labels.
        expect(width).toBeLessThan(1000);
        expect(height).toBeLessThan(800);
      }
    }
  });
});
