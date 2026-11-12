import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';
import { AlignmentPackSchema, type AlignmentPack, type DiagramOrientation, type MockSummary, type MapQuestion } from './alignment-packs.js';
import { DIAGRAM_END, DIAGRAM_START } from './diagram.js';
import { MockEntrySchema, type MockEntry } from './design-mocks.js';
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
  // Files in the element folder, `<project folder>/maps/<map>/elements/<id>/`; see design-mocks.ts.
  mocks: z.array(MockEntrySchema).max(50).default([]),
  // Technology and place, e.g. "PostgreSQL on Supabase"; `--check` requires it on stores and external systems.
  location: text.optional(),
  // How this design changes the current system; the viewer offers before and after views when any element has one.
  change: z.enum(['added', 'changed', 'removed']).optional(),
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
  id: string; title: string; name: string; summary: string; kind: z.infer<typeof DesignKindSchema>; parent?: string;
  channels: z.infer<typeof DesignChannelSchema>[]; relationships: Relationship[]; detailText?: string; source?: string; resolved: boolean; locked: boolean; configDigest: string;
  // `mockSummaries` is filled once the files are checked, by loadMapDesign.
  mocks: MockEntry[]; mockSummaries?: MockSummary[]; location?: string; change?: 'added' | 'changed' | 'removed';
  // Set by changedElements when the element no longer matches its approval.
  changes?: import('./design-map.js').ElementChange[];
  // Work nodes targeting the element; progress is map state, so it stays out of the content digest.
  progress?: WorkProgress[];
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

/** The open question and decision nodes, in any mode, whose `answers` parent is a design element. They hold approval. */
export function targetingNodes(nodes: readonly GraphNode[]): GraphNode[] {
  const elements = new Set(nodes.filter(node => node.kind === 'element' && node.status !== 'out-of-scope').map(node => node.id));
  // Only questions (decision, research) hold approval. Work is the plan, shown as progress.
  return nodes.filter(node => (node.kind === 'decision' || node.kind === 'research') && node.answers && elements.has(node.answers) && !isSettled(node.status));
}

export type WorkProgress = { id: string; title: string; status: 'todo' | 'in-progress' | 'done' | 'blocked' };
/** Each element's work nodes (kind work, answering the element), with the status the viewer shows. */
function workProgress(nodes: readonly GraphNode[]): Map<string, WorkProgress[]> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const out = new Map<string, WorkProgress[]>();
  for (const node of nodes) {
    if (node.kind !== 'work' || !node.answers || node.status === 'out-of-scope') continue;
    const status = node.status === 'resolved' ? 'done' : node.status === 'claimed' ? 'in-progress'
      : node.blockedBy.some(id => { const blocker = byId.get(id); return !blocker || !isSettled(blocker.status); }) ? 'blocked' : 'todo';
    out.set(node.answers, [...out.get(node.answers) ?? [], { id: node.id, title: node.title, status }]);
  }
  return out;
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
      id: node.id, title: node.title, name: node.label, summary: node.summary ?? node.title, kind: value.kind, parent, channels: value.channels,
      relationships: value.connections.map(edge => {
        const to = element(node, edge.to, 'connection');
        if (to === node.id) throw new Error(`Node ${node.id}: connects to itself`);
        return { id: `${node.id}-${to}`, from: node.id, to, direction: edge.direction, label: edge.label };
      }),
      detailText: rest || undefined, source: node.url ?? (node.file && `maps/${map}/${node.file}`), resolved: node.status === 'resolved', locked: node.status === 'resolved', // Approval covers the requirement prose too; `rest` already leaves out regenerated diagrams.
      configDigest: digest({ config, title: node.title, name: node.label, summary: node.summary ?? node.title, detail: rest }), mocks: value.mocks,
      ...(value.location && { location: value.location }), ...(value.change && { change: value.change }),
    };
  });
  const byElement = new Map(items.map(item => [item.id, item]));
  for (const [id, progress] of workProgress(nodes)) {
    const item = byElement.get(id);
    if (item) item.progress = progress;
  }
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
  }
  // Answered questions stay on the page beside open ones, with their latest answer.
  const asked = nodes.filter(node => node.kind !== 'element' && node.mode === 'hitl' && node.answers && byElement.has(node.answers)
    && (node.status === 'open' || node.status === 'claimed' || node.status === 'resolved'));
  for (const node of asked) {
    const target = byElement.get(node.answers as string) as Element;
    const { config, rest: prose } = configBlock(node, QUESTION_SUMMARY);
    const { rest, answer } = splitAnswers(prose);
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
      ...(node.status === 'resolved' && { answer: answer ?? '' }),
      ...(value.choices && { choices: value.choices }), ...(value.multiple !== undefined && { multiple: value.multiple }), ...(highlights && { highlights }),
    });
  }
  // Lock state and questions live in the map inputs digest, so locking or answering never makes the open page stale.
  const content = { id: map, name: root.title, summary: root.summary ?? root.title, detailText: rootBlock.rest || undefined, concerns, items: items.map(item => ({ ...item, source: undefined, resolved: undefined, locked: undefined, progress: undefined })) };
  return { doc: { ...content, items, questions, sourceRevision: digest(content) }, warnings };
}

const USER_FACING = new Set(['web', 'mobile', 'desktop', 'cli']);
/**
 * Clarity rules `--check` applies on top of a valid build. A loose element's problems block;
 * a locked element's only warn, since fixing them would reopen its approval.
 */
