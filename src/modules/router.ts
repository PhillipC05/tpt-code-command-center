import { AnthropicRequest, ContentBlock, Message, OpenAIRequest } from '../proxy/types';
import { RouterRule, resolveUpstreamUrl, getConfig } from '../utils/config';

export interface RouteOverride {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

function estimateTokensInMessages(messages: Message[]): number {
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

function getLastUserContent(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const c = messages[i].content;
      return typeof c === 'string' ? c : JSON.stringify(c);
    }
  }
  return '';
}

function getExtensionsInMessages(messages: Message[]): string[] {
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

export function runRouter(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  rules: RouterRule[]
): RouteOverride | undefined {
  const messages = (body as AnthropicRequest).messages ?? [];
  const tokenCount = estimateTokensInMessages(messages);
  const userContent = getLastUserContent(messages);
  const extensions = getExtensionsInMessages(messages);

  for (const rule of rules) {
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
