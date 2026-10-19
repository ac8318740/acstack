import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { z } from 'zod';
import type { DesignDoc } from './design-doc.js';
import { deriveDepths, isSettled, loadNodes, mapDir, rootCountError, type GraphNode } from './nodes.js';
import { nodesFromIssues } from './github-issues.js';
import { createHash } from 'node:crypto';

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ContributionSchema = z.object({
  id: z.string().min(1), designId: z.string().min(1),
  targets: z.array(z.string().min(1)), statement: z.string().trim().min(1).max(16000),
}).strict();

export function designMapInputs(root: string, doc: DesignDoc, entry: string) {
  let nodes: GraphNode[] = [];
  if (doc.planning) {
    const { tracker, map } = doc.planning;
    if (tracker === 'files') {
      const base = realpathSync(mapDir(root, '.'));
      const path = realpathSync(mapDir(root, map));
      const rel = relative(base, path);
      if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Invalid bound map path');
      nodes = loadNodes(root, map);
    } else {
      const raw = execFileSync('gh', ['issue', 'list', '--state', 'all', '--limit', '1000', '--json', 'number,title,body,state,stateReason,labels,url'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      try {
        const issues: unknown = JSON.parse(raw);
        if (Array.isArray(issues) && issues.length >= 1000) throw new Error('GitHub issue list may be truncated at the 1000-issue limit; map completeness cannot be verified');
        nodes = nodesFromIssues(raw, map);
      } catch (error) { throw new Error(`Invalid GitHub map response: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!nodes.length) throw new Error(`Bound map unavailable: ${map}`);
    deriveDepths(nodes);
    const roots = nodes.filter(node => !node.answers);
    if (roots.length !== 1) throw new Error(rootCountError(roots.length));
    const references = [...(roots[0].body ?? '').matchAll(/^Design entry:[ \t]*(.*)\r?$/gm)];
    if (references.length !== 1) throw new Error('Bound map root needs exactly one Design entry reference');
    const reference = references[0][1].trim();
    if (!reference || isAbsolute(reference) || win32.isAbsolute(reference)) throw new Error('Invalid bound map Design entry path');
    const project = realpathSync(root);
    const target = realpathSync(resolve(root, reference));
    const rel = relative(project, target);
    if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || target !== realpathSync(entry)) throw new Error('Bound map Design entry does not match the authored entry');
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const targets = new Set([doc.id, ...doc.items.map(item => item.id), ...doc.items.flatMap(item => item.relationships.map(edge => edge.id)), ...doc.concerns.map(concern => concern.id)]);
  const contributions: Array<z.infer<typeof ContributionSchema> & { key: string; nodeId: string; provenance: string[] }> = [];
  for (const node of nodes) {
    const sections = [...(node.body ?? '').matchAll(/^## Design contributions\s*\r?\n([\s\S]*?)(?=^#{1,2} |$(?![\s\S]))/gm)];
    const ids = new Set<string>();
    for (const section of sections) {
      const block = /^\s*```json\s*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(section[1]);
      if (!block) throw new Error(`Node ${node.id}: malformed Design contributions`);
      let values: z.infer<typeof ContributionSchema>[];
      try { values = z.array(ContributionSchema).parse(JSON.parse(block[1]) as unknown); }
      catch (error) { throw new Error(`Node ${node.id}: invalid Design contributions: ${error instanceof Error ? error.message : String(error)}`); }
      for (const value of values) {
        if (ids.has(value.id)) throw new Error(`Node ${node.id}: duplicate contribution ${value.id}`);
        ids.add(value.id);
        if (value.designId !== doc.id) continue;
        for (const target of value.targets) if (!targets.has(target)) throw new Error(`Unknown design target: ${target}`);
        const provenance: string[] = [];
        for (let parent = node.answers; parent; parent = byId.get(parent)?.answers) provenance.push(parent);
        contributions.push({ ...value, key: `${node.id}/${value.id}`, nodeId: node.id, provenance });
      }
    }
  }
  contributions.sort((a, b) => a.key.localeCompare(b.key));
  return { contributions, mapInputsDigest: digest({ planning: doc.planning, contributions }), blockingQuestions: nodes.filter(node => node.kind === 'decision' && !isSettled(node.status)).map(node => ({ id: node.id, title: node.title })) };
}
