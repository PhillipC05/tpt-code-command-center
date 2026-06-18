import { AnthropicRequest, ContentBlock, Message, OpenAIRequest } from '../proxy/types';
import { RouterRule, resolveUpstreamUrl, getConfig } from '../utils/config';

export interface RouteOverride {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export function estimateTokensInMessages(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') chars += msg.content.length;
    else if (Array.isArray(msg.content)) {
      for (const b of msg.content as ContentBlock[]) {
        if (b.type === 'text' && typeof b.text === 'string') chars += b.text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

export function getLastUserContent(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const c = messages[i].content;
      return typeof c === 'string' ? c : JSON.stringify(c);
    }
  }
  return '';
}

export function getExtensionsInMessages(messages: Message[]): string[] {
  const exts = new Set<string>();
  const re = /\.([a-zA-Z0-9]+)(?:\s|"|'|`|$)/g;
  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      exts.add(m[1].toLowerCase());
    }
  }
  return [...exts];
}

// Sensible defaults used when the router is enabled but the user has no custom rules.
export const BUILTIN_ROUTER_RULES: RouterRule[] = [
  // Short prompts don't need a frontier model — route to a cheaper fast model
  { match: { maxTokens: 2000 }, model: 'openai/gpt-4o-mini', provider: 'openrouter' },
  // Code-heavy contexts — route to a capable coding model
  {
    match: { extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'cs'] },
    model: 'openai/gpt-4o',
    provider: 'openrouter',
  },
];

export function runRouter(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  rules: RouterRule[]
): RouteOverride | undefined {
  const messages = (body as AnthropicRequest).messages ?? [];
  const tokenCount = estimateTokensInMessages(messages);
  const userContent = getLastUserContent(messages);
  const extensions = getExtensionsInMessages(messages);

  // Use built-in defaults when the user hasn't configured any rules
  const effectiveRules = rules.length > 0 ? rules : BUILTIN_ROUTER_RULES;

  for (const rule of effectiveRules) {
    const { match, model, provider } = rule;
    let matched = true;

    if (match.maxTokens !== undefined && tokenCount > match.maxTokens) {
      matched = false;
    }
    if (matched && match.keywords?.length) {
      const lc = userContent.toLowerCase();
      matched = match.keywords.some((kw) => lc.includes(kw.toLowerCase()));
    }
    if (matched && match.extensions?.length) {
      matched = match.extensions.some((ext) => extensions.includes(ext.toLowerCase()));
    }

    if (matched) {
      const config = getConfig();
      // Resolve provider config
      const overrideConfig = { ...config, upstreamProvider: provider as typeof config.upstreamProvider };
      const { baseUrl, apiKey } = resolveUpstreamUrl(overrideConfig);
      return { baseUrl, apiKey, model };
    }
  }

  return undefined;
}
