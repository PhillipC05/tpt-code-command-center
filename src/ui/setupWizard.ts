import * as vscode from 'vscode';

interface ProviderOption {
  label: string;
  description: string;
  provider: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyUrl: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    label: '$(globe) OpenRouter',
    description: 'Access 200+ models through one API key (recommended)',
    provider: 'openrouter',
    keyLabel: 'OpenRouter API key',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    label: '$(anthropic) Anthropic',
    description: 'Direct access to Claude models',
    provider: 'anthropic',
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/keys',
  },
  {
    label: '$(openai) OpenAI',
    description: 'Direct access to GPT models',
    provider: 'openai',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    label: '$(server) Local / Ollama',
    description: 'Local model running at localhost:11434 — no API key needed',
    provider: 'local',
    keyLabel: '',
    keyPlaceholder: '',
    keyUrl: '',
  },
  {
    label: '$(link) Custom endpoint',
    description: 'Any OpenAI-compatible API at a custom URL',
    provider: 'custom',
    keyLabel: 'API key (leave blank if not required)',
    keyPlaceholder: '',
    keyUrl: '',
  },
];

const PROVIDER_KEY_SETTING: Record<string, string> = {
  openrouter: 'openrouterApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  custom: 'customApiKey',
};

export async function runSetupWizard(context: vscode.ExtensionContext): Promise<void> {
  // Step 1: pick provider
  const providerPick = await vscode.window.showQuickPick(
    PROVIDERS.map((p) => ({ label: p.label, description: p.description, _opt: p })),
    { placeHolder: 'Step 1 of 2 — Select your LLM provider', ignoreFocusOut: true }
  );
  if (!providerPick) return;

  const opt = providerPick._opt as ProviderOption;
  const cfg = vscode.workspace.getConfiguration('tpt');
  const target = vscode.ConfigurationTarget.Workspace;

  // Step 2: enter API key (skip for local)
  if (opt.provider !== 'local') {
    const hint = opt.keyUrl
      ? `Get your key at ${opt.keyUrl}`
      : undefined;
    const apiKey = await vscode.window.showInputBox({
      prompt: `Step 2 of 2 — ${opt.keyLabel}`,
      placeHolder: opt.keyPlaceholder,
      ignoreFocusOut: true,
      password: true,
      title: 'TPT Setup Wizard',
      valueSelection: undefined,
      ...(hint ? { prompt: `Step 2 of 2 — ${opt.keyLabel} (${hint})` } : {}),
    });
    if (apiKey === undefined) return; // user cancelled

    if (opt.provider === 'custom') {
      const baseUrl = await vscode.window.showInputBox({
        prompt: 'Custom API base URL',
        placeHolder: 'https://my-llm.example.com/v1',
        ignoreFocusOut: true,
        title: 'TPT Setup Wizard',
      });
      if (baseUrl === undefined) return;
      await cfg.update('customBaseUrl', baseUrl, target);
    }

    const keySetting = PROVIDER_KEY_SETTING[opt.provider];
    if (keySetting && apiKey) {
      await cfg.update(keySetting, apiKey, target);
    }
  }

  await cfg.update('upstreamProvider', opt.provider, target);
  // Mark wizard as completed so we don't prompt again on startup
  await context.globalState.update('tpt.wizardDismissed', true);

  vscode.window.showInformationMessage(
    `TPT configured to use ${opt.provider}. Open the dashboard to monitor usage.`,
    'Open Dashboard'
  ).then((choice) => {
    if (choice === 'Open Dashboard') {
      vscode.commands.executeCommand('tpt.showDashboard');
    }
  });
}
