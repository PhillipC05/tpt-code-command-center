import * as http from 'http';
import * as vscode from 'vscode';
import { getConfig } from '../utils/config';

interface ModelSetting {
  label: string;
  detail: string;
  configKey: string;
  inputHint: string;
  fetchOllama?: true;
}

const MODEL_SETTINGS: ModelSetting[] = [
  {
    label: 'Memory Weaver — Anthropic model',
    detail: 'Used when upstream provider is Anthropic',
    configKey: 'memoryWeaver.anthropicSummaryModel',
    inputHint: 'e.g. claude-haiku-4-5-20251001',
  },
  {
    label: 'Memory Weaver — OpenAI-compatible model',
    detail: 'Used with OpenRouter, OpenAI, DeepSeek, Grok, Qwen, Kimi',
    configKey: 'memoryWeaver.openaiSummaryModel',
    inputHint: 'e.g. gpt-4o-mini, openai/gpt-4o-mini, deepseek/deepseek-chat',
  },
  {
    label: 'Memory Weaver — Ollama model',
    detail: 'Local model for offline summarisation',
    configKey: 'memoryWeaver.ollamaModel',
    inputHint: 'e.g. llama3, mistral, qwen2.5',
    fetchOllama: true,
  },
];

function fetchOllamaModels(): Promise<string[]> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: 'localhost', port: 11434, path: '/api/tags', method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString()) as { models?: { name: string }[] };
            resolve((data.models ?? []).map((m) => m.name).sort());
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(3000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function editSetting(setting: ModelSetting, cfg: vscode.WorkspaceConfiguration): Promise<void> {
  const currentValue = cfg.get<string>(setting.configKey, '');

  // For Ollama, try to show a pick list of locally installed models first
  if (setting.fetchOllama) {
    const models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'TPT: querying Ollama...', cancellable: false },
      () => fetchOllamaModels()
    );

    if (models.length > 0) {
      const items: vscode.QuickPickItem[] = [
        ...models.map((m) => ({
          label: m,
          description: m === currentValue ? '$(check) current' : undefined,
        })),
        { label: '$(edit) Enter manually...', description: '' },
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Select Ollama model  (current: ${currentValue})`,
        matchOnDescription: false,
      });

      if (!picked) return;

      if (!picked.label.startsWith('$(edit)')) {
        await cfg.update(setting.configKey, picked.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`TPT: ${setting.label} → "${picked.label}"`);
        return;
      }
      // "Enter manually" falls through to the input box below
    } else {
      vscode.window.showWarningMessage('TPT: Ollama not reachable on localhost:11434 — enter model name manually.');
    }
  }

  // Input box for all providers (or Ollama manual fallback)
  const newValue = await vscode.window.showInputBox({
    prompt: setting.label,
    value: currentValue,
    placeHolder: setting.inputHint,
    ignoreFocusOut: true,
    validateInput: (v) => v.trim() ? undefined : 'Model name cannot be empty',
  });

  if (newValue === undefined || newValue === currentValue) return;

  await cfg.update(setting.configKey, newValue.trim(), vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`TPT: ${setting.label} → "${newValue.trim()}"`);
}

export async function showModelPicker(): Promise<void> {
  const config = getConfig();
  const cfg = vscode.workspace.getConfiguration('tpt');

  const settingItems = MODEL_SETTINGS.map((s) => ({
    label: `$(symbol-misc) ${s.label}`,
    description: cfg.get<string>(s.configKey, ''),
    detail: s.detail,
    action: 'edit' as const,
    setting: s,
  }));

  const ruleCount = config.router.rules.length;
  const actionItems = [
    {
      label: '$(list-unordered) Edit router rules',
      description: `${ruleCount} rule${ruleCount !== 1 ? 's' : ''} configured`,
      detail: 'Open tpt.router.rules in VS Code Settings',
      action: 'router' as const,
      setting: undefined,
    },
    {
      label: '$(gear) Open all TPT settings',
      description: '',
      detail: 'Show the full TPT settings panel',
      action: 'all' as const,
      setting: undefined,
    },
  ];

  const picked = await vscode.window.showQuickPick([...settingItems, ...actionItems], {
    placeHolder: 'Select a model setting to update',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) return;

  if (picked.action === 'router') {
    vscode.commands.executeCommand('workbench.action.openSettings', 'tpt.router.rules');
  } else if (picked.action === 'all') {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tpt.tpt-code-command-center');
  } else if (picked.setting) {
    await editSetting(picked.setting, cfg);
  }
}
