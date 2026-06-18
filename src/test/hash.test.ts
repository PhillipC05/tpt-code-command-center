import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPrompt, hashString } from '../utils/hash';

test('hashPrompt: identical messages produce identical hash', () => {
  const msgs = [{ role: 'user', content: 'hello' }];
  assert.equal(hashPrompt(msgs), hashPrompt(msgs));
});

test('hashPrompt: different content produces different hash', () => {
  const a = [{ role: 'user', content: 'hello' }];
  const b = [{ role: 'user', content: 'world' }];
  assert.notEqual(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: whitespace is normalised (extra spaces collapse)', () => {
  const a = [{ role: 'user', content: 'hello   world' }];
  const b = [{ role: 'user', content: 'hello world' }];
  assert.equal(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: comparison is case-insensitive', () => {
  const a = [{ role: 'user', content: 'Hello World' }];
  const b = [{ role: 'user', content: 'hello world' }];
  assert.equal(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: multiple spaces in content normalise to single space', () => {
  // hashPrompt collapses whitespace in the JSON-serialised form.
  // Space characters in content are literal spaces in JSON, so they ARE collapsed.
  // Note: \t/\n inside content values get JSON-escaped to \\t/\\n sequences
  // (i.e. the two-char literal backslash+letter), which are NOT matched by /\s+/,
  // so tabs/newlines in content do NOT normalise to spaces — that is expected behaviour.
  const a = [{ role: 'user', content: 'foo   bar   baz' }];
  const b = [{ role: 'user', content: 'foo bar baz' }];
  assert.equal(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: returns 64-character lowercase hex string', () => {
  const h = hashPrompt([{ role: 'user', content: 'test' }]);
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]+$/);
});

test('hashString: same input → same output', () => {
  assert.equal(hashString('hello'), hashString('hello'));
});

test('hashString: different input → different output', () => {
  assert.notEqual(hashString('hello'), hashString('hello!'));
});

test('hashString: returns 64-character lowercase hex string', () => {
  const h = hashString('any string');
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]+$/);
});

test('hashString: empty string produces a valid hash (not an error)', () => {
  assert.doesNotThrow(() => {
    const h = hashString('');
    assert.equal(h.length, 64);
  });
});
