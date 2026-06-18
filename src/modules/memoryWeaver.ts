import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as vscode from 'vscode';
import { Message } from '../proxy/types';
import { getConfig, resolveUpstreamUrl } from '../utils/config';
import { log } from '../utils/logger';

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null && 'text' in block) {
          chars += String((block as Record<string, unknown>).text ?? '').length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

function extractiveSummarise(messages: Message[], threshold: number): Message[] {
  // Keep system messages and last N messages that fit within threshold
  const system = messages.filter((m) => m.role === 'system');
  const conversation = messages.filter((m) => m.role !== 'system');

  let kept: Message[] = [];
  let chars = 0;
  const maxChars = threshold * 4 * 0.6; // keep 60% of threshold

  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    const len = typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;
    if (chars + len > maxChars) break;
    kept.unshift(msg);
    chars += len;
  }

  if (kept.length < conversation.length) {
    const summary: Message = {
      role: 'user',
      content: `[TPT Memory Weaver: ${conversation.length - kept.length} earlier messages were summarised to reduce context size. The most recent ${kept.length} messages follow.]`,
    };
    kept = [summary, ...kept];
  }

  return [...system, ...kept];
}

async function summariseViaOllama(messages: Message[], ollamaModel: string): Promise<string | null> {
  return new Promise((resolve) => {
    const conversation = messages.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n');
    const prompt = `Summarise the following conversation history concisely, preserving key decisions, code, and context:\n\n${conversation}`;
    const body = JSON.stringify({ model: ollamaModel, prompt, stream: false });

    const req = http.request(
      { hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString());
            resolve(parsed.response ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function summariseViaProxy(messages: Message[], options: MemoryWeaverOptions): Promise<string | null> {
  const config = getConfig();
  const upstream = resolveUpstreamUrl(config);
  if (!upstream.apiKey && config.upstreamProvider !== 'local') return null;

  const https = require('https') as typeof import('https');
  const http = require('http') as typeof import('http');

  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n');

  const summaryRequest = {
    model: config.upstreamProvider === 'anthropic' ? options.anthropicSummaryModel : options.openaiSummaryModel,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Summarise this conversation history in 3-5 bullet points, focusing on key decisions, code changes, and important context:\n\n${conversation.substring(0, 8000)}`,
      },
    ],
  };

  return new Promise((resolve) => {
    const url = new URL(upstream.baseUrl);
    const apiPath = config.upstreamProvider === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    const body = JSON.stringify(summaryRequest);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    };
    if (upstream.apiKey) {
      if (config.upstreamProvider === 'anthropic') {
        headers['x-api-key'] = upstream.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['authorization'] = `Bearer ${upstream.apiKey}`;
      }
    }

    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.request(
      { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: apiPath, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString());
            const text = parsed.content?.[0]?.text ?? parsed.choices?.[0]?.message?.content ?? null;
            resolve(text);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function saveMemory(summary: string): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;
  const dir = path.join(folders[0].uri.fsPath, '.tpt');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const memPath = path.join(dir, 'memory.json');
  const existing = fs.existsSync(memPath) ? JSON.parse(fs.readFileSync(memPath, 'utf8')) : { summaries: [] };
  existing.summaries.push({ ts: Date.now(), summary });
  if (existing.summaries.length > 10) existing.summaries = existing.summaries.slice(-10);
  fs.writeFileSync(memPath, JSON.stringify(existing, null, 2));
}

export interface MemoryWeaverOptions {
  tokenThreshold: number;
  fallbackOrder: string[];
  anthropicSummaryModel: string;
  openaiSummaryModel: string;
  ollamaModel: string;
}

export interface MemoryWeaverResult {
  messages: Message[];
  summarised: boolean;
}

export async function runMemoryWeaver(
  messages: Message[],
  options: MemoryWeaverOptions
): Promise<MemoryWeaverResult> {
  const tokenCount = estimateTokens(messages);
  if (tokenCount <= options.tokenThreshold) {
    return { messages, summarised: false };
  }

  log(`Memory Weaver triggered — estimated ${tokenCount} tokens (threshold: ${options.tokenThreshold})`);

  for (const backend of options.fallbackOrder) {
    if (backend === 'ollama') {
      const summary = await summariseViaOllama(messages, options.ollamaModel);
      if (summary) {
        saveMemory(summary);
        const system = messages.filter((m) => m.role === 'system');
        const last = messages.filter((m) => m.role !== 'system').slice(-4);
        const summaryMsg: Message = { role: 'user', content: `[Memory Weaver Summary]\n${summary}` };
        log('Memory Weaver: summarised via Ollama');
        return { messages: [...system, summaryMsg, ...last], summarised: true };
      }
    } else if (backend === 'proxy') {
      const summary = await summariseViaProxy(messages, options);
      if (summary) {
        saveMemory(summary);
        const system = messages.filter((m) => m.role === 'system');
        const last = messages.filter((m) => m.role !== 'system').slice(-4);
        const summaryMsg: Message = { role: 'user', content: `[Memory Weaver Summary]\n${summary}` };
        log('Memory Weaver: summarised via proxy LLM');
        return { messages: [...system, summaryMsg, ...last], summarised: true };
      }
    } else if (backend === 'extractive') {
      const trimmed = extractiveSummarise(messages, options.tokenThreshold);
      log('Memory Weaver: applied extractive summarisation');
      return { messages: trimmed, summarised: true };
    }
  }

  return { messages, summarised: false };
}
