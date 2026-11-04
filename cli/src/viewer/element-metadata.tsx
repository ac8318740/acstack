const TYPES: Record<string, string> = { actor: 'Actor', component: 'Component', store: 'Store', 'external-system': 'External system' };
const CHANNELS: Record<string, string> = { web: 'Web', mobile: 'Mobile', desktop: 'Desktop', cli: 'CLI', agent: 'Agent', email: 'Email', sms: 'SMS', voice: 'Voice' };

export function ElementMetadata({ kind, channels }: { kind?: string; channels?: string[] }) {
  return <span className="metadata-pills">
    <span className="type-pill" data-kind={kind}>{kind ? TYPES[kind] ?? kind : 'Item'}</span>
    {Boolean(channels?.length) && <span className="channel-pills" role="group" aria-label="Interfaces">{channels!.map(channel => <span key={channel} className="channel-pill">{CHANNELS[channel] ?? channel}</span>)}</span>}
  </span>;
}
