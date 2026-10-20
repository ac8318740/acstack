import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';
import { AlignmentPackSchema, type AlignmentPack, type DiagramOrientation } from './alignment-packs.js';

const text = z.string().trim().min(1).max(16000);
const identity = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
export const DesignKindSchema = z.enum(['actor', 'component', 'store', 'external-system']);
export const DesignChannelSchema = z.enum(['web', 'mobile', 'desktop', 'cli', 'agent', 'email', 'sms', 'voice']);
const RelationshipSchema = z.object({
  id: identity, from: identity, to: identity,
  direction: z.enum(['one-way', 'bidirectional']), label: text,
}).strict();
const ElementSchema = z.object({
  id: identity, name: text, summary: text, kind: DesignKindSchema,
  parent: identity.optional(), channels: z.array(DesignChannelSchema).max(8).default([]),
  detail: text.optional(), relationships: z.array(RelationshipSchema).max(200).default([]),
}).strict();
const EntrySchema = z.object({
  id: identity, name: text, summary: text,
  elements: z.array(text).min(1).max(200), detail: text.optional(),
  planning: z.object({ tracker: z.enum(['files', 'github']), map: text }).strict().optional(),
  concerns: z.array(z.object({
    id: identity, name: text, elements: z.array(identity).min(2).max(200), requirement: text, response: text,
  }).strict()).max(100).default([]),
}).strict();
type Element = z.infer<typeof ElementSchema> & { file: string; detailText?: string };
export type DesignDoc = z.infer<typeof EntrySchema> & { items: Element[]; detailText?: string; sourceRevision: string };

