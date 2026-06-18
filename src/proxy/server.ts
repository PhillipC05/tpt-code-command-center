import * as http from 'http';
import * as net from 'net';
import * as https from 'https';
import * as vscode from 'vscode';
import { getConfig, resolveUpstreamUrl } from '../utils/config';
import { log } from '../utils/logger';
import { runPipeline } from './pipeline';
import { recordRequest } from '../ledger/ledger';
import { storeCachedResponse } from '../modules/tokenShield';
import { handleSilentEditResponse } from '../modules/silentEdit';
import { AnthropicRequest, OpenAIRequest, ProxyRequest } from './types';
import { countTokens } from '../ledger/ledger';

const PREFERRED_PORT = 7331;
let server: http.Server | undefined;
let activePort: number | undefined;
let sessionToken: string | undefined;

export function getProxyUrl(): string | undefined {
  return activePort ? `http://localhost:${activePort}` : undefined;
}

export function getSessionToken(): string | undefined {
  return sessionToken;
}

async function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', () => {
      // Port in use — try next
      findFreePort(start + 1).then(resolve, reject);
    });
  });
}

function detectFormat(path: string): 'anthropic' | 'openai' {
  if (path.startsWith('/v1/messages')) return 'anthropic';
  return 'openai';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function forwardRequest(
  targetUrl: string,
  apiKey: string,
  path: string,
  method: string,
  originalHeaders: http.IncomingHttpHeaders,
  body: string,
  format: 'anthropic' | 'openai',
  upstreamProvider: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const fullPath = url.pathname.replace(/\/$/, '') + path;

    const outHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    };

    if (apiKey) {
      if (upstreamProvider === 'anthropic') {
        outHeaders['x-api-key'] = apiKey;
        outHeaders['anthropic-version'] = '2023-06-01';
      } else {
        outHeaders['authorization'] = `Bearer ${apiKey}`;
      }
    }

    // Forward useful headers from the original request (minus auth)
    const passthroughHeaders = ['accept', 'user-agent', 'anthropic-version', 'anthropic-beta'];
    for (const h of passthroughHeaders) {
      if (originalHeaders[h]) {
        outHeaders[h] = originalHeaders[h] as string;
      }
    }

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: fullPath,
      method,
      headers: outHeaders,
    };

    const proto = url.protocol === 'https:' ? https : http;
    const outReq = proto.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 500,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    outReq.on('error', reject);
    outReq.write(body);
    outReq.end();
  });
}

