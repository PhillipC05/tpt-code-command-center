import * as vscode from 'vscode';
import { startProxyServer, stopProxyServer, getProxyUrl, getSessionToken } from './proxy/server';
import { createStatusBar, updateStatusBar, showToggleMenu, disposeStatusBar } from './ui/statusBar';
import { showDashboard, refreshDashboard, disposeDashboard } from './ui/dashboard';
import { getStats, clearLedger } from './ledger/ledger';
import { clearCache } from './modules/tokenShield';
import { browseForge } from './modules/forge';
import { log, getChannel, disposeChannel } from './utils/logger';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('TPT Code Command Center activating...');

  // Start proxy server
  await startProxyServer(context);

  // Status bar
  const statusBar = createStatusBar();
  context.subscriptions.push(statusBar);

  // Keep status bar updated on config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tpt')) {
        updateStatusBar();
        refreshDashboard();
      }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('tpt.toggleSuite', () => showToggleMenu()),

    vscode.commands.registerCommand('tpt.showDashboard', () => showDashboard(context)),

    vscode.commands.registerCommand('tpt.showStats', async () => {
      const stats = await getStats();
      const msg = [
        `Requests: ${stats.totalRequests}`,
        `Tokens in: ${stats.totalTokensIn.toLocaleString()}`,
        `Tokens out: ${stats.totalTokensOut.toLocaleString()}`,
        `Cost: $${stats.totalCostUsd.toFixed(4)}`,
        `Cache hits: ${stats.cacheHits}`,
        `Est. savings: $${stats.estimatedSavingsUsd.toFixed(4)}`,
      ].join('  |  ');
      vscode.window.showInformationMessage(`TPT Stats — ${msg}`);
    }),

    vscode.commands.registerCommand('tpt.clearCache', async () => {
      await clearCache();
      vscode.window.showInformationMessage('TPT: Token Shield cache cleared.');
    }),

    vscode.commands.registerCommand('tpt.pruneMemory', () => {
      vscode.window.showInformationMessage('TPT: Memory Weaver will summarise on the next request that exceeds the threshold.');
    }),

    vscode.commands.registerCommand('tpt.browseForge', () => browseForge()),

    vscode.commands.registerCommand('tpt.copyProxyUrl', async () => {
      const url = getProxyUrl();
      if (url) {
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(
          `TPT proxy URL copied: ${url}\n\nTo use with Claude Code, set ANTHROPIC_BASE_URL=${url} in your terminal.\nTo use with Cline, point the custom base URL to ${url}.`
        );
      } else {
        vscode.window.showWarningMessage('TPT proxy is not running yet.');
      }
    }),
  );

  // Show proxy URL in output channel on startup
  const proxyUrl = getProxyUrl();
  const sessionToken = getSessionToken();
  if (proxyUrl) {
    log(`Proxy URL: ${proxyUrl}`);
    log(`Session token: ${sessionToken} (include as X-TPT-Token header)`);
    log(`For Claude Code: ANTHROPIC_BASE_URL=${proxyUrl} is already injected into new terminals.`);
    log(`For Cline: set custom base URL to ${proxyUrl} and add header X-TPT-Token: ${sessionToken}`);
  }

  // Show channel automatically on first activation
  const channel = getChannel();
  channel.show(true);

  log('TPT Code Command Center activated.');
}

export function deactivate(): void {
  stopProxyServer();
  disposeDashboard();
  disposeStatusBar();
  disposeChannel();
}
