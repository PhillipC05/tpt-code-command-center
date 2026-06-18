import * as https from 'https';
import * as http from 'http';
import { TptConfig } from '../utils/config';

export interface QuotaSnapshot {
  provider: string;
  // Active-poll fields (OpenRouter, DeepSeek)
  creditsTotal?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  // Passive rate-limit header fields (Anthropic, OpenAI, Grok, etc.)
  rateLimitTokensRemaining?: number;
  rateLimitTokensReset?: string;
  rateLimitRequestsRemaining?: number;
  lastUpdated: number;
}

let snapshot: QuotaSnapshot | undefined;
let pollTimer: NodeJS.Timeout | undefined;

// Idle detection: skip balance API calls when no proxy traffic for this long
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
let lastActivityTs = 0;

export function recordActivity(): void {
  lastActivityTs = Date.now();
}

export function getQuotaSnapshot(): QuotaSnapshot | undefined {
  return snapshot;
}

// Called after every proxied response to capture rate-limit headers passively
export function captureRateLimitHeaders(headers: Record<string, string>): void {
  recordActivity(); // any forwarded response means the user is actively working
  const tokensRemaining =
    headers['anthropic-ratelimit-tokens-remaining'] ??
    headers['x-ratelimit-remaining-tokens'];
  const tokensReset =
    headers['anthropic-ratelimit-tokens-reset'] ??
    headers['x-ratelimit-reset-tokens'];
  const requestsRemaining =
    headers['anthropic-ratelimit-requests-remaining'] ??
    headers['x-ratelimit-remaining-requests'];

  if (!tokensRemaining && !requestsRemaining) return;

  snapshot = {
    ...(snapshot ?? { provider: 'unknown' }),
    ...(tokensRemaining !== undefined ? { rateLimitTokensRemaining: Number(tokensRemaining) } : {}),
    ...(tokensReset !== undefined ? { rateLimitTokensReset: tokensReset } : {}),
    ...(requestsRemaining !== undefined ? { rateLimitRequestsRemaining: Number(requestsRemaining) } : {}),
    lastUpdated: Date.now(),
  };
}

export function startQuotaPolling(config: TptConfig): void {
  stopQuotaPolling();
  const intervalMs = config.costBudget.quotaPollingIntervalSec * 1000;
  if (intervalMs <= 0) return;

  // Set provider immediately so passive capture has context
  snapshot = snapshot
    ? { ...snapshot, provider: config.upstreamProvider }
    : { provider: config.upstreamProvider, lastUpdated: 0 };

  // Treat startup as activity so the first poll always fires
  recordActivity();

  const tick = async () => {
    // Only hit the balance API when there has been recent proxy traffic
    if (Date.now() - lastActivityTs < IDLE_THRESHOLD_MS) {
      await fetchBalance(config);
    }
    // Always reschedule — resumes fetching automatically when activity returns
    pollTimer = setTimeout(tick, intervalMs);
  };

  tick();
}

export function stopQuotaPolling(): void {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = undefined; }
}

async function fetchBalance(config: TptConfig): Promise<void> {
  try {
    if (config.upstreamProvider === 'openrouter' && config.openrouterApiKey) {
      await fetchOpenRouterBalance(config.openrouterApiKey);
    } else if (config.upstreamProvider === 'deepseek' && config.deepseekApiKey) {
      await fetchDeepSeekBalance(config.deepseekApiKey);
    }
    // Other providers: passive header capture only — no balance endpoint
  } catch {
    // Non-fatal — quota panel just won't update until next tick
  }
}

function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const proto = parsed.protocol === 'https:' ? https : http;
    const req = proto.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function fetchOpenRouterBalance(apiKey: string): Promise<void> {
  const body = await httpsGet('https://openrouter.ai/api/v1/credits', {
    'authorization': `Bearer ${apiKey}`,
  });
  const json = JSON.parse(body) as { data?: { total_credits?: number; usage?: number } };
  const total = json.data?.total_credits;
  const used = json.data?.usage;
  if (total === undefined) return;
  snapshot = {
    provider: 'openrouter',
    creditsTotal: total,
    creditsUsed: used ?? 0,
    creditsRemaining: total - (used ?? 0),
    lastUpdated: Date.now(),
  };
}

async function fetchDeepSeekBalance(apiKey: string): Promise<void> {
  const body = await httpsGet('https://api.deepseek.com/v1/user/balance', {
    'authorization': `Bearer ${apiKey}`,
  });
  const json = JSON.parse(body) as {
    balance?: { total_balance?: string; granted_balance?: string; topped_up_balance?: string };
  };
  const total = parseFloat(json.balance?.total_balance ?? '0');
  if (isNaN(total)) return;
  snapshot = {
    provider: 'deepseek',
    creditsTotal: total,
    creditsRemaining: total,
    lastUpdated: Date.now(),
  };
}
