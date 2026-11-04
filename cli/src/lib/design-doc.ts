import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';
import { AlignmentPackSchema, type AlignmentPack, type DiagramOrientation, type MapQuestion } from './alignment-packs.js';
import { DIAGRAM_END, DIAGRAM_START } from './diagram.js';
import { bareId, isSettled, normalizeId, type GraphNode } from './nodes.js';

const text = z.string().trim().min(1).max(16000);
const identity = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
// YAML reads an unquoted `to: 004` as the number 4; references are resolved against node ids later.
const reference = z.union([z.string(), z.number()]).transform(value => bareId(String(value)));
export const DesignKindSchema = z.enum(['actor', 'component', 'store', 'external-system']);
export const DesignChannelSchema = z.enum(['web', 'mobile', 'desktop', 'cli', 'agent', 'email', 'sms', 'voice']);
const ElementConfigSchema = z.object({
  kind: DesignKindSchema, parent: reference.optional(), channels: z.array(DesignChannelSchema).max(8).default([]),
  connections: z.array(z.object({ to: reference, direction: z.enum(['one-way', 'bidirectional']), label: text }).strict()).max(200).default([]),
}).strict();
const RootConfigSchema = z.object({
  concerns: z.array(z.object({
    id: identity, name: text, elements: z.array(reference).min(2).max(200), requirement: text, response: text,
  }).strict()).max(100).default([]),
}).strict();
const QuestionConfigSchema = z.object({
  choices: z.array(z.string().trim().min(1).max(500)).min(2).max(12).optional(),
  multiple: z.boolean().optional(),
  highlights: z.array(text).min(1).max(20).optional(),
}).strict().superRefine((question, context) => {
  if (question.multiple && !question.choices) context.addIssue({ code: 'custom', message: 'Multiple selection requires choices' });
  if (question.choices && (new Set(question.choices).size !== question.choices.length || question.choices.some(choice => choice.toLowerCase() === 'other'))) {
    context.addIssue({ code: 'custom', message: 'Choices must be unique; Other is provided automatically' });
  }
});

export const ELEMENT_SUMMARY = 'Design element';
export const ROOT_SUMMARY = 'Design doc';
export const QUESTION_SUMMARY = 'Design question';

