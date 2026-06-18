import { AnthropicRequest, OpenAIRequest } from '../proxy/types';

export interface InspectSnapshot {
  timestamp: number;
  format: 'anthropic' | 'openai';
  originalBody: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  processedBody: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  moduleActions: string[];
  overrideUpstream?: { baseUrl: string; apiKey: string; model?: string };
  cacheHit: boolean;
}

let lastSnapshot: InspectSnapshot | undefined;

export function storeInspectSnapshot(snapshot: InspectSnapshot): void {
  lastSnapshot = snapshot;
}

export function getLastInspectSnapshot(): InspectSnapshot | undefined {
  return lastSnapshot;
}
