import { ContentBlock, Message } from '../proxy/types';

// web-tree-sitter is loaded lazily — types kept as any to avoid version-skew issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Parser: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parsersCache = new Map<string, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getParser(language: string): Promise<any | undefined> {
  if (parsersCache.has(language)) return parsersCache.get(language);

  try {
    if (!Parser) {
      Parser = require('web-tree-sitter');
      await Parser.init();
    }
    const langName = languageToWasm(language);
    if (!langName) return undefined;

    const langModule = await Parser.Language.load(langName);
    const parser = new Parser();
    parser.setLanguage(langModule);
    parsersCache.set(language, parser);
    return parser;
  } catch {
    return undefined;
  }
}

function languageToWasm(ext: string): string | undefined {
  const map: Record<string, string> = {
    ts: 'tree-sitter-typescript',
    tsx: 'tree-sitter-typescript',
    js: 'tree-sitter-javascript',
    jsx: 'tree-sitter-javascript',
    py: 'tree-sitter-python',
    go: 'tree-sitter-go',
    rs: 'tree-sitter-rust',
    cs: 'tree-sitter-c-sharp',
    java: 'tree-sitter-java',
    php: 'tree-sitter-php',
    rb: 'tree-sitter-ruby',
  };
  return map[ext];
}

function getFileExtension(text: string): string | undefined {
  const match = text.match(/(?:file|path|filename):\s*["']?([^\s"']+\.\w+)/i);
  if (match) {
    const parts = match[1].split('.');
    return parts[parts.length - 1].toLowerCase();
  }
  return undefined;
}

function extractOutlineFromText(content: string): string {
  const lines = content.split('\n');
  const outline: string[] = [];
  let lineNo = 0;

  for (const line of lines) {
    lineNo++;
    const trimmed = line.trim();
    if (
      /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const\s+\w+\s*=\s*(?:async\s+)?\(|let\s+\w+\s*=\s*(?:async\s+)?\(|var\s+\w+\s*=\s*(?:async\s+)?\()/.test(trimmed) ||
      /^(?:def |class |async def )/.test(trimmed) ||
      /^(?:pub |pub\(crate\) )?(?:fn |struct |enum |trait |impl )/.test(trimmed) ||
      /^(?:public|private|protected|internal|static|override|virtual|abstract)\s+/.test(trimmed)
    ) {
      outline.push(`L${lineNo}: ${trimmed.substring(0, 120)}`);
    }
  }

  if (outline.length === 0) {
    return lines.slice(0, 50).join('\n') + (lines.length > 50 ? '\n[...truncated...]' : '');
  }

  return `[AST Outline — ${lines.length} lines total]\n${outline.join('\n')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOutlineWithParser(tree: any, originalSource: string): string {
  const lines = originalSource.split('\n');
  const outline: string[] = [`[AST Outline — ${lines.length} lines total]`];

  const interestingTypes = new Set([
    'function_declaration', 'function_definition', 'method_definition',
    'class_declaration', 'class_definition', 'interface_declaration',
    'type_alias_declaration', 'enum_declaration', 'struct_item', 'impl_item',
    'function_item', 'trait_item',
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any, depth: number): void {
    if (depth > 3) return;
    if (interestingTypes.has(node.type)) {
      const line = node.startPosition.row + 1;
      const text = lines[node.startPosition.row]?.trim().substring(0, 120) ?? '';
      outline.push(`L${line}: ${text}`);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child, depth + 1);
    }
  }

  walk(tree.rootNode, 0);
  return outline.join('\n');
}

export interface SmartContextResult {
  messages: Message[];
  replaced: number;
}

export async function runSmartContext(messages: Message[], maxFileSize: number): Promise<SmartContextResult> {
  let replaced = 0;

  const processedMessages = await Promise.all(
    messages.map(async (msg): Promise<Message> => {
      if (!Array.isArray(msg.content)) return msg;

      const processedContent = await Promise.all(
        (msg.content as ContentBlock[]).map(async (block): Promise<ContentBlock> => {
          if (block.type !== 'tool_result') return block;

          const content = (block as Record<string, unknown>).content;
          if (typeof content !== 'string') return block;
          if (Buffer.byteLength(content) <= maxFileSize) return block;

          const ext = getFileExtension(content);
          let outline: string;

          if (ext) {
            const parser = await getParser(ext);
            if (parser) {
              try {
                const tree = parser.parse(content);
                outline = extractOutlineWithParser(tree, content);
              } catch {
                outline = extractOutlineFromText(content);
              }
            } else {
              outline = extractOutlineFromText(content);
            }
          } else {
            outline = extractOutlineFromText(content);
          }

          replaced++;
          return { ...block, content: outline };
        })
      );

      return { ...msg, content: processedContent };
    })
  );

  return { messages: processedMessages, replaced };
}