type Relationship = { id: string; from: string; to: string; direction: 'one-way' | 'bidirectional'; label: string };
type Element = {
  id: string; name: string; summary: string; kind: z.infer<typeof DesignKindSchema>; parent?: string;
  channels: z.infer<typeof DesignChannelSchema>[]; relationships: Relationship[]; detailText?: string; resolved: boolean; locked: boolean; configDigest: string;
};
type Concern = { id: string; name: string; elements: string[]; requirement: string; response: string };
export type DesignDoc = {
  id: string; name: string; summary: string; detailText?: string; concerns: Concern[]; items: Element[];
  questions: MapQuestion[]; sourceRevision: string;
};
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// One collapsed YAML block per flag; the rest of the body is the reader's prose.
function configBlock(node: GraphNode, summary: string): { config?: unknown; rest: string } {
  const body = node.body ?? '';
  const pattern = new RegExp(`<details>\\s*<summary>${summary}</summary>\\s*\`\`\`ya?ml\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`\\s*</details>`, 'g');
  const blocks = [...body.matchAll(pattern)];
  const flags = body.split(`<summary>${summary}</summary>`).length - 1;
  if (flags !== blocks.length) throw new Error(`Node ${node.id}: malformed ${summary} block; use <details>, <summary>${summary}</summary>, and one fenced yaml block`);
  if (blocks.length > 1) throw new Error(`Node ${node.id}: more than one ${summary} block`);
  const rest = body.replace(pattern, '').replace(new RegExp(`${DIAGRAM_START}[\\s\\S]*?${DIAGRAM_END}`, 'g'), '').trim();
  if (!blocks.length) return { rest };
  try { return { config: parse(blocks[0][1]) as unknown, rest }; }
  catch (error) { throw new Error(`Node ${node.id}: invalid ${summary} YAML: ${error instanceof Error ? error.message : String(error)}`); }
}
function parsed<T>(node: GraphNode, summary: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, config: unknown): T {
  try { return schema.parse(config ?? {}); }
  catch (error) { throw new Error(`Node ${node.id}: invalid ${summary}: ${error instanceof Error ? error.message : String(error)}`); }
}
// 1-based UTF-16 line and column of an offset, the coordinates the viewer's highlighter reads.
function point(source: string, offset: number) {
  const before = source.slice(0, offset).split('\n');
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** The open nodes, in any mode, whose `answers` parent is a design element. They hold approval. */
export function targetingNodes(nodes: readonly GraphNode[]): GraphNode[] {
  const elements = new Set(nodes.filter(node => node.kind === 'element' && node.status !== 'out-of-scope').map(node => node.id));
  return nodes.filter(node => node.kind !== 'element' && node.answers && elements.has(node.answers) && !isSettled(node.status));
}

/**
 * Build the design doc from a map's nodes. Throws on a contradiction; returns
 * warnings for oddities. The map is the only design source.
 */
export function designFromNodes(map: string, nodes: readonly GraphNode[]): { doc: DesignDoc; warnings: string[] } {
  const warnings: string[] = [];
  const roots = nodes.filter(node => !node.answers);
  if (roots.length !== 1) throw new Error(`Map ${map} needs exactly one root node`);
  const root = roots[0];
  for (const node of nodes) {
    if (node.kind !== 'element' && (node.body ?? '').includes(`<summary>${ELEMENT_SUMMARY}</summary>`)) throw new Error(`Node ${node.id}: a ${ELEMENT_SUMMARY} block needs kind element`);
  }
  const included = nodes.filter(node => node.kind === 'element' && node.status !== 'out-of-scope');
  if (!included.length) throw new Error(`Map ${map} has no design elements`);
  if (included.length > 200) throw new Error(`Map ${map} has more than 200 design elements`);
  const excluded = new Set(nodes.filter(node => node.kind === 'element' && node.status === 'out-of-scope').map(node => node.id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const resolve = (value: string) => byId.has(value) ? value : normalizeId(value);
  const ids = new Set(included.map(node => node.id));
  const element = (owner: GraphNode, value: string, role: string): string => {
    const id = resolve(value);
    if (excluded.has(id)) throw new Error(`Node ${owner.id}: ${role} ${id} is out of scope`);
    if (!ids.has(id)) throw new Error(`Node ${owner.id}: ${role} ${id} is not a design element on this map`);
    return id;
  };
  const items: Element[] = included.map(node => {
    const { config, rest } = configBlock(node, ELEMENT_SUMMARY);
    if (config === undefined) throw new Error(`Node ${node.id}: kind element needs a ${ELEMENT_SUMMARY} block`);
    const value = parsed(node, ELEMENT_SUMMARY, ElementConfigSchema, config);
    const parent = value.parent === undefined ? undefined : element(node, value.parent, 'parent');
    if (parent === node.id) throw new Error(`Node ${node.id}: cannot contain itself`);
    if (node.status === 'fog') warnings.push(`Element ${node.id} is fog; it shows as loose`);
    return {
      id: node.id, name: node.label, summary: node.summary ?? node.title, kind: value.kind, parent, channels: value.channels,
      relationships: value.connections.map(edge => {
        const to = element(node, edge.to, 'connection');
        if (to === node.id) throw new Error(`Node ${node.id}: connects to itself`);
        return { id: `${node.id}-${to}`, from: node.id, to, direction: edge.direction, label: edge.label };
      }),
      detailText: rest || undefined, resolved: node.status === 'resolved', locked: node.status === 'resolved', configDigest: digest(config),
    };
  });
  const byElement = new Map(items.map(item => [item.id, item]));
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let parent = byElement.get(id)?.parent; parent; parent = byElement.get(parent)?.parent) {
      if (parent === id || out.includes(parent)) throw new Error(`Node ${id}: containment cycle at ${parent}`);
      out.push(parent);
    }
    return out;
  };
  const edges = new Set<string>();
  for (const item of items) {
    ancestors(item.id);
    for (const edge of item.relationships) {
      if (edges.has(edge.id)) throw new Error(`Node ${item.id}: connection to ${edge.to} declared twice`);
      edges.add(edge.id);
      if (ancestors(edge.from).includes(edge.to) || ancestors(edge.to).includes(edge.from)) throw new Error(`Node ${item.id}: connection to ${edge.to} joins an ancestor and its descendant; nesting already shows containment`);
    }
    const parent = item.parent && byElement.get(item.parent);
    if (item.locked && parent && !parent.locked) warnings.push(`Locked element ${item.id} sits inside loose element ${parent.id}`);
  }
  if (items.length > 1) {
    const linked = new Set(items.flatMap(item => [...(item.parent ? [item.id, item.parent] : []), ...item.relationships.flatMap(edge => [edge.from, edge.to])]));
    for (const item of items) if (!linked.has(item.id)) throw new Error(`Element ${item.id} has no connection or parent; connect it, nest it, or remove it`);
  }
  const rootBlock = configBlock(root, ROOT_SUMMARY);
  const concerns = parsed(root, ROOT_SUMMARY, RootConfigSchema, rootBlock.config).concerns.map(concern => ({ ...concern, elements: concern.elements.map(id => element(root, id, `concern ${concern.id} element`)) }));
  const concernIds = new Set<string>();
  for (const concern of concerns) {
    if (concernIds.has(concern.id)) throw new Error(`Node ${root.id}: duplicate concern ${concern.id}`);
    concernIds.add(concern.id);
    if (new Set(concern.elements).size !== concern.elements.length) throw new Error(`Node ${root.id}: concern ${concern.id} repeats an element`);
  }
  const questions: MapQuestion[] = [];
  for (const node of targetingNodes(nodes)) {
    const target = byElement.get(node.answers as string) as Element;
    if (target.locked) warnings.push(`Node ${node.id} is open on locked element ${target.id}`);
    if (node.mode !== 'hitl' || node.status === 'fog') continue;
    const { config, rest } = configBlock(node, QUESTION_SUMMARY);
    const value = parsed(node, QUESTION_SUMMARY, QuestionConfigSchema, config);
    const highlights = value.highlights?.map(passage => {
      const source = target.detailText ?? '';
      const start = source.indexOf(passage);
      if (start === -1) throw new Error(`Node ${node.id}: highlight not found in element ${target.id}: ${passage}`);
      if (source.indexOf(passage, start + 1) !== -1) throw new Error(`Node ${node.id}: highlight appears more than once in element ${target.id}; quote a longer passage`);
      return { element: target.id, start: point(source, start), end: point(source, start + passage.length) };
    });
    questions.push({
      id: node.id, target: { type: 'node', id: target.id }, question: node.title, ...(rest && { detail: rest }),
      ...(value.choices && { choices: value.choices }), ...(value.multiple !== undefined && { multiple: value.multiple }), ...(highlights && { highlights }),
    });
  }
  // Lock state and questions live in the map inputs digest, so locking or answering never makes the open page stale.
  const content = { id: map, name: root.title, summary: root.summary ?? root.title, detailText: rootBlock.rest || undefined, concerns, items: items.map(item => ({ ...item, resolved: undefined, locked: undefined })) };
  return { doc: { ...content, items, questions, sourceRevision: digest(content) }, warnings };
}

// Schema prose is plain text; only node bodies contain authored Markdown.
function markdownText(value: string): string {
  return value.replace(/[&<>]/g, char => `&#${char.charCodeAt(0)};`)
    .replace(/[\\`*{}[\]()#+!_|>~]/g, '\\$&').replace(/[\r\n]/g, ' ');
}
function itemDetail(doc: DesignDoc, item: Element): string {
  return [item.detailText, ...doc.concerns.filter(c => c.elements.includes(item.id)).map(c => `## ${markdownText(c.name)}\n\n- Requirement: ${markdownText(c.requirement)}\n- Design response: ${markdownText(c.response)}\n- Applies to: ${c.elements.join(', ')}`)].filter(Boolean).join('\n\n');
}
export function designDocToPack(doc: DesignDoc, orientation: DiagramOrientation = 'top-to-bottom'): AlignmentPack {
  const containers = new Set(doc.items.flatMap(item => item.parent ? [item.parent] : []));
  const edges = doc.items.flatMap(item => item.relationships);
  const version = doc.sourceRevision.slice(0, 16);
  return AlignmentPackSchema.parse({
    documentKind: 'design', packVersion: `${doc.id}@${version}`,
    designDocument: { id: doc.id, name: doc.name, summary: doc.summary, detail: doc.detailText, questions: doc.questions },
    source: { map: { id: doc.name, version }, references: doc.items.map(item => ({ id: item.id, kind: 'design-element', title: item.name, uri: `node:${item.id}` })) },
    graph: {
      groups: [{ id: 'design:root', label: doc.name, summary: doc.summary, sourceRefs: [] }, ...doc.items.filter(item => containers.has(item.id)).map(item => ({ id: `design:container:${item.id}`, parentGroupId: item.parent ? `design:container:${item.parent}` : 'design:root', label: item.name, ownerNodeId: item.id, summary: item.summary, sourceRefs: [item.id] }))],
      nodes: doc.items.map(item => ({
        id: item.id, groupId: containers.has(item.id) ? `design:container:${item.id}` : item.parent ? `design:container:${item.parent}` : 'design:root', label: item.name, summary: item.summary,
        elementKind: item.kind, channels: item.channels, locked: item.locked, technicalSummary: itemDetail(doc, item) || undefined, sourceRefs: [item.id],
      })),
      edges: edges.map(edge => ({ id: edge.id, fromNodeId: edge.from, toNodeId: edge.to, direction: edge.direction, relationship: 'design', label: edge.label, summary: edge.label, sourceRefs: [edge.from, edge.to] })), aggregateEdges: [],
    },
    viewState: { orientation, globalDepth: 1, expandedGroups: [], semanticZoom: 'business' }, reviewState: {},
  });
}
// Both the GitHub companion and HTML derive from the same map nodes.
export function renderDesignDocMarkdown(doc: DesignDoc, orientation: DiagramOrientation = 'top-to-bottom'): string {
  const label = (value: string) => value.replace(/[&<>"\n\r]/g, char => `&#${char.charCodeAt(0)};`);
  const lines = [`flowchart ${orientation === 'left-to-right' ? 'LR' : 'TD'}`];
  const walk = (parent?: string, indent = '    ') => {
    for (const item of doc.items.filter(item => item.parent === parent)) {
      const children = doc.items.some(child => child.parent === item.id);
      if (children) lines.push(`${indent}subgraph element_${item.id}["${label(item.name)}"]`);
      else lines.push(`${indent}element_${item.id}["${label(item.name)}<br/>${item.kind}${item.channels.length ? ` · ${item.channels.join(', ')}` : ''}"]`);
      walk(item.id, `${indent}    `);
      if (children) lines.push(`${indent}end`);
    }
  };
  walk();
  for (const edge of doc.items.flatMap(item => item.relationships)) lines.push(`    element_${edge.from} ${edge.direction === 'bidirectional' ? '<-->' : '-->'}|"${label(edge.label)}"| element_${edge.to}`);
  return `# ${markdownText(doc.name)}\n\n${markdownText(doc.summary)}\n\n<!-- Generated from the map's element nodes; regenerate with design-doc --markdown -->\n\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n\n${doc.detailText ?? ''}\n\n${doc.questions.length ? `## Questions\n\n${doc.questions.map(q => `### ${markdownText(q.question)}\n\n- Node: \`${q.id}\`\n- Target: \`${q.target.id}\`${q.choices ? `\n- Answer format: ${q.multiple ? 'Select all that apply' : 'Choose one'}\n${q.choices.map(choice => `    - ${markdownText(choice)}`).join('\n')}\n    - Other (write in)` : '\n- Answer format: Free text'}`).join('\n\n')}\n\n` : ''}${doc.items.map(item => `## ${markdownText(item.name)}\n\n*${markdownText(item.summary)}*\n\n- Node: \`${item.id}\`\n- Kind: ${item.kind}\n- State: ${item.locked ? 'locked' : 'loose'}\n- Channels: ${item.channels.join(', ') || 'none'}\n\n${itemDetail(doc, item)}`).join('\n\n')}`.trimEnd() + '\n';
}
