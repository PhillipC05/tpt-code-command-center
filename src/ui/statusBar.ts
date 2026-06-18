import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getProxyUrl, getServerState } from '../proxy/server';
import { getStats, getTodayCostUsd } from '../ledger/ledger';

let statusBarItem: vscode.StatusBarItem | undefined;
let tickerInterval: NodeJS.Timeout | undefined;
let todayCostLine = '';

async function refreshCostTicker(): Promise<void> {
  try {
    const [cost, stats] = await Promise.all([getTodayCostUsd(), getStats()]);
    todayCostLine = `Today: $${cost.toFixed(4)} | ${stats.totalRequests} total requests`;
  } catch {
    // ledger may not be ready yet — leave previous value
  }
  updateStatusBar();
}

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'tpt.toggleSuite';
  updateStatusBar();
  statusBarItem.show();
  // Kick off initial cost fetch and refresh every 60 seconds
  refreshCostTicker();
  tickerInterval = setInterval(refreshCostTicker, 60_000);
  return statusBarItem;
}

export function updateStatusBar(): void {
  if (!statusBarItem) return;
  const config = getConfig();
  const proxyUrl = getProxyUrl();
  const { state, error } = getServerState();

  if (state === 'starting') {
    statusBarItem.text = '$(loading~spin) TPT';
    statusBarItem.color = undefined;
    statusBarItem.tooltip = 'TPT: proxy starting…';
    return;
  }

  if (state === 'error') {
    statusBarItem.text = '$(error) TPT';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.tooltip = `TPT: proxy failed to start — ${error ?? 'unknown error'}\nClick to see Output Channel`;
    return;
  }

  if (!config.enabled) {
    statusBarItem.text = '$(shield) TPT';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.tooltip = `TPT bypassed — proxy at ${proxyUrl}\nClick to re-enable`;
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

  const costSuffix = todayCostLine ? `\n${todayCostLine}` : '';
  if (activeCount === totalCount) {
    statusBarItem.text = '$(shield) TPT';
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.tooltip = `TPT active — all ${totalCount} modules on\nProxy: ${proxyUrl}${costSuffix}\nClick to manage`;
  } else if (activeCount > 0) {
    statusBarItem.text = `$(shield) TPT (${activeCount}/${totalCount})`;
    statusBarItem.color = new vscode.ThemeColor('charts.yellow');
    statusBarItem.tooltip = `TPT partial — ${activeCount} of ${totalCount} modules active\nProxy: ${proxyUrl}${costSuffix}\nClick to manage`;
  } else {
    statusBarItem.text = '$(shield) TPT';
    statusBarItem.color = new vscode.ThemeColor('errorForeground');
    statusBarItem.tooltip = `TPT: all modules disabled\nProxy: ${proxyUrl}${costSuffix}\nClick to manage`;
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
    {
      label: '$(gear) Run setup wizard',
      description: 'Configure provider and API key',
    },
    {
      label: '$(trash) Reset credentials',
      description: 'Clear all API keys and reset provider',
    },
    {
      label: '$(cloud-download) Export monthly summary',
      description: 'Save CSV to Downloads folder',
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
  } else if (picked.label.includes('setup wizard')) {
    vscode.commands.executeCommand('tpt.runSetupWizard');
  } else if (picked.label.includes('Reset credentials')) {
    vscode.commands.executeCommand('tpt.resetSetup');
  } else if (picked.label.includes('monthly summary')) {
    vscode.commands.executeCommand('tpt.exportMonthlySummary');
  }

  updateStatusBar();
}

export function disposeStatusBar(): void {
  if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = undefined; }
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
