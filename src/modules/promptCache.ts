import { AnthropicRequest, ContentBlock, Message, OpenAIRequest, SystemBlock } from '../proxy/types';
import { hashString } from '../utils/hash';

const CACHE_CONTROL: { type: 'ephemeral' } = { type: 'ephemeral' };

export interface PromptCacheResult {
  body: AnthropicRequest;
  breakpoints: number;
}

// Marks the last block of the system prompt and the last block of the
// second-to-last message as cacheable, so Anthropic's native prompt caching
// discounts the stable prefix on every turn after the first. Below-minimum-length
// blocks are silently ignored by the API, so no token-count gating is needed here.
export function runPromptCache(body: AnthropicRequest): PromptCacheResult {
  let breakpoints = 0;
  let result = body;

  if (body.system) {
    const systemBlocks: SystemBlock[] =
      typeof body.system === 'string' ? [{ type: 'text', text: body.system }] : [...body.system];
    const lastIdx = systemBlocks.length - 1;
    if (lastIdx >= 0) {
      systemBlocks[lastIdx] = { ...systemBlocks[lastIdx], cache_control: CACHE_CONTROL };
      result = { ...result, system: systemBlocks };
      breakpoints++;
    }
  }

  if (Array.isArray(body.messages) && body.messages.length >= 2) {
    const targetIdx = body.messages.length - 2;
    const target = body.messages[targetIdx];
    const blocks: ContentBlock[] =
      typeof target.content === 'string' ? [{ type: 'text', text: target.content }] : [...target.content];
    const lastIdx = blocks.length - 1;
    if (lastIdx >= 0) {
      blocks[lastIdx] = { ...blocks[lastIdx], cache_control: CACHE_CONTROL };
      const messages: Message[] = [...result.messages];
      messages[targetIdx] = { ...target, content: blocks };
      result = { ...result, messages };
      breakpoints++;
    }
  }

  return { body: result, breakpoints };
}

export interface MistralCacheKeyResult {
  body: OpenAIRequest;
  applied: boolean;
}

// Mistral has no automatic caching — it requires a stable `prompt_cache_key` on
// requests that share a prefix. Derived from the first non-system message so it
// stays the same across turns of the same conversation.
export function runMistralCacheKey(body: OpenAIRequest): MistralCacheKeyResult {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { body, applied: false };
  }
  const first = body.messages.find((m) => m.role !== 'system') ?? body.messages[0];
  const key = `tpt-${hashString(JSON.stringify(first.content)).slice(0, 32)}`;
  return { body: { ...body, prompt_cache_key: key }, applied: true };
}
