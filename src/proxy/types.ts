export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  format: 'anthropic' | 'openai';
  sessionToken: string;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  tokensIn: number;
  tokensOut: number;
  cacheHit: boolean;
  moduleActions: string[];
}

// Anthropic Messages API shape (simplified)
export interface AnthropicRequest {
  model: string;
  messages: Message[];
  system?: string | SystemBlock[];
  max_tokens?: number;
  tools?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface SystemBlock {
  type: 'text';
  text: string;
}

// OpenAI Chat Completions shape (simplified)
export interface OpenAIRequest {
  model: string;
  messages: Message[];
  max_tokens?: number;
  tools?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}
