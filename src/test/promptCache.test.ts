import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMistralCacheKey, runPromptCache } from '../modules/promptCache';
import { AnthropicRequest, OpenAIRequest } from '../proxy/types';

function makeBody(overrides: Partial<AnthropicRequest>): AnthropicRequest {
  return {
    model: 'claude-sonnet-5',
    messages: [],
    ...overrides,
  };
}

test('string system prompt is converted to array with cache_control on last block', () => {
  const result = runPromptCache(makeBody({ system: 'You are a helpful assistant.' }));
  assert.equal(result.breakpoints, 1);
  const system = result.body.system as { type: string; text: string; cache_control?: unknown }[];
  assert.ok(Array.isArray(system));
  assert.equal(system[0].text, 'You are a helpful assistant.');
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral' });
});

test('array system prompt gets cache_control added to its last block only', () => {
  const result = runPromptCache(
    makeBody({
      system: [
        { type: 'text', text: 'first block' },
        { type: 'text', text: 'second block' },
      ],
    })
  );
  assert.equal(result.breakpoints, 1);
  const system = result.body.system as { text: string; cache_control?: unknown }[];
  assert.equal(system[0].cache_control, undefined);
  assert.deepEqual(system[1].cache_control, { type: 'ephemeral' });
});

test('no system prompt means no system breakpoint', () => {
  const result = runPromptCache(makeBody({}));
  assert.equal(result.body.system, undefined);
});

test('fewer than two messages skips the history breakpoint', () => {
  const result = runPromptCache(makeBody({ messages: [{ role: 'user', content: 'hi' }] }));
  assert.equal(result.breakpoints, 0);
});

test('two or more messages adds cache_control to the second-to-last message', () => {
  const result = runPromptCache(
    makeBody({
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'turn 2' },
      ],
    })
  );
  assert.equal(result.breakpoints, 1);
  const msgs = result.body.messages;
  assert.equal(msgs[0].content, 'turn 1');
  const secondToLast = msgs[1].content as { text: string; cache_control?: unknown }[];
  assert.ok(Array.isArray(secondToLast));
  assert.equal(secondToLast[0].text, 'reply 1');
  assert.deepEqual(secondToLast[0].cache_control, { type: 'ephemeral' });
  // Newest message is untouched
  assert.equal(msgs[2].content, 'turn 2');
});

test('block-array message content gets cache_control on its last block only', () => {
  const result = runPromptCache(
    makeBody({
      messages: [
        { role: 'user', content: 'turn 1' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'part a' },
            { type: 'text', text: 'part b' },
          ],
        },
        { role: 'user', content: 'turn 2' },
      ],
    })
  );
  const secondToLast = result.body.messages[1].content as { text: string; cache_control?: unknown }[];
  assert.equal(secondToLast[0].cache_control, undefined);
  assert.deepEqual(secondToLast[1].cache_control, { type: 'ephemeral' });
});

test('system and message breakpoints both apply, up to two total', () => {
  const result = runPromptCache(
    makeBody({
      system: 'stable system prompt',
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'turn 2' },
      ],
    })
  );
  assert.equal(result.breakpoints, 2);
});

// ── runMistralCacheKey ────────────────────────────────────────────────────────

function makeOpenAIBody(overrides: Partial<OpenAIRequest>): OpenAIRequest {
  return { model: 'mistral-large-latest', messages: [], ...overrides };
}

test('mistral cache key: empty messages → not applied', () => {
  const result = runMistralCacheKey(makeOpenAIBody({}));
  assert.equal(result.applied, false);
  assert.equal(result.body.prompt_cache_key, undefined);
});

test('mistral cache key: derived from first non-system message and stable across turns', () => {
  const turn1 = runMistralCacheKey(
    makeOpenAIBody({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
    })
  );
  const turn2 = runMistralCacheKey(
    makeOpenAIBody({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'user', content: 'follow-up' },
      ],
    })
  );
  assert.ok(turn1.applied && turn2.applied);
  assert.equal(turn1.body.prompt_cache_key, turn2.body.prompt_cache_key);
});

test('mistral cache key: different first message produces a different key', () => {
  const a = runMistralCacheKey(makeOpenAIBody({ messages: [{ role: 'user', content: 'hello' }] }));
  const b = runMistralCacheKey(makeOpenAIBody({ messages: [{ role: 'user', content: 'goodbye' }] }));
  assert.notEqual(a.body.prompt_cache_key, b.body.prompt_cache_key);
});

test('original body is not mutated', () => {
  const original = makeBody({
    system: 'stable system prompt',
    messages: [
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'reply 1' },
    ],
  });
  const snapshot = JSON.stringify(original);
  runPromptCache(original);
  assert.equal(JSON.stringify(original), snapshot);
});
