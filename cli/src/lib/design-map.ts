import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { projectFile } from './constants.js';
import { digest, targetingNodes, type DesignDoc } from './design-doc.js';
import { nodesFromIssues } from './github-issues.js';
import { loadNodes, mapDir, updateNode, type GraphNode } from './nodes.js';
import { getProjectKey } from './project-config.js';

const gh = (args: string[], input?: string): string => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 });
const onGithub = (root: string): boolean => {
  const tracked = getProjectKey(projectFile(root), 'workflow.maps.tracker');
  return tracked.status === 'set' && tracked.value === 'github';
};

/** The map's nodes from whichever tracker the project uses. */
export function readMapNodes(root: string, map: string): GraphNode[] {
  if (!onGithub(root)) {
    if (!existsSync(mapDir(root, map))) throw new Error(`Map '${map}' does not exist - there is no ${mapDir(root, map)} directory.`);
    return loadNodes(root, map);
  }
  const raw = gh(['issue', 'list', '--label', `map:${map}`, '--state', 'all', '--limit', '1000', '--json', 'number,title,body,state,stateReason,labels,url']);
  try {
    const issues: unknown = JSON.parse(raw);
    if (Array.isArray(issues) && issues.length >= 1000) throw new Error('GitHub issue list may be truncated at the 1000-issue limit; map completeness cannot be verified');
    return nodesFromIssues(raw, map);
  } catch (error) { throw new Error(`Invalid GitHub map response: ${error instanceof Error ? error.message : String(error)}`); }
}

/**
 * Resolve a node through its tracker, appending `## Answer` when one is given.
 * On GitHub a retry after a failed close skips the edit, since the answer is already in the body.
 */
export function resolveMapNode(root: string, map: string, id: string, answer?: string): void {
  const section = answer === undefined ? undefined : `## Answer\n\n${answer}`;
  if (!onGithub(root)) {
    updateNode(root, map, id, { status: 'resolved', ...(section && { appendBody: section }) });
    return;
  }
  if (section) {
    const { body } = JSON.parse(gh(['issue', 'view', id, '--json', 'body'])) as { body: string };
    if (!body.includes(section)) gh(['issue', 'edit', id, '--body-file', '-'], `${body.trimEnd()}\n\n${section}\n`);
  }
  gh(['issue', 'close', id, '--reason', 'completed']);
}

/** What approval covers from the map beyond the design's own text: every node targeting an element. Lock state is not an input; approval itself locks. */
export function designMapInputs(nodes: readonly GraphNode[], doc: DesignDoc) {
  const targeting = targetingNodes(nodes);
  const open = new Set(targeting.map(node => node.id));
  return {
    mapInputsDigest: digest(targeting.map(node => [node.id, node.status, node.title, node.body ?? ''])),
    blockingQuestions: targeting.map(node => ({ id: node.id, title: node.title })),
    openQuestions: doc.questions.filter(question => open.has(question.id)).map(question => question.id),
    locked: doc.items.filter(item => item.locked).map(item => item.id),
  };
}
