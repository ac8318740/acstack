import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AnnotationTarget = {
  type: string;
  id: string;
};

export type AnnotationEvent = {
  annotationsPath?: string;
  packVersion: string;
  target: AnnotationTarget;
  selectedText?: string;
  sourceRef?: string;
  comment: string;
  author?: string;
  time?: string;
};

type StoredAnnotationEvent = Omit<AnnotationEvent, 'annotationsPath'>;

export type AppendAnnotationEventOptions = AnnotationEvent & {
  annotationsPath: string;
};

type FeedbackGroup = {
  id: string;
  label: string;
  summary: string;
  sourceRefs?: string[];
};

type FeedbackNode = {
  id: string;
  groupId: string;
  label: string;
  technicalLabel?: string;
  technicalSummary?: string;
  summary: string;
  sourceRefs?: string[];
};

type FeedbackEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationship: string;
  label: string;
  summary: string;
  sourceRefs?: string[];
};

type FeedbackAggregateEdge = {
  id?: string;
  fromGroupId: string;
  toGroupId: string;
  label?: string;
  summary?: string;
  childEdgeIds: string[];
  sourceRefs?: string[];
};

export type AnnotationFeedbackPack = {
  packVersion: string;
  source: {
    map: {
      id: string;
      version: string;
    };
  };
  graph: {
    groups: FeedbackGroup[];
    nodes: FeedbackNode[];
    edges: FeedbackEdge[];
    aggregateEdges: FeedbackAggregateEdge[];
  };
};

export type ExportAnnotationFeedbackOptions = {
  annotationsPath: string;
  feedbackPath: string;
  pack: AnnotationFeedbackPack;
};

export type ExportAnnotationFeedbackResult = {
  markdown: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseAnnotation(value: unknown, annotationsPath: string, lineNumber: number): StoredAnnotationEvent {
  if (!isRecord(value)) {
    throw new Error(`${annotationsPath} line ${lineNumber}: annotation must be a JSON object`);
  }

  const target = value.target;
  if (!isRecord(target)) {
    throw new Error(`${annotationsPath} line ${lineNumber}: annotation target must be a JSON object`);
  }

  const annotation = {
    packVersion: stringField(value, 'packVersion'),
    target: {
      type: stringField(target, 'type'),
      id: stringField(target, 'id'),
    },
    selectedText: stringField(value, 'selectedText'),
    sourceRef: stringField(value, 'sourceRef'),
    comment: stringField(value, 'comment'),
    author: stringField(value, 'author'),
    time: stringField(value, 'time'),
  };

  if (!annotation.packVersion || !annotation.target.type || !annotation.target.id || !annotation.comment) {
    throw new Error(`${annotationsPath} line ${lineNumber}: annotation requires packVersion, target.type, target.id, and comment`);
  }

  return annotation as StoredAnnotationEvent;
}

async function readAnnotations(annotationsPath: string): Promise<StoredAnnotationEvent[]> {
  const text = await readFile(annotationsPath, 'utf8');
  const annotations: StoredAnnotationEvent[] = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${annotationsPath} line ${lineNumber}: invalid JSON annotation: ${message}`);
    }
    annotations.push(parseAnnotation(parsed, annotationsPath, lineNumber));
  }

  return annotations;
}

function markdownEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|');
}

function bullet(label: string, value: string | undefined): string {
  return value ? `- ${label}: ${value}\n` : '';
}

function targetKey(annotation: StoredAnnotationEvent): string {
  return `${annotation.target.type}\u0000${annotation.target.id}`;
}

function targetHeading(annotation: StoredAnnotationEvent): string {
  return `${annotation.target.type} ${annotation.target.id}`;
}

function nodeName(pack: AnnotationFeedbackPack, id: string): string {
  const label = pack.graph.nodes.find(node => node.id === id)?.label;
  return label ? `${label} (${id})` : id;
}

function graphContext(pack: AnnotationFeedbackPack, target: AnnotationTarget): string {
  if (target.type === 'group') {
    const group = pack.graph.groups.find(candidate => candidate.id === target.id);
    if (!group) return '- Graph context: target not found in pack graph\n';
    return [
      '- Graph context: group\n',
      bullet('Label', group.label),
      bullet('Summary', group.summary),
      bullet('Source refs', group.sourceRefs?.join(', ')),
    ].join('');
  }

  if (target.type === 'node') {
    const node = pack.graph.nodes.find(candidate => candidate.id === target.id);
    if (!node) return '- Graph context: target not found in pack graph\n';
    const group = pack.graph.groups.find(candidate => candidate.id === node.groupId);
    return [
      '- Graph context: node\n',
      bullet('Label', node.label),
      bullet('Technical label', node.technicalLabel),
      bullet('Summary', node.summary),
      // The reviewer may quote either definition, so the agent sees both.
      node.technicalSummary ? `- Technical definition:\n\n${node.technicalSummary.split('\n').map(line => `  > ${line}`.trimEnd()).join('\n')}\n\n` : '',
      bullet('Group', group ? `${group.label} (${group.id})` : node.groupId),
      bullet('Source refs', node.sourceRefs?.join(', ')),
    ].join('');
  }

  if (target.type === 'edge') {
    const edge = pack.graph.edges.find(candidate => candidate.id === target.id);
    if (!edge) return '- Graph context: target not found in pack graph\n';
    return [
      '- Graph context: edge\n',
      bullet('Label', edge.label),
      bullet('Relationship', edge.relationship),
      bullet('From node', nodeName(pack, edge.fromNodeId)),
      bullet('To node', nodeName(pack, edge.toNodeId)),
      bullet('Summary', edge.summary),
      bullet('Source refs', edge.sourceRefs?.join(', ')),
    ].join('');
  }

  if (target.type === 'aggregateEdge') {
    const edge = pack.graph.aggregateEdges.find(candidate => candidate.id === target.id);
    if (!edge) return '- Graph context: target not found in pack graph\n';
    return [
      '- Graph context: aggregate edge\n',
      bullet('Label', edge.label),
      bullet('From group', edge.fromGroupId),
      bullet('To group', edge.toGroupId),
      bullet('Summary', edge.summary),
      bullet('Child edge ids', edge.childEdgeIds.join(', ')),
      bullet('Source refs', edge.sourceRefs?.join(', ')),
    ].join('');
  }

  return '- Graph context: target type not found in pack graph\n';
}

function annotationMarkdown(annotation: StoredAnnotationEvent, index: number): string {
  return [
    `### Annotation ${index}\n\n`,
    bullet('Comment', annotation.comment),
    bullet('Selected text', annotation.selectedText),
    bullet('Source ref', annotation.sourceRef),
    bullet('Author', annotation.author),
    bullet('Time', annotation.time),
    '\n',
  ].join('');
}

