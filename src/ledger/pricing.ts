/**
 * Live model pricing from OpenRouter API.
 * Fetched once per day and cached in .tpt/pricing.json.
 * Falls back to a built-in table when offline or the API is unreachable.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as vscode from 'vscode';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface PriceEntry {
  promptPer1M: number;   // USD per 1 million input tokens
  completionPer1M: number; // USD per 1 million output tokens
  fetchedAt: number;
}

let priceCache: Map<string, PriceEntry> = new Map();
let lastFetchAttempt = 0;
let fetchedAt = 0;

// Built-in fallback prices (USD per 1M tokens). Kept up-to-date manually.
const BUILTIN_PRICES: Record<string, { promptPer1M: number; completionPer1M: number }> = {
  'anthropic/claude-sonnet-4':        { promptPer1M: 3,     completionPer1M: 15 },
  'anthropic/claude-opus-4':          { promptPer1M: 15,    completionPer1M: 75 },
  'anthropic/claude-haiku-4-5':       { promptPer1M: 0.8,   completionPer1M: 4 },
  'anthropic/claude-3-5-sonnet':      { promptPer1M: 3,     completionPer1M: 15 },
  'anthropic/claude-3-haiku':         { promptPer1M: 0.25,  completionPer1M: 1.25 },
  'openai/gpt-4o':                    { promptPer1M: 2.5,   completionPer1M: 10 },
  'openai/gpt-4o-mini':               { promptPer1M: 0.15,  completionPer1M: 0.6 },
  'openai/o1':                        { promptPer1M: 15,    completionPer1M: 60 },
  'openai/o1-mini':                   { promptPer1M: 1.1,   completionPer1M: 4.4 },
  'openai/o3-mini':                   { promptPer1M: 1.1,   completionPer1M: 4.4 },
  'deepseek/deepseek-chat':           { promptPer1M: 0.27,  completionPer1M: 1.1 },
  'deepseek/deepseek-r1':             { promptPer1M: 0.55,  completionPer1M: 2.19 },
  'x-ai/grok-3':                      { promptPer1M: 3,     completionPer1M: 15 },
  'x-ai/grok-3-mini':                 { promptPer1M: 0.3,   completionPer1M: 0.5 },
  'qwen/qwq-32b':                     { promptPer1M: 0.4,   completionPer1M: 1.2 },
  'moonshotai/moonshot-v1-8k':        { promptPer1M: 1.0,   completionPer1M: 3.0 },
};

// Fuzzy lookup: match model string against price table keys
function lookupPrice(model: string): { promptPer1M: number; completionPer1M: number } | undefined {
  const m = model.toLowerCase();

  // Exact cache hit
  const exact = priceCache.get(m);
  if (exact) return exact;

  // Prefix / substring match in live cache
  for (const [key, entry] of priceCache) {
    if (m.includes(key) || key.includes(m)) return entry;
  }

  // Exact builtin
  if (BUILTIN_PRICES[m]) return BUILTIN_PRICES[m];

  // Fuzzy builtin
  for (const [key, entry] of Object.entries(BUILTIN_PRICES)) {
    if (m.includes(key.split('/').pop()!) || key.split('/').pop()!.includes(m.split('/').pop() ?? m)) {
      return entry;
    }
  }

  // Last-resort heuristics
  if (m.includes('claude-haiku')) return { promptPer1M: 0.8,  completionPer1M: 4 };
  if (m.includes('claude-sonnet') || m.includes('claude-3-5')) return { promptPer1M: 3, completionPer1M: 15 };
  if (m.includes('claude-opus')) return { promptPer1M: 15,   completionPer1M: 75 };
  if (m.includes('gpt-4o-mini')) return { promptPer1M: 0.15, completionPer1M: 0.6 };
  if (m.includes('gpt-4o'))      return { promptPer1M: 2.5,  completionPer1M: 10 };
  if (m.includes('deepseek-r1')) return { promptPer1M: 0.55, completionPer1M: 2.19 };
  if (m.includes('deepseek'))    return { promptPer1M: 0.27, completionPer1M: 1.1 };
  if (m.includes('grok-3-mini')) return { promptPer1M: 0.3,  completionPer1M: 0.5 };
  if (m.includes('grok'))        return { promptPer1M: 3,    completionPer1M: 15 };
  if (m.includes('qwen') || m.includes('qwq')) return { promptPer1M: 0.4, completionPer1M: 1.2 };
  if (m.includes('moonshot') || m.includes('kimi')) return { promptPer1M: 1.0, completionPer1M: 3.0 };

  return { promptPer1M: 3, completionPer1M: 15 }; // safe default
}

export function getCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = lookupPrice(model);
  if (!price) return 0;
  return (tokensIn * price.promptPer1M + tokensOut * price.completionPer1M) / 1_000_000;
}

// ── fetching and caching ──────────────────────────────────────────────────────

function getCacheDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const dir = path.join(folders[0].uri.fsPath, '.tpt');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface PricingJson {
  fetchedAt: number;
  prices: Record<string, { promptPer1M: number; completionPer1M: number }>;
}

function loadCachedPrices(): void {
  const dir = getCacheDir();
  if (!dir) return;
  const cachePath = path.join(dir, 'pricing.json');
  if (!fs.existsSync(cachePath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as PricingJson;
    if (!data.fetchedAt || !data.prices) return;
    fetchedAt = data.fetchedAt;
    priceCache = new Map(
      Object.entries(data.prices).map(([k, v]) => [k, { ...v, fetchedAt: data.fetchedAt }])
    );
  } catch { /* corrupt cache — ignore */ }
}

function saveCachedPrices(): void {
  const dir = getCacheDir();
  if (!dir) return;
  const prices: Record<string, { promptPer1M: number; completionPer1M: number }> = {};
  for (const [k, v] of priceCache) {
    prices[k] = { promptPer1M: v.promptPer1M, completionPer1M: v.completionPer1M };
  }
  const data: PricingJson = { fetchedAt: Date.now(), prices };
  try {
    fs.writeFileSync(path.join(dir, 'pricing.json'), JSON.stringify(data, null, 2));
  } catch { /* ignore write errors */ }
}

function fetchOpenRouterPrices(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: 'openrouter.ai',
      path: '/api/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'user-agent': 'tpt-code-command-center/0.1.0',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) { resolve(); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            data?: { id: string; pricing?: { prompt: string; completion: string } }[]
          };
          for (const model of body.data ?? []) {
            if (!model.pricing) continue;
            const promptPer1M   = parseFloat(model.pricing.prompt)     * 1_000_000;
            const completionPer1M = parseFloat(model.pricing.completion) * 1_000_000;
            if (!isNaN(promptPer1M) && !isNaN(completionPer1M)) {
              priceCache.set(model.id.toLowerCase(), { promptPer1M, completionPer1M, fetchedAt: Date.now() });
            }
          }
          fetchedAt = Date.now();
          saveCachedPrices();
        } catch { /* ignore parse errors */ }
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

/** Called once on activation, then automatically refreshes every 24 h. */
export async function initPricing(openrouterApiKey: string): Promise<void> {
  loadCachedPrices();

  const now = Date.now();
  if (fetchedAt && now - fetchedAt < CACHE_TTL_MS) return; // cache is fresh
  if (now - lastFetchAttempt < 60_000) return; // don't hammer on failures

  lastFetchAttempt = now;
  if (openrouterApiKey) {
    await fetchOpenRouterPrices(openrouterApiKey);
  }
}

/** Returns today's total spend from the in-memory ledger snapshot (USD). */
export function getDailySpendUsd(costUsdToday: number): number {
  return costUsdToday;
}
