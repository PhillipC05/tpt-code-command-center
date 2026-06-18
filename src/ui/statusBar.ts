import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getProxyUrl } from '../proxy/server';

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'tpt.toggleSuite';
  updateStatusBar();
  statusBarItem.show();
  return statusBarItem;
}

export function updateStatusBar(): void {
  if (!statusBarItem) return;
  const config = getConfig();
  const proxyUrl = getProxyUrl();

  if (!config.enabled) {
    statusBarItem.text = '$(shield) TPT';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.tooltip = `TPT bypassed — proxy at ${proxyUrl ?? 'not running'}\nClick to re-enable`;
    return;
  }

  const modules = [
    config.vault.enabled,
    config.smartContext.enabled,
    config.tokenShield.enabled,
    config.memoryWeaver.enabled,
    config.router.enabled,
    config.silentEdit.enabled,
  ];
  const activeCount = modules.filter(Boolean).length;
  const totalCount = modules.length;

  if (activeCount === totalCount) {
    statusBarItem.text = '$(shield) TPT';
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.tooltip = `TPT active — all ${totalCount} modules on\nProxy: ${proxyUrl ?? 'starting...'}\nClick to manage`;
  } else if (activeCount > 0) {
    statusBarItem.text = `$(shield) TPT (${activeCount}/${totalCount})`;
    statusBarItem.color = new vscode.ThemeColor('charts.yellow');
    statusBarItem.tooltip = `TPT partial — ${activeCount} of ${totalCount} modules active\nProxy: ${proxyUrl ?? 'starting...'}\nClick to manage`;
  } else {
    statusBarItem.text = '$(shield) TPT';
    statusBarItem.color = new vscode.ThemeColor('errorForeground');
    statusBarItem.tooltip = `TPT: all modules disabled\nProxy: ${proxyUrl ?? 'not running'}\nClick to manage`;
  }
}

export async function showToggleMenu(): Promise<void> {
  const config = getConfig();
  const proxyUrl = getProxyUrl();

  const items: vscode.QuickPickItem[] = [
    {
      label: config.enabled ? '$(circle-slash) Disable entire suite' : '$(play) Enable entire suite',
      description: config.enabled ? 'Bypass all TPT modules' : 'Re-enable all TPT modules',
      alwaysShow: true,
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: `$(shield) Vault`,
      description: config.vault.enabled ? 'ON — secret redaction' : 'OFF',
      picked: config.vault.enabled,
    },
    {
      label: `$(symbol-structure) Smart Context`,
      description: config.smartContext.enabled ? 'ON — AST outlining' : 'OFF',
      picked: config.smartContext.enabled,
    },
    {
      label: `$(database) Token Shield`,
      description: config.tokenShield.enabled ? 'ON — prompt cache' : 'OFF',
      picked: config.tokenShield.enabled,
    },
    {
      label: `$(notebook) Memory Weaver`,
      description: config.memoryWeaver.enabled ? 'ON — context summarisation' : 'OFF',
      picked: config.memoryWeaver.enabled,
    },
    {
      label: `$(git-branch) Router`,
      description: config.router.enabled ? 'ON — heuristic routing' : 'OFF',
      picked: config.router.enabled,
    },
    {
      label: `$(edit) Silent Edit`,
      description: config.silentEdit.enabled ? 'ON — JSON diffs' : 'OFF',
      picked: config.silentEdit.enabled,
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(link) Copy proxy URL',
      description: proxyUrl ?? 'proxy not running',
    },
    {
      label: '$(graph) Show dashboard',
      description: 'Open token stats',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'TPT Code Command Center — toggle modules',
    canPickMany: false,
  });

  if (!picked) return;

  const cfg = vscode.workspace.getConfiguration('tpt');

  if (picked.label.includes('entire suite')) {
    await cfg.update('enabled', !config.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Vault')) {
    await cfg.update('vault.enabled', !config.vault.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Smart Context')) {
    await cfg.update('smartContext.enabled', !config.smartContext.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Token Shield')) {
    await cfg.update('tokenShield.enabled', !config.tokenShield.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Memory Weaver')) {
    await cfg.update('memoryWeaver.enabled', !config.memoryWeaver.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Router')) {
    await cfg.update('router.enabled', !config.router.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Silent Edit')) {
    await cfg.update('silentEdit.enabled', !config.silentEdit.enabled, vscode.ConfigurationTarget.Workspace);
  } else if (picked.label.includes('Copy proxy URL') && proxyUrl) {
    await vscode.env.clipboard.writeText(proxyUrl);
    vscode.window.showInformationMessage(`Copied: ${proxyUrl}`);
  } else if (picked.label.includes('Show dashboard')) {
    vscode.commands.executeCommand('tpt.showDashboard');
  }

  updateStatusBar();
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
