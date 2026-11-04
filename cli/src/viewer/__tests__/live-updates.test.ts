import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const first = { packVersion: 'design@v1', viewState: {}, reviewState: {}, source: { map: { id: 'Design', version: 'v1' } }, graph: { nodes: [], groups: [], edges: [] } };
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'alignment-pack-data' ? { textContent: JSON.stringify(first) } : { textContent: '"Read the first review"' },
    querySelector: (selector: string) => selector.includes('token') ? { content: 'secret' } : { content: 'comments' },
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

const stream = (frames: string[]) => new ReadableStream<Uint8Array>({
  start(controller) { for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame)); },
});

it('applies pushed packs from the token-gated stream and reports build errors', async () => {
  const live = await import('../pack.js');
  expect(live.pack.packVersion).toBe('design@v1');
  const second = { ...first, packVersion: 'design@v2' };
  const errors: Array<string | null> = [];
  const request = vi.fn<typeof fetch>(() => Promise.resolve(new Response(stream([
    ': connected\n\n',
    // A frame split across chunks must still parse whole.
    `data: ${JSON.stringify({ type: 'design', pack: second, handoffPrompt: 'Read both reviews' }).slice(0, 20)}`,
    `${JSON.stringify({ type: 'design', pack: second, handoffPrompt: 'Read both reviews' }).slice(20)}\n\n`,
    `data: ${JSON.stringify({ type: 'error', message: 'Node 003: invalid' })}\n\n`,
  ]), { status: 200 })));
  const stop = live.followLiveUpdates(message => errors.push(message), request);
  await vi.waitFor(() => expect(errors).toEqual([null, 'Node 003: invalid']));
  stop();
  expect(request.mock.calls[0][0]).toBe('/api/events');
  expect(request.mock.calls[0][1]?.headers).toEqual({ 'x-review-token': 'secret' });
  // ES live bindings: every importer now reads the rebuilt pack and prompt.
  expect(live.pack.packVersion).toBe('design@v2');
  expect(live.handoffPrompt).toBe('Read both reviews');
});

it('counts each replacement so components re-render in place', async () => {
  const live = await import('../pack.js');
  const seen: number[] = [];
  const { renderToString } = await import('react-dom/server');
  const { createElement } = await import('react');
  function Probe() { seen.push(live.usePackRevision()); return null; }
  renderToString(createElement(Probe));
  live.replacePack({ ...first, packVersion: 'design@v1' } as never);
  renderToString(createElement(Probe));
  expect(seen).toEqual([0, 1]);
});
