import * as vscode from 'vscode';
import { getStats, getModelBreakdown, LedgerStats, ModelStat } from '../ledger/ledger';
import { getProxyUrl } from '../proxy/server';
import { getConfig } from '../utils/config';

let panel: vscode.WebviewPanel | undefined;

export function showDashboard(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'tpt.dashboard',
    'TPT Dashboard',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );

  panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
  refreshDashboard();
}

export async function refreshDashboard(): Promise<void> {
  if (!panel) return;
  const [stats, modelBreakdown] = await Promise.all([getStats(), getModelBreakdown()]);
  const config = getConfig();
  const proxyUrl = getProxyUrl();
  panel.webview.html = buildHtml(stats, modelBreakdown, config, proxyUrl);
}

function buildHtml(stats: LedgerStats, modelBreakdown: ModelStat[], config: ReturnType<typeof getConfig>, proxyUrl: string | undefined): string {
  const nonce = Math.random().toString(36).substring(2);

  const modules = [
    { name: 'Vault', enabled: config.vault.enabled, icon: '🛡️' },
    { name: 'Smart Context', enabled: config.smartContext.enabled, icon: '🌳' },
    { name: 'Token Shield', enabled: config.tokenShield.enabled, icon: '💾' },
    { name: 'Memory Weaver', enabled: config.memoryWeaver.enabled, icon: '🧵' },
    { name: 'Router', enabled: config.router.enabled, icon: '🔀' },
    { name: 'Silent Edit', enabled: config.silentEdit.enabled, icon: '✏️' },
    { name: 'Forge', enabled: config.forge.autoUpdate, icon: '🔨' },
  ];

  const moduleRows = modules
    .map((m) => `<tr><td>${m.icon} ${m.name}</td><td class="${m.enabled ? 'on' : 'off'}">${m.enabled ? '● ON' : '○ OFF'}</td></tr>`)
    .join('');

  const dayRows = stats.last7Days
    .map((d) => `<tr><td>${d.date}</td><td>${d.tokensIn.toLocaleString()}</td><td>${d.tokensOut.toLocaleString()}</td><td>$${d.costUsd.toFixed(4)}</td><td>${d.cacheHits}</td></tr>`)
    .join('');

  const modelRows = modelBreakdown
    .map((m) => `<tr><td style="font-family:monospace;font-size:11px">${m.model}</td><td>${m.requests.toLocaleString()}</td><td>${(m.tokensIn + m.tokensOut).toLocaleString()}</td><td>$${m.costUsd.toFixed(4)}</td></tr>`)
    .join('');

  const budgetLimit = config.costBudget.dailyLimitUsd;
  const todayRow = stats.last7Days[stats.last7Days.length - 1];
  const todaySpend = todayRow?.costUsd ?? 0;
  const budgetBar = budgetLimit > 0
    ? `<div class="budget-bar-wrap"><div class="budget-bar-fill" style="width:${Math.min(100, (todaySpend / budgetLimit) * 100).toFixed(1)}%"></div></div><div class="budget-label">Today $${todaySpend.toFixed(4)} / $${budgetLimit.toFixed(2)} limit</div>`
    : '';

  const savingsPct = stats.totalCostUsd > 0
    ? ((stats.estimatedSavingsUsd / (stats.totalCostUsd + stats.estimatedSavingsUsd)) * 100).toFixed(1)
    : '0.0';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TPT Dashboard</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; font-size: 13px; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    h2 { font-size: 14px; margin: 16px 0 8px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 12px; }
    .stat-value { font-size: 22px; font-weight: bold; color: var(--vscode-textLink-foreground); }
    .stat-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .proxy { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 10px 12px; margin-bottom: 16px; font-family: monospace; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 4px 8px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-widget-border); }
    td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border); }
    .on { color: #4caf50; }
    .off { color: var(--vscode-descriptionForeground); }
    .badge-on { display: inline-block; background: #1b5e20; color: #a5d6a7; border-radius: 3px; padding: 1px 6px; font-size: 11px; }
    .badge-off { display: inline-block; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); border-radius: 3px; padding: 1px 6px; font-size: 11px; }
    .budget-bar-wrap { height: 6px; background: var(--vscode-input-background); border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
    .budget-bar-fill { height: 100%; background: var(--vscode-textLink-foreground); border-radius: 3px; transition: width 0.3s; }
    .budget-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>🛡️ TPT Command Center</h1>

  <div class="proxy">
    Proxy: <strong>${proxyUrl ?? 'starting...'}</strong>
    &nbsp;|&nbsp; Suite: <span class="${config.enabled ? 'badge-on' : 'badge-off'}">${config.enabled ? 'ACTIVE' : 'BYPASSED'}</span>
  </div>

  <h2>Token Ledger</h2>
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-value">${stats.totalRequests.toLocaleString()}</div>
      <div class="stat-label">Total requests</div>
    </div>
    <div class="stat">
      <div class="stat-value">${(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}</div>
      <div class="stat-label">Total tokens</div>
    </div>
    <div class="stat">
      <div class="stat-value">$${stats.totalCostUsd.toFixed(4)}</div>
      <div class="stat-label">Total cost</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.cacheHits.toLocaleString()}</div>
      <div class="stat-label">Cache hits</div>
    </div>
    <div class="stat">
      <div class="stat-value">$${stats.estimatedSavingsUsd.toFixed(4)}</div>
      <div class="stat-label">Est. savings</div>
    </div>
    <div class="stat">
      <div class="stat-value">${savingsPct}%</div>
      <div class="stat-label">Savings rate</div>
    </div>
  </div>

  ${budgetBar}

  <h2>Last 7 Days</h2>
  <table>
    <thead><tr><th>Date</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th><th>Cache Hits</th></tr></thead>
    <tbody>${dayRows || '<tr><td colspan="5">No data yet</td></tr>'}</tbody>
  </table>

  <h2>Cost by Model</h2>
  <table>
    <thead><tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr></thead>
    <tbody>${modelRows || '<tr><td colspan="4">No data yet</td></tr>'}</tbody>
  </table>

  <h2>Modules</h2>
  <table>
    <thead><tr><th>Module</th><th>Status</th></tr></thead>
    <tbody>${moduleRows}</tbody>
  </table>
</body>
</html>`;
}

export function disposeDashboard(): void {
  panel?.dispose();
  panel = undefined;
}
