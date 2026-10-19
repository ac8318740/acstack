import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';
import { REVIEW_HANDOFF_ID, REVIEW_MODE_META, REVIEW_TOKEN_HEADER, REVIEW_TOKEN_META } from './alignment-review-protocol.js';
import { embeddedJson } from './alignment-pack-renderer.js';

export const REVIEW_PORT = 19990;
const MAX_REVIEW_BYTES = 1_000_000;

export class ReviewHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// The same loopback/token boundary protects decision reviews and live design comments.
export function createReviewServer(options: {
  html: string;
  path: string;
  mode?: 'comments';
  handoffPrompt?: string;
  get?: () => unknown;
  post: (body: unknown) => unknown;
  recorded?: () => void;
}): Server {
  const token = randomBytes(16).toString('hex');
  const metadata = `<meta name="${REVIEW_TOKEN_META}" content="${token}">${options.mode ? `<meta name="${REVIEW_MODE_META}" content="comments">` : ''}`;
  const handoff = options.mode === 'comments' && options.handoffPrompt
    ? `<script id="${REVIEW_HANDOFF_ID}" type="application/json">${embeddedJson(options.handoffPrompt)}</script>` : '';
  const html = options.html.replace('</head>', `${metadata}${handoff}\n</head>`);
  let busy = false;
  return createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Reject DNS rebinding before exposing the page containing the secret.
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? '')) return reply(421, { error: 'Unknown host' });
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    if (req.url !== options.path || (req.method !== 'POST' && !(req.method === 'GET' && options.get))) return reply(404, { error: 'Not found' });
    if (req.headers[REVIEW_TOKEN_HEADER] !== token) return reply(403, { error: 'This page is from an older review. Reload it.' });
    if (req.method === 'GET') {
      void Promise.resolve().then(() => options.get?.()).then(body => reply(200, body)).catch((error: unknown) => {
        reply(error instanceof ReviewHttpError ? error.status : 500, { error: 'Cannot read review feedback' });
      });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REVIEW_BYTES) { reply(413, { error: 'Review too large' }); chunks.length = 0; }
      else if (!res.writableEnded) chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      if (busy) return reply(409, { error: 'A review is already being recorded.' });
      busy = true;
      void (async () => {
        try {
          const result = await options.post(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          reply(200, result);
          options.recorded?.();
        } catch (error) {
          reply(error instanceof ReviewHttpError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) });
        } finally { busy = false; }
      })();
    });
  });
}

export function listenForReview(server: Server, port: number, label: string, onListening?: (url: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    server.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is busy. Close the other review, or choose another port.`) : error));
    server.on('close', resolve);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const url = `http://localhost:${actualPort}/`;
      console.log(`Review ${label} at ${url}`);
      if (process.env.SSH_CONNECTION) {
        console.log('Over SSH, forward the port from your own machine first:');
        console.log(`  ssh -N -L ${actualPort}:localhost:${actualPort} ${hostname()}`);
        console.log(`Or add "LocalForward ${actualPort} localhost:${actualPort}" to that host in ~/.ssh/config to make it automatic.`);
      }
      console.log('Waiting for your review. Ctrl+C stops.');
      onListening?.(url);
    });
  });
}