export function designCheck(doc: DesignDoc): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const item of doc.items) {
    if (item.change === 'removed') continue;
    const problems: string[] = [];
    if ((item.kind === 'store' || item.kind === 'external-system') && !item.location) problems.push(`${item.kind === 'store' ? 'Store' : 'External system'} ${item.id} has no location; name its technology and where it lives`);
    // An external system's interface is someone else's product, so only the elements this design builds need mocks.
    const facing = item.channels.filter(channel => USER_FACING.has(channel));
    if (item.kind !== 'external-system' && facing.length && !item.mocks.length) problems.push(`Element ${item.id} has a user-facing channel (${facing.join(', ')}) but no mock`);
    (item.locked ? warnings : blocking).push(...problems);
    if (item.kind === 'store' && !item.mocks.length) warnings.push(`Store ${item.id} has no mock of its schema or structure`);
  }
  const top = doc.items.filter(item => !item.parent).length;
  if (top > 7) warnings.push(`The top level has ${top} elements; nest related ones under a parent to keep it to seven or fewer`);
  return { blocking, warnings };
}

const ANSWER_HEADING = /^## Answer(?: \(changed \d{4}-\d{2}-\d{2}\))?[ \t]*$/m;
/**
 * A question body without its `## Answer` sections, and the latest answer.
 * A changed answer appends a dated section rather than rewriting history.
 */
export function splitAnswers(body: string): { rest: string; answer?: string } {
  const at = body.search(ANSWER_HEADING);
  if (at === -1) return { rest: body };
  const sections = body.slice(at).split(new RegExp(ANSWER_HEADING.source, 'm')).slice(1);
  // Each answer runs to the next level-two heading.
  const latest = sections.at(-1)?.split(/^## /m)[0].trim().replace(/^\\## /gm, '## ');
  return { rest: body.slice(0, at).trim(), answer: latest };
}

// Schema prose is plain text; only node bodies contain authored Markdown.
function markdownText(value: string): string {
  return value.replace(/[&<>]/g, char => `&#${char.charCodeAt(0)};`)
    .replace(/[\\`*{}[\]()#+!_|>~]/g, '\\$&').replace(/[\r\n]/g, ' ');
}
function itemDetail(doc: DesignDoc, item: Element): string {
  return [item.location && `Location: ${markdownText(item.location)}`, item.detailText, ...doc.concerns.filter(c => c.elements.includes(item.id)).map(c => `## ${markdownText(c.name)}\n\n- Requirement: ${markdownText(c.requirement)}\n- Design response: ${markdownText(c.response)}\n- Applies to: ${c.elements.join(', ')}`)].filter(Boolean).join('\n\n');
}
export function designDocToPack(doc: DesignDoc, orientation: DiagramOrientation = 'top-to-bottom'): AlignmentPack {
  const containers = new Set(doc.items.flatMap(item => item.parent ? [item.parent] : []));
  const edges = doc.items.flatMap(item => item.relationships);
  const version = doc.sourceRevision.slice(0, 16);
  return AlignmentPackSchema.parse({
    documentKind: 'design', packVersion: `${doc.id}@${version}`,
    designDocument: { id: doc.id, name: doc.name, summary: doc.summary, detail: doc.detailText, questions: doc.questions },
    source: { map: { id: doc.name, version }, references: doc.items.map(item => ({ id: item.id, kind: 'design-element', title: item.name, uri: item.source ?? `Map node ${item.id}` })) },
    graph: {
      groups: [{ id: 'design:root', label: doc.name, summary: doc.summary, sourceRefs: [] }, ...doc.items.filter(item => containers.has(item.id)).map(item => ({ id: `design:container:${item.id}`, parentGroupId: item.parent ? `design:container:${item.parent}` : 'design:root', label: item.name, ownerNodeId: item.id, summary: item.summary, sourceRefs: [item.id] }))],
      nodes: doc.items.map(item => ({
        id: item.id, groupId: containers.has(item.id) ? `design:container:${item.id}` : item.parent ? `design:container:${item.parent}` : 'design:root', label: item.name, summary: item.summary,
        elementKind: item.kind, channels: item.channels, locked: item.locked, ...(item.change && { change: item.change }), technicalSummary: itemDetail(doc, item) || undefined, sourceRefs: [item.id],
        ...(item.mockSummaries?.length && { mocks: item.mockSummaries }), ...(item.progress && { progress: item.progress }),
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
  return `# ${markdownText(doc.name)}\n\n${markdownText(doc.summary)}\n\n<!-- Generated from the map's element nodes; regenerate with design-doc --markdown -->\n\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n\n${doc.detailText ?? ''}\n\n${doc.questions.length ? `## Questions\n\n${doc.questions.map(q => `### ${markdownText(q.question)}\n\n- Node: \`${q.id}\`\n- Target: \`${q.target.id}\`${q.answer !== undefined ? `\n- Answer: ${markdownText(q.answer) || 'given'}` : ''}${q.choices ? `\n- Answer format: ${q.multiple ? 'Select all that apply' : 'Choose one'}\n${q.choices.map(choice => `    - ${markdownText(choice)}`).join('\n')}\n    - Other (write in)` : '\n- Answer format: Free text'}`).join('\n\n')}\n\n` : ''}${doc.items.map(item => `## ${markdownText(item.name)}\n\n*${markdownText(item.summary)}*\n\n- Node: \`${item.id}\`\n- Kind: ${item.kind}${item.change ? `\n- Change: ${item.change}` : ''}\n- State: ${item.locked ? 'approved' : 'awaiting approval'}\n- Channels: ${item.channels.join(', ') || 'none'}\n\n${itemDetail(doc, item)}`).join('\n\n')}`.trimEnd() + '\n';
}
