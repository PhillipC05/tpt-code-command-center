import { getConfig } from '../utils/config';
import { log } from '../utils/logger';
import { AnthropicRequest, OpenAIRequest, ProxyRequest } from './types';
import { runVault } from '../modules/vault';
import { runSmartContext } from '../modules/smartContext';
import { runTokenShield } from '../modules/tokenShield';
import { runMemoryWeaver } from '../modules/memoryWeaver';
import { runRouter } from '../modules/router';
import { runSilentEditInjection } from '../modules/silentEdit';

export interface PipelineResult {
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  overrideUpstream?: { baseUrl: string; apiKey: string; model?: string };
  cachedResponse?: string;
  moduleActions: string[];
}

export async function runPipeline(req: ProxyRequest): Promise<PipelineResult> {
  const config = getConfig();
  const actions: string[] = [];
  let body = req.body as AnthropicRequest | OpenAIRequest;

  if (config.terminal.verboseLogging) {
    log(`Pipeline start — path=${req.path} format=${req.format}`, true);
  }

  // 1. Vault: redact secrets before anything else sees the content
  if (config.vault.enabled) {
    const result = runVault(body, config.vault.customRegex);
    body = result.body as AnthropicRequest | OpenAIRequest;
    if (result.redacted > 0) {
      actions.push(`vault:redacted=${result.redacted}`);
      log(`Vault redacted ${result.redacted} secret(s)`);
    }
  }

  // 2. Token Shield: check cache before hitting upstream (skip for streaming — cached responses
  //    are buffered JSON, not SSE, so returning one to a streaming client would break the protocol)
  const isStreaming = !!(body as Record<string, unknown>).stream;
  if (config.tokenShield.enabled && !isStreaming && 'messages' in body && Array.isArray(body.messages)) {
    const cached = await runTokenShield(body.messages);
    if (cached) {
      actions.push('tokenShield:hit');
      log('Token Shield cache hit — skipping upstream');
      return { body, cachedResponse: cached, moduleActions: actions };
    }
  }

  // 3. Memory Weaver: summarise if conversation is too long
  if (config.memoryWeaver.enabled && 'messages' in body && Array.isArray(body.messages)) {
    const result = await runMemoryWeaver(body.messages, config.memoryWeaver);
    if (result.summarised) {
      body = { ...body, messages: result.messages };
      actions.push(`memoryWeaver:summarised`);
    }
  }

  // 4. Smart Context: replace file content with AST outlines in tool results
  if (config.smartContext.enabled && 'messages' in body && Array.isArray(body.messages)) {
    const result = await runSmartContext(body.messages, config.smartContext.maxFileSize);
    if (result.replaced > 0) {
      body = { ...body, messages: result.messages };
      actions.push(`smartContext:replaced=${result.replaced}`);
    }
  }

  // 5. Silent Edit: prepend schema instructions to system prompt
  if (config.silentEdit.enabled) {
    body = runSilentEditInjection(body, req.format) as AnthropicRequest | OpenAIRequest;
    actions.push('silentEdit:injected');
  }

  // 6. Router: rewrite model/provider based on heuristics
  let overrideUpstream: PipelineResult['overrideUpstream'];
  if (config.router.enabled) {
    const routeResult = runRouter(body, config.router.rules);
    if (routeResult) {
      overrideUpstream = routeResult;
      actions.push(`router:${routeResult.model}@${routeResult.baseUrl}`);
    }
  }

  if (config.terminal.verboseLogging) {
    log(`Pipeline complete — actions=[${actions.join(', ')}]`, true);
  }

  return { body, overrideUpstream, moduleActions: actions };
}
