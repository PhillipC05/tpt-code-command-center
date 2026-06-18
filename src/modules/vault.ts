import { AnthropicRequest, ContentBlock, Message, OpenAIRequest } from '../proxy/types';

// Prefixes of known secret formats are split across string literals so that
// GitHub secret scanning does not flag this source file as containing a leaked credential.
const p = (...parts: string[]) => new RegExp(parts.join(''), 'g');
const pi = (...parts: string[]) => new RegExp(parts.join(''), 'gi');

const BUILTIN_PATTERNS: RegExp[] = [
  // AWS access key ID / secret
  p('AK', 'IA[0-9A-Z]{16}'),
  pi('(?:aws[_\\-]?secret[_\\-]?(?:access[_\\-]?)?key|aws[_\\-]?access[_\\-]?key[_\\-]?id)', '\\s*[:=]\\s*["\']?([A-Za-z0-9/+=]{20,})'),
  // Stripe secret / restricted key
  /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
  /rk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
  // GitHub PAT (classic and fine-grained)
  p('gh', 'p_[A-Za-z0-9]{36,}'),
  p('github', '_pat_[A-Za-z0-9_]{82}'),
  // JWT (3-part base64url)
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Generic key=value patterns
  /(?:api[_\-]?key|api[_\-]?secret|access[_\-]?token|auth[_\-]?token|bearer)\s*[:=]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi,
  // Private IPs in URLs
  /https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/g,
  // .env style secrets
  /^(?:SECRET|PASSWORD|PASSWD|PWD|TOKEN|KEY|PRIVATE)[_A-Z]*\s*=\s*.+$/gm,
  // SSH / PEM private key header
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const REDACT_PLACEHOLDER = '[REDACTED]';

export interface VaultResult {
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  redacted: number;
}

export function runVault(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  customRegex: string[]
): VaultResult {
  const patterns = [...BUILTIN_PATTERNS];
  for (const pattern of customRegex) {
    try {
      patterns.push(new RegExp(pattern, 'g'));
    } catch {
      // Invalid regex — skip
    }
  }

  let count = 0;

  function redactText(text: string): string {
    let out = text;
    for (const re of patterns) {
      re.lastIndex = 0;
      const before = out;
      out = out.replace(re, REDACT_PLACEHOLDER);
      if (out !== before) count++;
    }
    return out;
  }

  function redactMessage(msg: Message): Message {
    if (typeof msg.content === 'string') {
      return { ...msg, content: redactText(msg.content) };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((block: ContentBlock) => {
          if (block.type === 'text' && typeof block.text === 'string') {
            return { ...block, text: redactText(block.text) };
          }
          if (block.type === 'tool_result') {
            // Tool results may contain file content
            const content = (block as Record<string, unknown>).content;
            if (typeof content === 'string') {
              return { ...block, content: redactText(content) };
            }
          }
          return block;
        }),
      };
    }
    return msg;
  }

  const b = body as AnthropicRequest | OpenAIRequest;
  let messages = b.messages ?? [];
  messages = messages.map(redactMessage);

  let result: AnthropicRequest | OpenAIRequest = { ...b, messages };

  // Redact system prompt
  if ('system' in result && result.system) {
    if (typeof result.system === 'string') {
      result = { ...result, system: redactText(result.system) };
    } else if (Array.isArray(result.system)) {
      result = {
        ...result,
        system: result.system.map((block) =>
          block.type === 'text' ? { ...block, text: redactText(block.text ?? '') } : block
        ),
      };
    }
  }

  return { body: result, redacted: count };
}
