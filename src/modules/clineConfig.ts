import * as vscode from 'vscode';

// Cline extension IDs to check — covers both "saoudrizwan.claude-dev" (original) and forks
const CLINE_EXTENSION_IDS = [
  'saoudrizwan.claude-dev',
  'cline.cline',
  'anthropic.claude-coder',
];

export async function configureClineAuto(proxyUrl: string, sessionToken: string): Promise<void> {
  // Check if any known Cline variant is installed
  const installed = CLINE_EXTENSION_IDS.find((id) => !!vscode.extensions.getExtension(id));
  if (!installed) {
    const choice = await vscode.window.showWarningMessage(
      'Cline extension not detected. You can still configure its settings manually.',
      'Configure Anyway',
      'Cancel'
    );
    if (choice !== 'Configure Anyway') return;
  } else {
    const confirm = await vscode.window.showInformationMessage(
      `Detected Cline (${installed}). Update its API base URL and custom header to use TPT proxy?`,
      { modal: true },
      'Update Settings'
    );
    if (confirm !== 'Update Settings') return;
  }

  const cfg = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Global;

  // Cline stores its API config under "cline.apiProvider" and related keys.
  // Set to "openai-compatible" so it uses a custom base URL.
  await cfg.update('cline.apiProvider', 'openai-compatible', target);
  await cfg.update('cline.openAiBaseUrl', `${proxyUrl}/v1`, target);

  // Cline supports custom headers via "cline.openAiHeaders" (array of {key, value} objects)
  const existingHeaders: { key: string; value: string }[] =
    cfg.get<{ key: string; value: string }[]>('cline.openAiHeaders', []);
  const filtered = existingHeaders.filter((h) => h.key !== 'X-TPT-Token');
  await cfg.update('cline.openAiHeaders', [...filtered, { key: 'X-TPT-Token', value: sessionToken }], target);

  vscode.window.showInformationMessage(
    `Cline configured to use TPT proxy at ${proxyUrl}/v1. ` +
    'Set your model name in Cline settings under "openAI Compatible" → Model.'
  );
}
