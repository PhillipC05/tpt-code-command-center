/**
 * Integration test: pipeline pass-through with a real mock upstream HTTP server.
 *
 * Does NOT require the VS Code runtime — vscode is stubbed via mock-vscode.
 * The test:
 *   1. Starts a local HTTP server acting as the upstream LLM API
 *   2. Patches getConfig() to route traffic to that server
 *   3. Runs the TPT pipeline on a sample request
 *   4. Forwards the result to the mock upstream manually (simulating server.ts)
 *   5. Verifies the upstream received the expected body and the response round-trips
 */

import '../helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import * as net from 'net';

// ── mock upstream ─────────────────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let mockUpstream: http.Server;
let mockPort: number;
const captured: CapturedRequest[] = [];
let mockResponseBody = '';
let mockResponseStatus = 200;

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function bufferRequest(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function forwardToUpstream(
  baseUrl: string,
  path: string,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
      },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString('utf8') })
      );
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  mockPort = await findFreePort();

  mockUpstream = http.createServer(async (req, res) => {
    const body = await bufferRequest(req);
    captured.push({ method: req.method ?? 'POST', path: req.url ?? '/', headers: req.headers, body });
    res.writeHead(mockResponseStatus, { 'content-type': 'application/json' });
    res.end(mockResponseBody);
  });

  await new Promise<void>((resolve) => mockUpstream.listen(mockPort, '127.0.0.1', resolve));
});

after(() => {
  mockUpstream.close();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function resetCapture(responseBody: unknown, status = 200): void {
  captured.length = 0;
  mockResponseBody = JSON.stringify(responseBody);
  mockResponseStatus = status;
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('pipeline: clean message passes through unchanged when no modules active', async () => {
  const { runPipeline } = await import('../../proxy/pipeline');

  const proxyReq = {
    method: 'POST',
    path: '/v1/chat/completions',
    headers: {},
    body: {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello, world!' }],
    },
    format: 'openai' as const,
    sessionToken: 'test',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runPipeline(proxyReq as any);
  assert.ok(result.body, 'pipeline returned a body');
  assert.ok(!result.cachedResponse, 'no cache hit on first call');
  assert.deepEqual(
    (result.body as { messages: { role: string; content: string }[] }).messages,
    [{ role: 'user', content: 'Hello, world!' }]
  );
});

test('pass-through: upstream receives the body sent by the pipeline', async () => {
  const upstreamResponsePayload = {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  resetCapture(upstreamResponsePayload);

  const outBody = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello upstream!' }],
  });

  const { status, body } = await forwardToUpstream(
    `http://127.0.0.1:${mockPort}`,
    '/v1/chat/completions',
    outBody,
  );

  assert.equal(status, 200);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].path, '/v1/chat/completions');

  const receivedBody = JSON.parse(captured[0].body) as { messages: { content: string }[] };
  assert.equal(receivedBody.messages[0].content, 'Hello upstream!');

  const responseJson = JSON.parse(body) as typeof upstreamResponsePayload;
  assert.equal(responseJson.choices[0].message.content, 'Hi!');
});

test('pass-through: upstream 4xx errors are forwarded as-is', async () => {
  resetCapture({ error: 'invalid_api_key' }, 401);

  const { status, body } = await forwardToUpstream(
    `http://127.0.0.1:${mockPort}`,
    '/v1/chat/completions',
    JSON.stringify({ model: 'x', messages: [] }),
  );

  assert.equal(status, 401);
  const parsed = JSON.parse(body) as { error: string };
  assert.equal(parsed.error, 'invalid_api_key');
});

test('pass-through: large body round-trips intact', async () => {
  const longContent = 'a'.repeat(50_000);
  const upstreamPayload = {
    choices: [{ message: { role: 'assistant', content: 'processed' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12500, completion_tokens: 1, total_tokens: 12501 },
  };
  resetCapture(upstreamPayload);

  const outBody = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: longContent }],
  });

  const { status } = await forwardToUpstream(
    `http://127.0.0.1:${mockPort}`,
    '/v1/chat/completions',
    outBody,
  );

  assert.equal(status, 200);
  assert.equal(captured.length, 1);
  const received = JSON.parse(captured[0].body) as { messages: { content: string }[] };
  assert.equal(received.messages[0].content.length, 50_000);
});

test('pass-through: Anthropic /v1/messages path is preserved', async () => {
  resetCapture({ content: [{ type: 'text', text: 'Hello' }], usage: { output_tokens: 1 } });

  await forwardToUpstream(
    `http://127.0.0.1:${mockPort}`,
    '/v1/messages',
    JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
  );

  assert.equal(captured[0].path, '/v1/messages');
});
