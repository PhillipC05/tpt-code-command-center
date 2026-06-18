import * as vscode from 'vscode';
import { AnthropicRequest, OpenAIRequest } from '../proxy/types';
import { log } from '../utils/logger';

const SILENT_EDIT_SCHEMA = `
You can apply file edits without showing markdown diffs by outputting a JSON block in this exact format:
\`\`\`tpt-edit
{"file":"<relative-path>","startLine":<1-indexed>,"endLine":<1-indexed>,"newContent":"<replacement lines>"}
\`\`\`
Use this format when making code changes. Multiple edits can be output as separate blocks.
Normal text responses are fine when no edits are needed.
`;

const TPT_EDIT_RE = /```tpt-edit\s*([\s\S]*?)```/g;

export interface SilentEditInstruction {
  file: string;
  startLine: number;
  endLine: number;
  newContent: string;
}

export function runSilentEditInjection(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  format: 'anthropic' | 'openai'
): AnthropicRequest | OpenAIRequest | Record<string, unknown> {
  const b = body as AnthropicRequest;

  if (format === 'anthropic') {
    if (typeof b.system === 'string') {
      return { ...b, system: SILENT_EDIT_SCHEMA + '\n\n' + b.system };
    }
    if (Array.isArray(b.system)) {
      return {
        ...b,
        system: [{ type: 'text', text: SILENT_EDIT_SCHEMA }, ...b.system],
      };
    }
    return { ...b, system: SILENT_EDIT_SCHEMA };
  }

  // OpenAI format: prepend to system message or add one
  const messages = [...((b as OpenAIRequest).messages ?? [])];
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    messages[sysIdx] = {
      ...messages[sysIdx],
      content: SILENT_EDIT_SCHEMA + '\n\n' + (typeof messages[sysIdx].content === 'string' ? messages[sysIdx].content : JSON.stringify(messages[sysIdx].content)),
    };
  } else {
    messages.unshift({ role: 'system', content: SILENT_EDIT_SCHEMA });
  }
  return { ...b, messages };
}

export async function handleSilentEditResponse(responseBody: string): Promise<string> {
  let responseText: string;
  try {
    const parsed = JSON.parse(responseBody);
    // Anthropic format
    responseText = parsed.content?.[0]?.text ?? '';
    // OpenAI format
    if (!responseText) responseText = parsed.choices?.[0]?.message?.content ?? '';
  } catch {
    return responseBody;
  }

  if (!responseText || !responseText.includes('```tpt-edit')) return responseBody;

  const instructions: SilentEditInstruction[] = [];
  let match: RegExpExecArray | null;
  TPT_EDIT_RE.lastIndex = 0;

  while ((match = TPT_EDIT_RE.exec(responseText)) !== null) {
    try {
      const instruction = JSON.parse(match[1].trim()) as SilentEditInstruction;
      if (instruction.file && instruction.startLine && instruction.endLine && instruction.newContent !== undefined) {
        instructions.push(instruction);
      }
    } catch { /* invalid JSON block — skip */ }
  }

  if (instructions.length === 0) return responseBody;

  await applyEdits(instructions);
  return responseBody;
}

export async function handleSilentEditStreamResponse(accumulated: string, format: 'anthropic' | 'openai'): Promise<void> {
  let fullText = '';
  for (const line of accumulated.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const data = trimmed.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (format === 'anthropic') {
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          fullText += parsed.delta.text ?? '';
        }
      } else {
        fullText += parsed.choices?.[0]?.delta?.content ?? '';
      }
    } catch { /* skip malformed event */ }
  }

  if (!fullText.includes('```tpt-edit')) return;

  const instructions: SilentEditInstruction[] = [];
  let match: RegExpExecArray | null;
  TPT_EDIT_RE.lastIndex = 0;
  while ((match = TPT_EDIT_RE.exec(fullText)) !== null) {
    try {
      const instr = JSON.parse(match[1].trim()) as SilentEditInstruction;
      if (instr.file && instr.startLine && instr.endLine && instr.newContent !== undefined) {
        instructions.push(instr);
      }
    } catch { /* skip invalid blocks */ }
  }

  if (instructions.length > 0) {
    await applyEdits(instructions);
  }
}

async function applyEdits(instructions: SilentEditInstruction[]): Promise<void> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  const root = folders[0].uri;

  for (const instr of instructions) {
    const fileUri = vscode.Uri.joinPath(root, instr.file);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(fileUri);
    } catch {
      log(`Silent Edit: could not open file ${instr.file}`);
      continue;
    }

    const startLine = Math.max(0, instr.startLine - 1);
    const endLine = Math.min(document.lineCount - 1, instr.endLine - 1);
    const endChar = document.lineAt(endLine).range.end.character;
    const range = new vscode.Range(startLine, 0, endLine, endChar);

    workspaceEdit.replace(fileUri, range, instr.newContent);
    log(`Silent Edit: ${instr.file} L${instr.startLine}-${instr.endLine}`);
  }

  await vscode.workspace.applyEdit(workspaceEdit);
}
