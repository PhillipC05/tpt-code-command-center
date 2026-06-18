import * as crypto from 'crypto';

/**
 * Normalises a prompt string for cache key generation:
 * strips model-specific fields, collapses whitespace, lowercases.
 */
export function hashPrompt(messages: unknown[]): string {
  const normalised = JSON.stringify(messages)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
