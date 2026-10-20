import { z } from 'zod';

const SourceReferenceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    title: z.string().min(1),
    uri: z.string().min(1),
  })
  .strict();

const AlignmentGroupSchema = z
  .object({
    id: z.string().min(1),
    parentGroupId: z.string().min(1).optional(),
    ownerNodeId: z.string().min(1).optional(),
    label: z.string().min(1),
    summary: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).default([]),
  })
  .strict();

const AlignmentNodeSchema = z
  .object({
    id: z.string().min(1),
    groupId: z.string().min(1),
    label: z.string().min(1),
    technicalLabel: z.string().min(1).optional(),
    elementKind: z.enum(['actor', 'component', 'store', 'external-system']).optional(),
    channels: z.array(z.enum(['web', 'mobile', 'desktop', 'cli', 'agent', 'email', 'sms', 'voice'])).optional(),
    summary: z.string().min(1),
    // The full technical definition, as markdown; `summary` is the plain-language one.
    technicalSummary: z.string().min(1).optional(),
    sourceRefs: z.array(z.string().min(1)).default([]),
  })
  .strict();

const AlignmentEdgeSchema = z
  .object({
    id: z.string().min(1),
    direction: z.enum(['one-way', 'bidirectional']).optional(),
    fromNodeId: z.string().min(1),
    toNodeId: z.string().min(1),
    relationship: z.string().min(1),
    label: z.string().min(1),
    aggregateLabel: z.string().min(1).optional(),
    summary: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).default([]),
  })
  .strict();

const AggregateEdgeSchema = z
  .object({
    id: z.string().min(1).optional(),
    fromGroupId: z.string().min(1),
    toGroupId: z.string().min(1),
    label: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    childEdgeIds: z.array(z.string().min(1)).default([]),
    sourceRefs: z.array(z.string().min(1)).default([]),
  })
  .strict();

const AlignmentGraphSchema = z
  .object({
    groups: z.array(AlignmentGroupSchema),
    nodes: z.array(AlignmentNodeSchema),
    edges: z.array(AlignmentEdgeSchema),
    aggregateEdges: z.array(AggregateEdgeSchema).default([]),
  })
  .strict();

export const DiagramOrientationSchema = z.enum(['top-to-bottom', 'left-to-right']);
export type DiagramOrientation = z.infer<typeof DiagramOrientationSchema>;

const ViewStateSchema = z
  .object({
    orientation: DiagramOrientationSchema.optional(),
    globalDepth: z.number().int().nonnegative(),
    expandedGroups: z.array(z.string().min(1)).default([]),
    semanticZoom: z.string().min(1),
  })
  .strict();

export const REVIEW_STATUSES = ['approved', 'changes-requested'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const ApprovalSchema = z
  .object({
    packVersion: z.string().min(1),
    status: z.enum(REVIEW_STATUSES),
    approvedBy: z.string().min(1).optional(),
    approvedAt: z.string().min(1).optional(),
  })
  .strict();

// Shared by the pack and by a review posted back to `acstack align-viewer`, so the two cannot drift.
export const ReviewStateSchema = z
  .object({
    approval: ApprovalSchema.optional(),
  })
  .strict()
  .default({});

// One reviewer comment. Same shape as AnnotationEvent in alignment-feedback.ts, which reads them back.
export const ReviewAnnotationSchema = z
  .object({
    packVersion: z.string().min(1),
    target: z.object({ type: z.enum(['node', 'group', 'edge', 'aggregateEdge']), id: z.string().min(1) }).strict(),
    selectedText: z.string().min(1).optional(),
    sourceRef: z.string().min(1).optional(),
    comment: z.string().min(1),
    author: z.string().min(1).optional(),
    time: z.string().min(1).optional(),
  })
  .strict();
export type ReviewAnnotation = z.infer<typeof ReviewAnnotationSchema>;

export const AlignmentPackSchema = z
  .object({
    // Optional so legacy alignment packs keep their existing framing.
    documentKind: z.literal('design').optional(),
    designDocument: z.object({
      id: z.string().min(1), name: z.string().min(1), summary: z.string().min(1), detail: z.string().optional(),
    }).strict().optional(),
    packVersion: z.string().min(1),
    source: z
      .object({
        map: z
          .object({
            id: z.string().min(1),
            version: z.string().min(1),
          })
          .strict(),
        references: z.array(SourceReferenceSchema).default([]),
      })
      .strict(),
    graph: AlignmentGraphSchema,
    viewState: ViewStateSchema,
    reviewState: ReviewStateSchema,
  })
  .strict()
  .superRefine((pack, ctx) => {
    const owners = new Set<string>();
    for (const [index, group] of pack.graph.groups.entries()) {
      if (!group.ownerNodeId) continue;
      const owner = pack.graph.nodes.find(node => node.id === group.ownerNodeId);
      const message = !owner ? 'group owner must name an existing node'
        : owners.has(owner.id) ? 'node ownership must be unique'
        : owner.groupId !== group.id ? 'owner membership must be its owned group' : undefined;
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['graph', 'groups', index, 'ownerNodeId'], message });
      owners.add(group.ownerNodeId);
    }
    if (pack.reviewState.approval && pack.reviewState.approval.packVersion !== pack.packVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewState', 'approval', 'packVersion'],
        message: 'approval pack version must match pack version',
      });
    }
  });