// Bound every read before YAML expansion; yaml's default alias limit also rejects expansion bombs.
function readBounded(file: string): Buffer {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 262144) throw new Error(`${file}: file type or size exceeds the 256 KiB limit`);
  const bytes = readFileSync(file);
  if (bytes.length > 262144) throw new Error(`${file}: file size exceeds the 256 KiB limit`);
  return bytes;
}
function childPath(root: string, name: string): string {
  if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new Error(`Invalid design path: ${name}`);
  const path = realpathSync(resolve(root, name));
  const rel = relative(root, path);
  if (rel.split(/[\\/]/)[0] === '..' || isAbsolute(rel)) throw new Error(`Design path escapes source directory: ${name}`);
  return path;
}
export function loadDesignDoc(entryPath: string): DesignDoc {
  const path = realpathSync(entryPath);
  const root = dirname(path);
  const captured = new Map<string, Buffer>();
  let totalBytes = 0;
  const read = (file: string, name: string): string => {
    const bytes = captured.get(name) ?? readBounded(file);
    totalBytes += bytes.length;
    if (totalBytes > 4 * 1024 * 1024) throw new Error('Design source size exceeds the 4 MiB limit');
    captured.set(name, bytes);
    return bytes.toString('utf8');
  };
  const yaml = <T>(file: string, name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T => {
    try { return schema.parse(parse(read(file, name)) as unknown); }
    catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const entry = yaml(path, relative(root, path), EntrySchema);
  const files = new Set<string>();
  const readDetail = (name?: string): string | undefined => name ? read(childPath(root, name), name) : undefined;
  const items = entry.elements.map(file => {
    const resolved = childPath(root, file);
    if (files.has(resolved)) throw new Error(`${file}: duplicate element file`);
    files.add(resolved);
    const element = yaml(resolved, file, ElementSchema);
    return { ...element, file, detailText: readDetail(element.detail) };
  });
  const detailText = readDetail(entry.detail);
  const sourceRevision = createHash('sha256').update(JSON.stringify([...captured].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, bytes.toString('base64')]))).digest('hex');
  const doc = { ...entry, items, detailText, sourceRevision };
  const ids = new Set<string>([entry.id]);
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`${item.file}: duplicate identity ${item.id}`);
    ids.add(item.id);
  }
  const byId = new Map(items.map(item => [item.id, item]));
  for (const item of items) {
    const visited = new Set([item.id]);
    for (let parent = item.parent; parent; parent = byId.get(parent)?.parent) {
      if (!byId.has(parent)) throw new Error(`${item.file}: unknown parent ${parent}`);
      if (visited.has(parent)) throw new Error(`${item.file}: containment cycle at ${parent}`);
      visited.add(parent);
    }
  }
  const relationshipIds = new Set<string>();
  const relationshipOwners = new Map<string, { from: string; to: string; file: string }>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const edge of item.relationships) {
      if (seen.has(edge.id)) throw new Error(`Relationship ${edge.id}: duplicate declaration in ${item.file}`);
      seen.add(edge.id);
      if (ids.has(edge.id)) throw new Error(`${item.file}: duplicate identity ${edge.id}`);
      relationshipIds.add(edge.id);
      const owner = relationshipOwners.get(edge.id);
      if (owner && (owner.from !== edge.from || owner.to !== edge.to)) throw new Error(`Relationship ${edge.id}: duplicate identity across ${owner.file} and ${item.file} (from/to differ)`);
      if (!owner) relationshipOwners.set(edge.id, { from: edge.from, to: edge.to, file: item.file });
      for (const endpoint of [edge.from, edge.to]) {
        if (!byId.has(endpoint)) throw new Error(`${item.file}: relationship ${edge.id} unknown endpoint ${endpoint}`);
      }
      if (edge.from === edge.to || ![edge.from, edge.to].includes(item.id)) throw new Error(`${item.file}: relationship ${edge.id} must join two distinct endpoints including ${item.id}`);
      for (const endpoint of [edge.from, edge.to]) {
        for (let parent = byId.get(endpoint)?.parent; parent; parent = byId.get(parent)?.parent) {
          if (parent === edge.from || parent === edge.to) throw new Error(`Relationship ${edge.id}: ${parent} contains ${endpoint}; use nesting instead of an ancestor-descendant relationship`);
        }
      }
      const other = byId.get(edge.from === item.id ? edge.to : edge.from) as Element;
      const mirror = other.relationships.find(candidate => candidate.id === edge.id);
      if (!mirror) throw new Error(`Relationship ${edge.id}: ${other.file} missing declaration from ${item.file}`);
      for (const field of ['from', 'to', 'direction', 'label'] as const) {
        if (edge[field] !== mirror[field]) throw new Error(`Relationship ${edge.id}: ${item.file}.${field}=${JSON.stringify(edge[field])} differs from ${other.file}.${field}=${JSON.stringify(mirror[field])}`);
      }
    }
  }
  const concernIds = new Set<string>();
  for (const concern of entry.concerns) {
    if (ids.has(concern.id) || relationshipIds.has(concern.id) || concernIds.has(concern.id)) throw new Error(`${path}: duplicate identity ${concern.id}`);
    concernIds.add(concern.id);
    if (new Set(concern.elements).size !== concern.elements.length) throw new Error(`${path}: concern ${concern.id} repeats an element`);
    for (const id of concern.elements) if (!byId.has(id)) throw new Error(`${path}: concern ${concern.id} unknown element ${id}`);
  }
  return doc;
}
// Schema prose is plain text; only explicit supporting detail files contain authored Markdown.
function markdownText(value: string): string {
  return value.replace(/[&<>]/g, char => `&#${char.charCodeAt(0)};`)
    .replace(/[\\`*{}[\]()#+!_|>~]/g, '\\$&').replace(/[\r\n]/g, ' ');
}
function markdownPath(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}
function itemDetail(doc: DesignDoc, item: Element): string {
  return [item.detailText, ...doc.concerns.filter(c => c.elements.includes(item.id)).map(c => `## ${markdownText(c.name)}\n\n- Requirement: ${markdownText(c.requirement)}\n- Design response: ${markdownText(c.response)}\n- Applies to: ${c.elements.join(', ')}`)].filter(Boolean).join('\n\n');
}
export function designDocToPack(doc: DesignDoc, orientation: DiagramOrientation = 'top-to-bottom'): AlignmentPack {
  const containers = new Set(doc.items.flatMap(item => item.parent ? [item.parent] : []));
  const edges = [...new Map(doc.items.flatMap(item => item.relationships).map(edge => [edge.id, edge])).values()];
  const content = { ...doc };
  delete (content as Partial<DesignDoc>).sourceRevision;
  const version = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
  return AlignmentPackSchema.parse({
    documentKind: 'design', packVersion: `${doc.id}@${version}`,
    designDocument: { id: doc.id, name: doc.name, summary: doc.summary, detail: doc.detailText },
    source: { map: { id: doc.name, version }, references: doc.items.map(item => ({ id: item.id, kind: 'design-element', title: item.name, uri: item.file })) },
    graph: {
      groups: [{ id: 'design:root', label: doc.name, summary: doc.summary, sourceRefs: [] }, ...doc.items.filter(item => containers.has(item.id)).map(item => ({ id: `design:container:${item.id}`, parentGroupId: item.parent ? `design:container:${item.parent}` : 'design:root', label: item.name, ownerNodeId: item.id, summary: item.summary, sourceRefs: [item.id] }))],
      nodes: doc.items.map(item => ({
        id: item.id, groupId: containers.has(item.id) ? `design:container:${item.id}` : item.parent ? `design:container:${item.parent}` : 'design:root', label: item.name, summary: item.summary,
        elementKind: item.kind, channels: item.channels, technicalSummary: itemDetail(doc, item) || undefined, sourceRefs: [item.id],
      })),
      edges: edges.map(edge => ({ id: edge.id, fromNodeId: edge.from, toNodeId: edge.to, direction: edge.direction, relationship: 'design', label: edge.label, summary: edge.label, sourceRefs: [edge.from, edge.to] })), aggregateEdges: [],
    },
    viewState: { orientation, globalDepth: 1, expandedGroups: [], semanticZoom: 'business' }, reviewState: {},
  });
}
// Both the GitHub companion and HTML derive from the same validated source.
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
  const edges = [...new Map(doc.items.flatMap(item => item.relationships).map(edge => [edge.id, edge])).values()];
  for (const edge of edges) lines.push(`    element_${edge.from} ${edge.direction === 'bidirectional' ? '<-->' : '-->'}|"${label(edge.label)}"| element_${edge.to}`);
  return `# ${markdownText(doc.name)}\n\n${markdownText(doc.summary)}\n\n<!-- Generated from the entry YAML and its element files; regenerate with design-doc --markdown -->\n\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n\n${doc.detailText ?? ''}\n\n${doc.items.map(item => `## ${markdownText(item.name)}\n\n*${markdownText(item.summary)}*\n\n- Identity: \`${item.id}\`\n- Kind: ${item.kind}\n- Channels: ${item.channels.join(', ') || 'none'}\n- Source: [${markdownText(item.file)}](${markdownPath(item.file)})\n\n${itemDetail(doc, item)}`).join('\n\n')}`.trimEnd() + '\n';
}
