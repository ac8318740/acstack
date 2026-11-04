import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { stringify } from 'yaml';
import { loadDesignDoc, designDocToPack, renderDesignDocMarkdown } from './design-doc.js';
import { generateDesignDoc } from '../commands/design-doc.js';
import { readFileSync } from 'node:fs';
import { buildDiagram, initialExpandedGroups } from '../viewer/alignment-graph.js';

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'design-doc-'));
  dirs.push(dir);
  const edge = { id: 'reads', from: 'app', to: 'data', direction: 'bidirectional', label: 'Reads and writes' };
  const entry = { id: 'example', name: 'Example', summary: 'A reviewable design', elements: ['app.yaml', 'data.yaml'], concerns: [{ id: 'privacy', name: 'Privacy', elements: ['app', 'data'], requirement: 'Keep records local', response: 'Both components use local files' }] };
  const app = { id: 'app', name: 'App', summary: 'Runs commands', kind: 'component', channels: ['cli', 'agent'], relationships: [edge] };
  const data = { id: 'data', name: 'Data', summary: 'Keeps records', kind: 'store', relationships: [edge] };
  const save = (file: string, value: unknown) => writeFileSync(join(dir, file), stringify(value));
  save('design.yaml', entry); save('app.yaml', app); save('data.yaml', data);
  return { dir, entry, app, data, save, load: () => loadDesignDoc(join(dir, 'design.yaml')) };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('authored design documents', () => {
  it('changes presentation orientation without changing source or review identities', () => {
    const f = fixture();
    const doc = f.load();
    const original = JSON.stringify(doc);
    const vertical = designDocToPack(doc, 'top-to-bottom');
    const horizontal = designDocToPack(doc, 'left-to-right');
    expect(designDocToPack(doc)).toEqual(vertical);
    expect(vertical.viewState.orientation).toBe('top-to-bottom');
    expect(horizontal.viewState.orientation).toBe('left-to-right');
    expect({ ...horizontal, viewState: vertical.viewState }).toEqual(vertical);
    expect(JSON.stringify(doc)).toBe(original);
    expect(renderDesignDocMarkdown(doc)).toBe(renderDesignDocMarkdown(doc, 'top-to-bottom'));
    expect(renderDesignDocMarkdown(doc, 'left-to-right')).toBe(renderDesignDocMarkdown(doc).replace('flowchart TD', 'flowchart LR'));
    generateDesignDoc(join(f.dir, 'design.yaml'), join(f.dir, 'horizontal.html'), join(f.dir, 'horizontal.md'), 'left-to-right');
    expect(readFileSync(join(f.dir, 'horizontal.html'), 'utf8')).toContain('"orientation":"left-to-right"');
    expect(readFileSync(join(f.dir, 'horizontal.md'), 'utf8')).toBe(renderDesignDocMarkdown(doc, 'left-to-right'));
  });
  it('generates safe offline HTML and the same-source Markdown through the helper', () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'detail.md'), '# Worked journey\n\n- Review </script><script>alert(1)</script>');
    f.save('design.yaml', { ...f.entry, detail: 'detail.md' });
    generateDesignDoc(join(f.dir, 'design.yaml'), join(f.dir, 'review.html'), join(f.dir, 'README.md'));
    const html = readFileSync(join(f.dir, 'review.html'), 'utf8');
    expect(html).toContain('Example · Design document');
    expect(html).toContain('Worked journey');
    expect(html).toContain('Keep records local');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(readFileSync(join(f.dir, 'README.md'), 'utf8')).toBe(renderDesignDocMarkdown(f.load()));
    expect(() => generateDesignDoc(join(f.dir, 'design.yaml'), join(f.dir, 'app.yaml'))).toThrow(/EEXIST/);
  });
  it('keeps punctuation-bearing source filenames local in rendered Markdown', () => {
    const f = fixture();
    const file = 'x](https://attacker.example)![track](https://attacker.example/pixel).yaml';
    mkdirSync(dirname(join(f.dir, file)), { recursive: true });
    f.save(file, f.app);
    f.save('design.yaml', { ...f.entry, name: 'Design ![track](https://attacker.example/pixel)', elements: [file, 'data.yaml'] });
    const markdown = renderDesignDocMarkdown(f.load());
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { children: markdown }));
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/href="https:\/\/attacker/);
    expect(html).toContain('href="x%5D%28https%3A//attacker.example%29%21%5Btrack%5D%28https%3A//attacker.example/pixel%29.yaml"');
    expect(html).toContain('x](https://attacker.example)![track](https://attacker.example/pixel).yaml');
  });
  it('keeps distinct visible design relationships and only aggregates collapsed endpoints', async () => {
    const f = fixture();
    const extra = { id: 'audits', from: 'app', to: 'data', direction: 'bidirectional', label: 'Audits records' };
    f.save('app.yaml', { ...f.app, relationships: [...f.app.relationships, extra] });
    f.save('data.yaml', { ...f.data, parent: undefined, relationships: [...f.data.relationships, extra] });
    const pack = designDocToPack(f.load());
    expect(pack.graph.edges).toHaveLength(2);
    const visible = await buildDiagram(pack.graph, initialExpandedGroups(pack));
    expect(visible.edges.map(edge => edge.label).sort()).toEqual(['Audits records', 'Reads and writes']);
    expect(visible.edges.every(edge => edge.childEdgeIds.length === 1)).toBe(true);
    expect(visible.edges[0].labelBox).not.toEqual(visible.edges[1].labelBox);
    const legacy = await buildDiagram({ ...pack.graph, edges: pack.graph.edges.map(edge => ({ ...edge, relationship: 'data' })) }, initialExpandedGroups(pack));
    expect(legacy.edges).toHaveLength(1);
    pack.graph.groups.push({ id: 'fold', label: 'Folded', summary: 'Folded group', sourceRefs: [] });
    pack.graph.nodes.find(node => node.id === 'app')!.groupId = 'fold';
    const collapsed = await buildDiagram(pack.graph, ['design:root']);
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0].label).toBe('2 links');
  });
  it('preserves one-way and bidirectional route arrows without merging their meanings', async () => {
    const f = fixture(); const doc = f.load();
    const pack = designDocToPack(doc);
    pack.graph.edges.push({ ...pack.graph.edges[0], id: 'one-way', direction: 'one-way' });
    const diagram = await buildDiagram(pack.graph, pack.graph.groups.map(group => group.id));
    expect(diagram.edges).toHaveLength(2);
    expect(diagram.edges.find(edge => edge.childEdgeIds.includes('reads'))?.bidirectional).toBe(true);
    expect(diagram.edges.find(edge => edge.childEdgeIds.includes('one-way'))?.bidirectional).toBe(false);
  });
  it('validates mirrored links once and keeps kinds, channels, concerns, and nesting', () => {
    const f = fixture();
    f.save('child.yaml', { ...f.data, id: 'child', parent: 'app', relationships: [] });
    f.save('design.yaml', { ...f.entry, elements: [...f.entry.elements, 'child.yaml'] });
    const doc = f.load(); const pack = designDocToPack(doc);
    expect(pack.graph.edges).toHaveLength(1);
    expect(pack.graph.edges[0].direction).toBe('bidirectional');
    expect(pack.graph.nodes.find(n => n.id === 'app')?.technicalSummary).toContain('Keep records local');
    expect(pack.graph.nodes.find(n => n.id === 'app')?.elementKind).toBe('component');
    expect(pack.graph.nodes.find(n => n.id === 'app')?.channels).toEqual(['cli', 'agent']);
    expect(pack.graph.groups.find(group => group.id === 'design:container:app')).toMatchObject({ label: 'App', ownerNodeId: 'app', parentGroupId: 'design:root' });
    expect(pack.graph.nodes.find(node => node.id === 'app')).toMatchObject({ label: 'App', groupId: 'design:container:app' });
    expect(pack.graph.nodes.find(node => node.id === 'child')?.groupId).toBe('design:container:app');
    expect(pack.graph.nodes.find(node => node.id === 'data')?.groupId).toBe('design:root');
    expect(pack.graph.edges.map(edge => edge.id)).toEqual(['reads']);
    expect(renderDesignDocMarkdown(doc)).toContain('subgraph element_app["App"]');
  });
  it('renders each Mermaid entity once while preserving containment and every relationship endpoint', () => {
    const f = fixture();
    f.save('child.yaml', { ...f.data, id: 'child', name: 'Child', parent: 'app', relationships: [] });
    f.save('design.yaml', { ...f.entry, elements: [...f.entry.elements, 'child.yaml'] });
    const documents = [f.load(), loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)];
    for (const doc of documents) {
      const mermaid = renderDesignDocMarkdown(doc).match(/```mermaid\n([\s\S]*?)```/)?.[1];
      expect(mermaid).toBeTypeOf('string');
      const entities: Array<{ id: string; name: string; parents: string[] }> = [];
      const parents: string[] = [];
      const edges: Array<{ from: string; to: string; label: string; arrow: string }> = [];
      for (const line of mermaid!.split('\n').map(line => line.trim())) {
        const declaration = line.match(/^(subgraph\s+)?([\w:-]+)\["([^"\n]+)"\]/);
        if (declaration) {
          const name = declaration[3].split('<br/>')[0];
          entities.push({ id: declaration[2], name, parents: [...parents] });
          if (declaration[1]) parents.push(name);
        } else if (line === 'end') parents.pop();
        const edge = line.match(/^([\w:-]+)\s+(-->|<-->)\|"([^"]+)"\|\s+([\w:-]+)/);
        if (edge) edges.push({ from: edge[1], to: edge[4], label: edge[3], arrow: edge[2] });
      }
      for (const item of doc.items) {
        const representations = entities.filter(entity => entity.name === item.name);
        expect.soft(representations, `${item.id} must have exactly one visible identity`).toHaveLength(1);
        if (item.parent) {
          const parent = doc.items.find(candidate => candidate.id === item.parent)!;
          expect(representations.every(entity => entity.parents.includes(parent.name)), `${item.id} containment`).toBe(true);
        }
      }
      const relationships = [...new Map(doc.items.flatMap(item => item.relationships).map(edge => [edge.id, edge])).values()];
      expect(edges).toHaveLength(relationships.length);
      for (const relationship of relationships) {
        const from = doc.items.find(item => item.id === relationship.from)!;
        const to = doc.items.find(item => item.id === relationship.to)!;
        expect(edges.map(edge => ({
          from: entities.find(entity => entity.id === edge.from)?.name,
          to: entities.find(entity => entity.id === edge.to)?.name,
          label: edge.label, arrow: edge.arrow,
        }))).toContainEqual({ from: from.name, to: to.name, label: relationship.label, arrow: relationship.direction === 'bidirectional' ? '<-->' : '-->' });
      }
    }
  });
  it.each(['missing', 'mismatch', 'duplicate'] as const)('rejects %s endpoint declarations', mode => {
    const f = fixture();
    if (mode === 'missing') f.data.relationships = [];
    if (mode === 'mismatch') f.data.relationships[0].label = 'Different';
    if (mode === 'duplicate') f.data.relationships.push(f.data.relationships[0]);
    f.save('data.yaml', f.data);
    expect(f.load).toThrow(/reads.*(data.yaml|app.yaml)/);
  });
  it.each(['kind', 'channels', 'unknown'] as const)('rejects invalid schema field %s with its file', field => {
    const f = fixture(); f.save('app.yaml', { ...f.app, [field]: field === 'channels' ? ['fax'] : 'invalid' });
    expect(f.load).toThrow(/app.yaml/);
  });
  it('rejects duplicate identities, unknown parents, and cycles', () => {
    const f = fixture(); f.data.id = 'app'; f.save('data.yaml', f.data); expect(f.load).toThrow(/duplicate.*app/i);
    f.data.id = 'data'; f.save('data.yaml', { ...f.data, parent: 'missing' }); expect(f.load).toThrow(/parent.*missing/);
    f.save('data.yaml', { ...f.data, parent: 'app' }); f.save('app.yaml', { ...f.app, parent: 'data' }); expect(f.load).toThrow(/cycle/);
  });
  it.each([
    ['direct', false], ['direct', true], ['nested', false], ['nested', true],
  ] as const)('rejects %s ancestor-descendant relationships with reversed endpoints: %s', (depth, reversed) => {
    const f = fixture();
    const edge = { ...f.app.relationships[0], from: reversed ? 'data' : 'app', to: reversed ? 'app' : 'data' };
    f.save('app.yaml', { ...f.app, relationships: [edge] });
    f.save('data.yaml', { ...f.data, parent: depth === 'direct' ? 'app' : 'middle', relationships: [edge] });
    if (depth === 'nested') {
      f.save('middle.yaml', { ...f.app, id: 'middle', parent: 'app', relationships: [] });
      f.save('design.yaml', { ...f.entry, elements: [...f.entry.elements, 'middle.yaml'] });
    }
    expect(f.load).toThrow(/reads.*app.*data.*nesting/);
  });
  it('rejects traversal and symlink escapes', () => {
    const f = fixture(); f.entry.elements = ['../outside.yaml']; f.save('design.yaml', f.entry); expect(f.load).toThrow(/path/);
    symlinkSync('/etc/passwd', join(f.dir, 'escape.yaml')); f.entry.elements = ['escape.yaml']; f.save('design.yaml', f.entry); expect(f.load).toThrow(/escape/);
  });
  it('loads the representative example and keeps its companion derived from source', () => {
    const entry = new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url);
    const doc = loadDesignDoc(entry.pathname);
    const pack = designDocToPack(doc);
    expect(doc.items).toHaveLength(9);
    expect(pack.graph.edges).toHaveLength(6);
    expect(pack.graph.edges.map(edge => edge.id).sort()).toEqual(['author-design', 'export-design', 'load-skills', 'publish-companion', 'read-source', 'review-session']);
    expect(doc.items.filter(item => item.parent).map(item => [item.id, item.parent]).sort()).toEqual([
      ['cli', 'acstack'], ['host', 'acstack'], ['review-runtime', 'cli'], ['skills', 'acstack'], ['viewer', 'cli'],
    ]);
    const cli = doc.items.find(item => item.id === 'cli')!;
    expect(cli.name).toBe('CLI package');
    expect(cli.channels).toEqual([]);
    expect(cli.relationships).toEqual([]);
    expect(doc.items.find(item => item.id === 'review-runtime')).toMatchObject({ name: 'Review command and server', kind: 'component', channels: ['cli', 'web'] });
    expect(doc.items.find(item => item.id === 'viewer')).toMatchObject({ name: 'Browser review interface', channels: ['web'] });
    for (const relationship of [
      { id: 'export-design', from: 'skills', to: 'review-runtime', direction: 'one-way', label: 'Guides the agent to run' },
      { id: 'read-source', from: 'review-runtime', to: 'design-source', direction: 'one-way', label: 'Reads design source' },
      { id: 'review-session', from: 'review-runtime', to: 'viewer', direction: 'bidirectional', label: 'Exchanges the design and comments with' },
    ]) {
      expect(doc.items.filter(item => item.relationships.some(edge => edge.id === relationship.id)).map(item => item.id).sort()).toEqual([relationship.from, relationship.to].sort());
      for (const endpoint of [relationship.from, relationship.to]) {
        expect(doc.items.find(item => item.id === endpoint)?.relationships.find(edge => edge.id === relationship.id)).toEqual(relationship);
      }
    }
    expect(doc.concerns.find(concern => concern.id === 'offline-review')?.elements).toEqual(['review-runtime', 'viewer', 'design-source']);
    expect(doc.concerns.find(concern => concern.id === 'honest-scope')?.elements).toEqual(['skills', 'review-runtime', 'viewer']);
    expect(pack.graph.nodes.some(node => node.id === doc.id)).toBe(false);
    expect(pack.designDocument?.detail).toContain(readFileSync(new URL('../../../examples/design-doc/acstack/journey.md', import.meta.url), 'utf8').trim());
    expect(pack.graph.nodes.find(node => node.id === 'viewer')?.technicalSummary).toContain('Design response:');
    expect(renderDesignDocMarkdown(doc)).toBe(readFileSync(new URL('../../../examples/design-doc/acstack/README.md', import.meta.url), 'utf8'));
  });
  it('lays out the actual authored example at useful initial depth and every component expansion', async () => {
    const doc = loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname);
    const pack = designDocToPack(doc);
    const initial = initialExpandedGroups(pack);
    expect(initial).toContain('design:root');
    expect(initial).toEqual(['design:root']);
    expect(initial).not.toContain('design:container:cli');
    const { projectDiagram } = await import('../viewer/alignment-graph.js');
    for (const [expanded, edgeCount] of [[initial, 3], [pack.graph.groups.map(group => group.id), 6], [['design:root', 'design:container:acstack'], 5]] as const) {
      const projection = projectDiagram(pack.graph, [...expanded]);
      const measured = { nodes: Object.fromEntries(projection.nodes.map(node => [node.id, { width: 300, height: node.kind === 'group' ? 140 : 164 }])), labels: Object.fromEntries(projection.edges.map(edge => [edge.id, { width: 196, height: 72 }])) };
      const diagram = await buildDiagram(pack.graph, [...expanded], measured);
      expect(diagram.edges).toHaveLength(edgeCount);
      expect(diagram.nodes.some(node => node.id === 'group:design:root')).toBe(false);
      expect(diagram.nodes.some(node => node.id === 'item:acstack')).toBe(false);
      if (expanded === initial) {
        expect(diagram.nodes.map(node => node.id).sort()).toEqual(['group:design:container:acstack', 'item:design-source', 'item:github', 'item:user']);
        expect(diagram.nodes.find(node => node.ownerNodeId === 'acstack')).toMatchObject({ kind: 'folded-group', summary: doc.items.find(item => item.id === 'acstack')!.summary });
        const width = Math.max(...diagram.nodes.map(node => node.x + node.width), ...diagram.edges.map(edge => edge.labelBox!.x + edge.labelBox!.width));
        const height = Math.max(...diagram.nodes.map(node => node.y + node.height), ...diagram.edges.map(edge => edge.labelBox!.y + edge.labelBox!.height));
        // A normal desktop canvas fits the overview at native text size, including labels.
        expect(width).toBeLessThan(1000);
        expect(height).toBeLessThan(800);
      }
      for (const route of diagram.edges) {
        expect(route.points.length).toBeGreaterThanOrEqual(2);
        expect(route.path.match(/M /g)).toHaveLength(2);
        const label = route.labelBox!;
        for (const other of diagram.edges) {
          const hits = other.points.slice(1).filter((b, index) => {
            const a = other.points[index];
            return Math.min(a.x, b.x) < label.x + label.width + 7 && Math.max(a.x, b.x) > label.x - 7
              && Math.min(a.y, b.y) < label.y + label.height + 7 && Math.max(a.y, b.y) > label.y - 7;
          });
          expect(hits.length).toBe(other === route ? 1 : 0);
        }
        for (const box of diagram.nodes) {
          const obstacle = box.kind === 'group' ? { ...box, height: box.headerHeight! } : box;
          expect(route.labelBox!.x + route.labelBox!.width <= obstacle.x - 7 || route.labelBox!.x >= obstacle.x + obstacle.width + 7 || route.labelBox!.y + route.labelBox!.height <= obstacle.y - 7 || route.labelBox!.y >= obstacle.y + obstacle.height + 7).toBe(true);
        }
      }
    }
  });
  it('rejects a relationship identity reused across separate endpoint pairs', () => {
    const f = fixture();
    const edge = { ...f.app.relationships[0], from: 'extra', to: 'other' };
    f.save('extra.yaml', { ...f.app, id: 'extra', relationships: [edge] });
    f.save('other.yaml', { ...f.data, id: 'other', relationships: [edge] });
    f.save('design.yaml', { ...f.entry, elements: [...f.entry.elements, 'extra.yaml', 'other.yaml'] });
    expect(f.load).toThrow(/reads.*duplicate identity.*app.yaml.*extra.yaml/);
  });
  it('bounds the aggregate source size before reading every detail', () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'detail.md'), 'x'.repeat(250000));
    const elements = Array.from({ length: 18 }, (_, index) => `element-${index}.yaml`);
    for (const [index, file] of elements.entries()) f.save(file, { id: `element-${index}`, name: 'Element', summary: 'A bounded element', kind: 'component', detail: 'detail.md' });
    f.save('design.yaml', { ...f.entry, elements, concerns: [] });
    expect(f.load).toThrow(/4 MiB/);
  });
  it('rejects duplicate YAML keys, unknown endpoints, and oversized files', () => {
    const f = fixture(); writeFileSync(join(f.dir, 'app.yaml'), 'id: app\nid: other\n'); expect(f.load).toThrow(/app.yaml/);
    f.app.relationships[0].to = 'missing'; f.save('app.yaml', f.app); expect(f.load).toThrow(/endpoint.*missing/);
    writeFileSync(join(f.dir, 'app.yaml'), 'x'.repeat(262145)); expect(f.load).toThrow(/size/);
  });
});
