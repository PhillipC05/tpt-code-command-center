import * as http from 'http';
import * as net from 'net';
import * as https from 'https';
import * as vscode from 'vscode';
import { getConfig, resolveUpstreamUrl } from '../utils/config';
import { log } from '../utils/logger';
import { runPipeline } from './pipeline';
import { recordRequest } from '../ledger/ledger';
import { storeCachedResponse } from '../modules/tokenShield';
import { handleSilentEditResponse, handleSilentEditStreamResponse } from '../modules/silentEdit';
import { AnthropicRequest, OpenAIRequest, ProxyRequest } from './types';
import { countTokens, getTodayCostUsd, getThisMonthCostUsd } from '../ledger/ledger';
import { getCostUsd, initPricing } from '../ledger/pricing';
import { captureRateLimitHeaders } from '../modules/quotaTracker';

const PREFERRED_PORT = 7331;

// Only forward a safe subset of upstream response headers to avoid header injection
// or leaking internal provider headers (set-cookie, x-internal-*, etc.)
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type', 'content-length', 'retry-after', 'x-request-id', 'date',
  // Anthropic rate-limit headers (requests + tokens)
  'anthropic-ratelimit-requests-limit', 'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-tokens-limit', 'anthropic-ratelimit-tokens-remaining',
  'anthropic-ratelimit-tokens-reset', 'anthropic-ratelimit-requests-reset',
  // OpenAI / xAI / compatible providers
  'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens',
]);

function filterResponseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SAFE_RESPONSE_HEADERS.has(k.toLowerCase()) && typeof v === 'string') {
      safe[k] = v;
    }
  }
  return safe;
}
let server: http.Server | undefined;
let activePort: number | undefined;
let sessionToken: string | undefined;
let serverState: 'starting' | 'running' | 'error' = 'starting';
let serverError: string | undefined;

export function getProxyUrl(): string | undefined {
  return activePort ? `http://localhost:${activePort}` : undefined;
}

export function getSessionToken(): string | undefined {
  return sessionToken;
}

export function getServerState(): { state: typeof serverState; error?: string } {
  return { state: serverState, error: serverError };
}

async function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', () => {
      findFreePort(start + 1).then(resolve, reject);
    });
  });
}