export async function startProxyServer(context: vscode.ExtensionContext): Promise<void> {
  sessionToken = context.globalState.get<string>('tpt.sessionToken');
  if (!sessionToken) {
    sessionToken = require('crypto').randomBytes(32).toString('hex');
    await context.globalState.update('tpt.sessionToken', sessionToken);
  }

  const port = await findFreePort(PREFERRED_PORT);
  activePort = port;

  // Inject ANTHROPIC_BASE_URL into VS Code terminal environments
  await injectTerminalEnv(context, port);

  server = http.createServer(async (req, res) => {
    const config = getConfig();

    // Security: require session token on all requests
    const incomingToken = req.headers['x-tpt-token'] as string | undefined;
    if (incomingToken !== sessionToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized — missing or invalid X-TPT-Token header' }));
      return;
    }

    // Bypass everything if master switch is off
    if (!config.enabled) {
      const rawBody = await readBody(req);
      const upstream = resolveUpstreamUrl(config);
      const format = detectFormat(req.url ?? '/');
      try {
        const forwarded = await forwardRequest(
          upstream.baseUrl, upstream.apiKey,
          req.url ?? '/', req.method ?? 'POST',
          req.headers, rawBody, format, config.upstreamProvider
        );
        res.writeHead(forwarded.status, forwarded.headers as Record<string, string>);
        res.end(forwarded.body);
      } catch (e) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    const rawBody = await readBody(req);
    const format = detectFormat(req.url ?? '/');
    let parsedBody: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const proxyReq: ProxyRequest = {
      method: req.method ?? 'POST',
      path: req.url ?? '/',
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: parsedBody,
      format,
      sessionToken: sessionToken!,
    };

    let pipelineResult;
    try {
      pipelineResult = await runPipeline(proxyReq);
    } catch (e) {
      log(`Pipeline error: ${e}`);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `TPT pipeline error: ${e}` }));
      return;
    }

    // Cache hit — return stored response directly
    if (pipelineResult.cachedResponse) {
      const tokensIn = countTokens(parsedBody as AnthropicRequest | OpenAIRequest);
      await recordRequest({
        model: (parsedBody as AnthropicRequest).model ?? 'unknown',
        tokensIn,
        tokensOut: 0,
        costUsd: 0,
        moduleActions: pipelineResult.moduleActions,
        cacheHit: true,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(pipelineResult.cachedResponse);
      return;
    }

    // Determine upstream target
    const upstream = pipelineResult.overrideUpstream ?? resolveUpstreamUrl(config);
    const outBody = JSON.stringify(pipelineResult.body);
    const tokensIn = countTokens(pipelineResult.body as AnthropicRequest | OpenAIRequest);

    let forwarded;
    try {
      forwarded = await forwardRequest(
        upstream.baseUrl, upstream.apiKey,
        req.url ?? '/', req.method ?? 'POST',
        req.headers, outBody, format, config.upstreamProvider
      );
    } catch (e) {
      log(`Upstream error: ${e}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Upstream request failed: ${e}` }));
      return;
    }

    // Store in cache if Token Shield is on
    if (config.tokenShield.enabled && forwarded.status === 200 &&
        'messages' in pipelineResult.body && Array.isArray((pipelineResult.body as AnthropicRequest).messages)) {
      await storeCachedResponse(
        (pipelineResult.body as AnthropicRequest).messages,
        forwarded.body,
        config.tokenShield.maxCacheSizeMB
      );
    }

    // Handle Silent Edit response interception
    let finalBody = forwarded.body;
    if (config.silentEdit.enabled && forwarded.status === 200) {
      finalBody = await handleSilentEditResponse(forwarded.body);
    }

    const tokensOut = estimateOutputTokens(forwarded.body);
    await recordRequest({
      model: (pipelineResult.body as AnthropicRequest).model ?? 'unknown',
      tokensIn,
      tokensOut,
      costUsd: estimateCost((pipelineResult.body as AnthropicRequest).model ?? '', tokensIn, tokensOut),
      moduleActions: pipelineResult.moduleActions,
      cacheHit: false,
    });

    const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
    res.writeHead(forwarded.status, responseHeaders);
    res.end(finalBody);
  });

  server.listen(port, '127.0.0.1', () => {
    log(`TPT proxy listening on http://localhost:${port}`);
    vscode.commands.executeCommand('setContext', 'tpt.proxyActive', true);
  });
}

export function stopProxyServer(): void {
  server?.close(() => {
    log('TPT proxy stopped');
    vscode.commands.executeCommand('setContext', 'tpt.proxyActive', false);
  });
  server = undefined;
  activePort = undefined;
}

async function injectTerminalEnv(context: vscode.ExtensionContext, port: number): Promise<void> {
  // Persist terminal env injection so new terminals pick it up
  const cfg = vscode.workspace.getConfiguration();
  const proxyUrl = `http://localhost:${port}`;
  const token = sessionToken!;

  const envPatch = {
    ANTHROPIC_BASE_URL: proxyUrl,
    OPENAI_BASE_URL: `${proxyUrl}/v1`,
    TPT_TOKEN: token,
  };

  // Write to all three platform keys
  for (const key of ['terminal.integrated.env.windows', 'terminal.integrated.env.linux', 'terminal.integrated.env.osx']) {
    const current = cfg.get<Record<string, string>>(key, {});
    await cfg.update(key, { ...current, ...envPatch }, vscode.ConfigurationTarget.Workspace);
  }
}

function estimateOutputTokens(responseBody: string): number {
  try {
    const parsed = JSON.parse(responseBody);
    // Anthropic format
    if (parsed.usage?.output_tokens) return parsed.usage.output_tokens;
    // OpenAI format
    if (parsed.usage?.completion_tokens) return parsed.usage.completion_tokens;
  } catch { /* ignore */ }
  // Rough estimate: ~4 chars per token
  return Math.ceil(responseBody.length / 4);
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  // Very rough estimates — Router module refines these over time
  const m = model.toLowerCase();
  if (m.includes('claude-3-5-sonnet') || m.includes('claude-sonnet-4')) {
    return (tokensIn * 3 + tokensOut * 15) / 1_000_000;
  }
  if (m.includes('claude-haiku')) {
    return (tokensIn * 0.25 + tokensOut * 1.25) / 1_000_000;
  }
  if (m.includes('gpt-4o')) {
    return (tokensIn * 2.5 + tokensOut * 10) / 1_000_000;
  }
  if (m.includes('gpt-4o-mini')) {
    return (tokensIn * 0.15 + tokensOut * 0.6) / 1_000_000;
  }
  // Default: assume ~$3/$15 per million in/out
  return (tokensIn * 3 + tokensOut * 15) / 1_000_000;
}
