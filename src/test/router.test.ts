import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokensInMessages,
  getLastUserContent,
  getExtensionsInMessages,
} from '../modules/router';
import { Message } from '../proxy/types';

// ── estimateTokensInMessages ──────────────────────────────────────────────────

test('estimateTokensInMessages: empty array → 0', () => {
  assert.equal(estimateTokensInMessages([]), 0);
});

test('estimateTokensInMessages: string content counts chars / 4', () => {
  const msgs: Message[] = [{ role: 'user', content: 'abcd' }]; // 4 chars → 1 token
  assert.equal(estimateTokensInMessages(msgs), 1);
});

test('estimateTokensInMessages: block-array content sums text blocks', () => {
  const msgs: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'abcd' },
        { type: 'image' },             // non-text block — ignored
        { type: 'text', text: 'efgh' },
      ],
    },
  ];
  // 8 chars → ceil(8/4) = 2
  assert.equal(estimateTokensInMessages(msgs), 2);
});

test('estimateTokensInMessages: multiple messages are summed', () => {
  const msgs: Message[] = [
    { role: 'user', content: 'aaaa' },      // 4 chars
    { role: 'assistant', content: 'bbbb' }, // 4 chars
  ];
  assert.equal(estimateTokensInMessages(msgs), 2);
});

// ── getLastUserContent ────────────────────────────────────────────────────────

test('getLastUserContent: returns last user message text', () => {
  const msgs: Message[] = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'last user message' },
  ];
  assert.equal(getLastUserContent(msgs), 'last user message');
});

test('getLastUserContent: no user message → empty string', () => {
  const msgs: Message[] = [{ role: 'assistant', content: 'hi' }];
  assert.equal(getLastUserContent(msgs), '');
});

test('getLastUserContent: empty array → empty string', () => {
  assert.equal(getLastUserContent([]), '');
});

// ── getExtensionsInMessages ───────────────────────────────────────────────────

test('getExtensionsInMessages: extracts file extensions', () => {
  const msgs: Message[] = [{ role: 'user', content: 'editing src/index.ts and utils.py' }];
  const exts = getExtensionsInMessages(msgs);
  assert.ok(exts.includes('ts'));
  assert.ok(exts.includes('py'));
});

test('getExtensionsInMessages: de-duplicates extensions', () => {
  const msgs: Message[] = [{ role: 'user', content: 'a.ts b.ts c.ts' }];
  const exts = getExtensionsInMessages(msgs);
  assert.equal(exts.filter((e) => e === 'ts').length, 1);
});

test('getExtensionsInMessages: extensions are lowercased', () => {
  const msgs: Message[] = [{ role: 'user', content: 'file.TS' }];
  const exts = getExtensionsInMessages(msgs);
  assert.ok(exts.includes('ts'));
});

test('getExtensionsInMessages: empty messages → empty array', () => {
  assert.deepEqual(getExtensionsInMessages([]), []);
});
