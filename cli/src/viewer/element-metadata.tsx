import type { AlignmentNode } from '../lib/alignment-packs.js';

const TYPES: Record<string, string> = { actor: 'Actor', component: 'Component', store: 'Store', 'external-system': 'External system' };
const CHANNELS: Record<string, string> = { web: 'Web', mobile: 'Mobile', desktop: 'Desktop', cli: 'CLI', agent: 'Agent', email: 'Email', sms: 'SMS', voice: 'Voice' };
type Progress = NonNullable<AlignmentNode['progress']>;
const STATUS: Record<Progress[number]['status'], string> = { todo: 'To do', 'in-progress': 'In progress', done: 'Done', blocked: 'Blocked' };

// One badge for all of an element's work: done only when every item is, and active work outranks a blocked item.
function overall(progress: Progress): Progress[number]['status'] {
  const has = (status: Progress[number]['status']) => progress.some(item => item.status === status);
  if (progress.every(item => item.status === 'done')) return 'done';
  if (has('in-progress') || has('done')) return 'in-progress';
  return has('blocked') ? 'blocked' : 'todo';
}

export function ElementMetadata({ kind, channels, progress, change }: { kind?: string; channels?: string[]; progress?: Progress; change?: string }) {
  const status = progress?.length ? overall(progress) : undefined;
  const done = progress?.filter(item => item.status === 'done').length ?? 0;
  return <span className="metadata-pills">
    <span className="type-pill" data-kind={kind}>{kind ? TYPES[kind] ?? kind : 'Item'}</span>
    {Boolean(channels?.length) && <span className="channel-pills" role="group" aria-label="Interfaces">{channels!.map(channel => <span key={channel} className="channel-pill">{CHANNELS[channel] ?? channel}</span>)}</span>}
    {change && <span className="change-pill" data-change={change}>{change[0].toUpperCase() + change.slice(1)}</span>}
    {status && <span className="progress-pill" data-status={status} aria-label={`Work: ${STATUS[status]}, ${done} of ${progress!.length} done`}>{STATUS[status]} {done}/{progress!.length}</span>}
  </span>;
}

export function ProgressList({ progress }: { progress?: Progress }) {
  if (!progress?.length) return null;
  return <div className="progress-list">
    <h3>Work</h3>
    <ul>{progress.map(item => <li key={item.id}><span className="progress-pill" data-status={item.status}>{STATUS[item.status]}</span> {item.title} <span className="progress-id">{item.id}</span></li>)}</ul>
  </div>;
}