function detectFormat(path: string): 'anthropic' | 'openai' {
  if (path.startsWith('/v1/messages')) return 'anthropic';
  return 'openai';
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (c: Buffer) => {
      totalBytes += c.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendErrorJson(res: http.ServerResponse, status: number, message: string): void {
  if (!res.headersSent) {
    res.writeHead(status, { 'content-type': 'application/json' });
  }
  res.end(JSON.stringify({ error: message }));
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

// Forward a streaming request, piping SSE chunks directly to clientRes.
// Returns the full accumulated body text (for token counting) and status code.
// If the upstream returns a non-SSE error response it is buffered and forwarded as JSON.
function forwardStreamingRequest(
  targetUrl: string,
  apiKey: string,
  path: string,
  method: string,
  originalHeaders: http.IncomingHttpHeaders,
  body: string,
  _format: 'anthropic' | 'openai',
  upstreamProvider: string,
  clientRes: http.ServerResponse,
): Promise<{ accumulated: string; status: number }> {
  return new Promise((resolve) => {
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
    const outReq = proto.request(options, (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 500;
      const contentType = upstreamRes.headers['content-type'] ?? '';
      const isSSE = contentType.includes('text/event-stream');
      const chunks: Buffer[] = [];

      if (!isSSE || status !== 200) {
        // Non-streaming error — buffer and forward as JSON
        upstreamRes.on('data', (c: Buffer) => chunks.push(c));
        upstreamRes.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          if (!clientRes.headersSent) {
            clientRes.writeHead(status, { 'content-type': 'application/json' });
            clientRes.end(responseBody);
          }
          resolve({ accumulated: responseBody, status });
        });
        return;
      }

      // SSE — set streaming headers and pipe chunks through
      clientRes.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });

      upstreamRes.on('data', (chunk: Buffer) => {
        clientRes.write(chunk);
        chunks.push(chunk);
      });

      upstreamRes.on('end', () => {
        clientRes.end();
        resolve({ accumulated: Buffer.concat(chunks).toString('utf8'), status });
      });

      upstreamRes.on('error', () => {
        clientRes.end();
        resolve({ accumulated: Buffer.concat(chunks).toString('utf8'), status });
      });
    });

    outReq.on('error', (e) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'content-type': 'application/json' });
        clientRes.end(JSON.stringify({ error: `Upstream streaming error: ${e}` }));
      }
      resolve({ accumulated: '', status: 502 });
    });

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

  // Kick off non-blocking pricing fetch (uses cached data on subsequent activations)
  const initConfig = getConfig();
  initPricing(initConfig.openrouterApiKey).catch(() => { /* ignore network errors */ });

  await injectTerminalEnv(context, port);

  server = http.createServer(async (req, res) => {
    const config = getConfig();

    // Security: require session token on all requests
    const incomingToken = req.headers['x-tpt-token'] as string | undefined;
    if (incomingToken !== sessionToken) {
      sendErrorJson(res, 401,
        'Unauthorized: missing or invalid X-TPT-Token header. ' +
        'Run "TPT: Copy Proxy URL to Clipboard" to get your session token.');
      return;
    }

    // Hard budget stop — block request before any processing
    if (config.enabled && config.costBudget.hardStop) {
      if (config.costBudget.dailyLimitUsd > 0) {
        const spent = await getTodayCostUsd();
        if (spent >= config.costBudget.dailyLimitUsd) {
          sendErrorJson(res, 429,
            `TPT: Daily budget of $${config.costBudget.dailyLimitUsd.toFixed(2)} exceeded ` +
            `(spent $${spent.toFixed(4)} today). Increase tpt.costBudget.dailyLimitUsd or disable hardStop.`);
          return;
        }
      }
      if (config.costBudget.monthlyLimitUsd > 0) {
        const monthSpent = await getThisMonthCostUsd();
        if (monthSpent >= config.costBudget.monthlyLimitUsd) {
          sendErrorJson(res, 429,
            `TPT: Monthly budget of $${config.costBudget.monthlyLimitUsd.toFixed(2)} exceeded ` +
            `(spent $${monthSpent.toFixed(4)} this month). Increase tpt.costBudget.monthlyLimitUsd or disable hardStop.`);
          return;
        }
      }
    }

    // Bypass everything if master switch is off
    if (!config.enabled) {
      let rawBody: string;
      try {
        rawBody = await readBody(req);
      } catch (e) {
        sendErrorJson(res, 413, `${e}`);
        return;
      }
      const upstream = resolveUpstreamUrl(config);
      const format = detectFormat(req.url ?? '/');

      // Detect streaming to avoid buffering SSE responses
      let isStreamingBypass = false;
      try {
        isStreamingBypass = (JSON.parse(rawBody) as Record<string, unknown>).stream === true;
      } catch { /* non-JSON body */ }

      if (isStreamingBypass) {
        await forwardStreamingRequest(
          upstream.baseUrl, upstream.apiKey,
          req.url ?? '/', req.method ?? 'POST',
          req.headers, rawBody, format, config.upstreamProvider, res
        );
        return;
      }

      try {
        const forwarded = await forwardRequest(
          upstream.baseUrl, upstream.apiKey,
          req.url ?? '/', req.method ?? 'POST',
          req.headers, rawBody, format, config.upstreamProvider
        );
        captureRateLimitHeaders(forwarded.headers as Record<string, string>);
        res.writeHead(forwarded.status, filterResponseHeaders(forwarded.headers));
        res.end(forwarded.body);
      } catch (e) {
        sendErrorJson(res, 502, `Upstream request failed: ${e}`);
      }
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (e) {
      sendErrorJson(res, 413, `${e}`);
      return;
    }
    const format = detectFormat(req.url ?? '/');
    let parsedBody: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      sendErrorJson(res, 400, 'Invalid JSON body');
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
      sendErrorJson(res, 500, `TPT pipeline error: ${e}`);
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

    // Streaming path — pipe SSE chunks directly to the client
    const isStreaming = !!(pipelineResult.body as Record<string, unknown>).stream;
    if (isStreaming) {
      const upstream = pipelineResult.overrideUpstream ?? resolveUpstreamUrl(config);
      const outBody = JSON.stringify(pipelineResult.body);
      const tokensIn = countTokens(pipelineResult.body as AnthropicRequest | OpenAIRequest);
      try {
        const { accumulated, status } = await forwardStreamingRequest(
          upstream.baseUrl, upstream.apiKey,
          req.url ?? '/', req.method ?? 'POST',
          req.headers, outBody, format, config.upstreamProvider, res
        );
        if (status === 200) {
          const tokensOut = estimateStreamingTokensOut(accumulated, format);
          await recordRequest({
            model: (pipelineResult.body as AnthropicRequest).model ?? 'unknown',
            tokensIn,
            tokensOut,
            costUsd: getCostUsd((pipelineResult.body as AnthropicRequest).model ?? '', tokensIn, tokensOut),
            moduleActions: pipelineResult.moduleActions,
            cacheHit: false,
          });
          if (config.silentEdit.enabled) {
            await handleSilentEditStreamResponse(accumulated, format);
          }
          checkBudget().catch(() => { /* ignore */ });
        }
      } catch (e) {
        log(`Streaming upstream error: ${e}`);
        sendErrorJson(res, 502, `Upstream streaming failed: ${e}`);
      }
      return;
    }

    // Non-streaming path
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
      sendErrorJson(res, 502, `Upstream request failed: ${e}`);
      return;
    }

    // Store in Token Shield cache
    if (config.tokenShield.enabled && forwarded.status === 200 &&
        'messages' in pipelineResult.body && Array.isArray((pipelineResult.body as AnthropicRequest).messages)) {
      await storeCachedResponse(
        (pipelineResult.body as AnthropicRequest).messages,
        forwarded.body,
        config.tokenShield
      );
    }

    // Silent Edit response interception
    let finalBody = forwarded.body;
    if (config.silentEdit.enabled && forwarded.status === 200) {
      finalBody = await handleSilentEditResponse(forwarded.body);
    }

    const tokensOut = estimateOutputTokens(forwarded.body);
    await recordRequest({
      model: (pipelineResult.body as AnthropicRequest).model ?? 'unknown',
      tokensIn,
      tokensOut,
      costUsd: getCostUsd((pipelineResult.body as AnthropicRequest).model ?? '', tokensIn, tokensOut),
      moduleActions: pipelineResult.moduleActions,
      cacheHit: false,
    });
    checkBudget().catch(() => { /* ignore */ });
    captureRateLimitHeaders(forwarded.headers as Record<string, string>);

    res.writeHead(forwarded.status, { 'content-type': 'application/json' });
    res.end(finalBody);
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', (err: NodeJS.ErrnoException) => {
      serverState = 'error';
      serverError = err.message;
      activePort = undefined;
      reject(err);
    });
    server!.listen(port, '127.0.0.1', () => {
      serverState = 'running';
      log(`TPT proxy listening on http://localhost:${port}`);
      vscode.commands.executeCommand('setContext', 'tpt.proxyActive', true);
      resolve();
    });
  });
}

