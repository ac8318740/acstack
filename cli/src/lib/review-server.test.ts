import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createReviewServer } from './review-server.js';

const servers: ReturnType<typeof createReviewServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

async function start() {
  const post = vi.fn(() => ({ ok: true }));
  const server = createReviewServer({ html: '<html><head></head></html>', path: '/api/review', post });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const token = /acstack-review-token" content="([^"]+)"/.exec(await (await fetch(`http://127.0.0.1:${port}/`)).text())?.[1] ?? '';
  // node:http, not fetch, so the test controls Origin exactly, including leaving it out.
  const send = (origin?: string) => new Promise<number | undefined>((resolve, reject) => {
    const headers: Record<string, string> = { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'x-review-token': token };
    if (origin !== undefined) headers.origin = origin;
    request({ host: '127.0.0.1', port, path: '/api/review', method: 'POST', headers }, response => { response.resume(); resolve(response.statusCode); })
      .on('error', reject).end('{}');
  });
  return { port, post, send };
}

it('accepts a write only from the review page origin', async () => {
  const { port, post, send } = await start();
  expect(await send(`http://127.0.0.1:${port}`)).toBe(200);
  expect(post).toHaveBeenCalledTimes(1);
});

it('rejects a write with a missing, null, or foreign Origin', async () => {
  const { port, post, send } = await start();
  for (const origin of [undefined, 'null', 'https://example.com', `http://localhost:${port}`, `http://127.0.0.1:${port + 1}`]) expect(await send(origin)).toBe(403);
  expect(post).not.toHaveBeenCalled();
});