function renderMarkdown(pack: AnnotationFeedbackPack, annotations: StoredAnnotationEvent[]): string {
  const grouped = new Map<string, StoredAnnotationEvent[]>();
  for (const annotation of annotations) {
    const key = targetKey(annotation);
    const targetAnnotations = grouped.get(key) ?? [];
    targetAnnotations.push(annotation);
    grouped.set(key, targetAnnotations);
  }

  const sections = [...grouped.values()].map(targetAnnotations => {
    const first = targetAnnotations[0];
    if (!first) return '';
    return [
      `## ${targetHeading(first)}\n\n`,
      `Target id: ${markdownEscape(first.target.id)}\n\n`,
      graphContext(pack, first.target),
      '\n',
      targetAnnotations.map((annotation, index) => annotationMarkdown(annotation, index + 1)).join(''),
    ].join('');
  });

  return [
    `# Alignment annotation feedback\n\n`,
    `Pack version: ${pack.packVersion}\n\n`,
    `Map: ${pack.source.map.id} (${pack.source.map.version})\n\n`,
    ...sections,
  ].join('');
}

export async function appendAnnotationEvent(options: AppendAnnotationEventOptions): Promise<void> {
  const { annotationsPath, ...event } = options;
  await mkdir(dirname(annotationsPath), { recursive: true });
  await appendFile(annotationsPath, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function exportAnnotationFeedbackMarkdown(
  options: ExportAnnotationFeedbackOptions
): Promise<ExportAnnotationFeedbackResult> {
  const annotations = await readAnnotations(options.annotationsPath);
  for (const annotation of annotations) {
    if (annotation.packVersion !== options.pack.packVersion) {
      throw new Error(
        `annotation packVersion ${annotation.packVersion} does not match pack packVersion ${options.pack.packVersion}`
      );
    }
  }

  const markdown = renderMarkdown(options.pack, annotations);
  await mkdir(dirname(options.feedbackPath), { recursive: true });
  await writeFile(options.feedbackPath, markdown, 'utf8');
  return { markdown };
}

export function createAnnotationFeedbackHandoff(feedbackPath: string): string {
  return `Agent feedback is ready at ${feedbackPath}. Ask the implementation agent to review that file and apply the requested alignment changes.`;
}