export function stopProxyServer(): void {
  server?.close(() => {
    log('TPT proxy stopped');
    vscode.commands.executeCommand('setContext', 'tpt.proxyActive', false);
  });
  server = undefined;
  activePort = undefined;
  serverState = 'starting';
  serverError = undefined;
}

async function injectTerminalEnv(context: vscode.ExtensionContext, port: number): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const proxyUrl = `http://localhost:${port}`;
  const token = sessionToken!;

  const envPatch = {
    ANTHROPIC_BASE_URL: proxyUrl,
    OPENAI_BASE_URL: `${proxyUrl}/v1`,
    TPT_TOKEN: token,
  };

  for (const key of ['terminal.integrated.env.windows', 'terminal.integrated.env.linux', 'terminal.integrated.env.osx']) {
    const current = cfg.get<Record<string, string>>(key, {});
    await cfg.update(key, { ...current, ...envPatch }, vscode.ConfigurationTarget.Workspace);
  }
}

function estimateOutputTokens(responseBody: string): number {
  try {
    const parsed = JSON.parse(responseBody);
    if (parsed.usage?.output_tokens) return parsed.usage.output_tokens;
    if (parsed.usage?.completion_tokens) return parsed.usage.completion_tokens;
  } catch { /* ignore */ }
  return Math.ceil(responseBody.length / 4);
}

// Extract output token count from an accumulated SSE stream body.
// Scans from the end to find the usage event (most providers emit it last).
function estimateStreamingTokensOut(sseBody: string, format: 'anthropic' | 'openai'): number {
  const lines = sseBody.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      // Anthropic: message_delta event carries output_tokens in usage
      if (format === 'anthropic' && parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
        return parsed.usage.output_tokens;
      }
      // OpenAI: some providers include usage in a final non-[DONE] chunk
      if (format === 'openai' && parsed.usage?.completion_tokens) {
        return parsed.usage.completion_tokens;
      }
    } catch { /* skip malformed event */ }
  }
  // Rough fallback: SSE overhead is significant so divide by more than plain JSON
  return Math.ceil(sseBody.length / 20);
}

let budgetAlertShownToday = '';

async function checkBudget(): Promise<void> {
  const cfg = getConfig();
  const limit = cfg.costBudget.dailyLimitUsd;
  if (!limit) return;

  const todayKey = new Date().toISOString().slice(0, 10);
  if (budgetAlertShownToday === todayKey) return;

  const spent = await getTodayCostUsd();
  if (spent >= limit) {
    budgetAlertShownToday = todayKey;
    vscode.window.showWarningMessage(
      `TPT: Daily spend limit of $${limit.toFixed(2)} reached — today's cost is $${spent.toFixed(4)}.`,
      'Open Dashboard'
    ).then((choice) => {
      if (choice === 'Open Dashboard') {
        vscode.commands.executeCommand('tpt.showDashboard');
      }
    });
  }
}