export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type AlignmentGroup = z.infer<typeof AlignmentGroupSchema>;
export type AlignmentNode = z.infer<typeof AlignmentNodeSchema>;
export type AlignmentEdge = z.infer<typeof AlignmentEdgeSchema>;
export type AggregateEdge = z.infer<typeof AggregateEdgeSchema>;
export type AlignmentGraph = z.infer<typeof AlignmentGraphSchema>;
export type AlignmentPack = z.infer<typeof AlignmentPackSchema>;
export type ViewState = z.infer<typeof ViewStateSchema>;

function aggregateKey(fromGroupId: string, toGroupId: string): string {
  return `${fromGroupId}\u0000${toGroupId}`;
}

function generatedAggregateLabel(fromGroup: AlignmentGroup, toGroup: AlignmentGroup): string {
  return `${fromGroup.label} affects ${toGroup.label}`;
}

function aggregateId(fromGroupId: string, toGroupId: string): string {
  return `aggregate-${fromGroupId}-to-${toGroupId}`;
}

function groupIsExpanded(groupId: string, viewState: ViewState): boolean {
  return viewState.globalDepth > 1 || viewState.expandedGroups.includes(groupId);
}

export function deriveAggregateEdges(graph: AlignmentGraph, viewState: ViewState): AggregateEdge[] {
  const groupsById = new Map(graph.groups.map(group => [group.id, group]));
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  const declaredAggregates = new Map(
    graph.aggregateEdges.map(edge => [aggregateKey(edge.fromGroupId, edge.toGroupId), edge])
  );
  const aggregates = new Map<string, AggregateEdge>();

  for (const edge of graph.edges) {
    const fromNode = nodesById.get(edge.fromNodeId);
    const toNode = nodesById.get(edge.toNodeId);
    if (!fromNode || !toNode || fromNode.groupId === toNode.groupId) continue;

    const fromGroup = groupsById.get(fromNode.groupId);
    const toGroup = groupsById.get(toNode.groupId);
    if (!fromGroup || !toGroup) continue;
    if (groupIsExpanded(fromGroup.id, viewState) && groupIsExpanded(toGroup.id, viewState)) continue;

    const key = aggregateKey(fromGroup.id, toGroup.id);
    const declared = declaredAggregates.get(key);
    const existing = aggregates.get(key);

    if (existing) {
      existing.childEdgeIds.push(edge.id);
      existing.sourceRefs = [...new Set([...existing.sourceRefs, ...edge.sourceRefs])];
      if (!declared?.label && !existing.label && edge.aggregateLabel) existing.label = edge.aggregateLabel;
      continue;
    }

    aggregates.set(key, {
      id: declared?.id ?? aggregateId(fromGroup.id, toGroup.id),
      fromGroupId: fromGroup.id,
      toGroupId: toGroup.id,
      childEdgeIds: [edge.id],
      label: declared?.label ?? edge.aggregateLabel ?? generatedAggregateLabel(fromGroup, toGroup),
      summary: declared?.summary ?? edge.summary,
      sourceRefs: [...new Set([...(declared?.sourceRefs ?? []), ...edge.sourceRefs])],
    });
  }

  return [...aggregates.values()];
}
