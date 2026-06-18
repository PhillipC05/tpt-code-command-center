import * as vscode from 'vscode';
import { getLastInspectSnapshot } from '../utils/inspectStore';

let panel: vscode.WebviewPanel | undefined;

export function showPromptDiff(context: vscode.ExtensionContext): void {
  const snapshot = getLastInspectSnapshot();
  if (!snapshot) {
    vscode.window.showInformationMessage('TPT: No request has been proxied yet — nothing to diff.');
    return;
  }

  if (panel) {
    panel.reveal(vscode.ViewColumn.Two);
    panel.webview.html = buildHtml(snapshot);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'tpt.promptDiff',
    'TPT Prompt Diff',
    vscode.ViewColumn.Two,
    { enableScripts: false }
  );

  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
  panel.webview.html = buildHtml(snapshot);
}

export function refreshPromptDiff(): void {
  if (!panel) return;
  const snapshot = getLastInspectSnapshot();
  if (snapshot) panel.webview.html = buildHtml(snapshot);
}

interface SnapshotLike {
  timestamp: number;
  format: string;
  originalBody: unknown;
  processedBody: unknown;
  moduleActions: string[];
  overrideUpstream?: { baseUrl: string; apiKey: string; model?: string };
  cacheHit: boolean;
}

function buildHtml(snapshot: SnapshotLike): string {
  const date = new Date(snapshot.timestamp).toLocaleString();
  const original = JSON.stringify(snapshot.originalBody, null, 2);
  const processed = JSON.stringify(snapshot.processedBody, null, 2);
  const actions = snapshot.moduleActions.join(', ') || '(none)';
  const upstream = snapshot.overrideUpstream
    ? `${snapshot.overrideUpstream.model ?? '(same)'} @ ${snapshot.overrideUpstream.baseUrl}`
    : '(default)';

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TPT Prompt Diff</title>
<style>
  body { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; margin: 0; padding: 12px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  h2 { margin: 0 0 6px; font-size: 15px; }
  .meta { color: var(--vscode-descriptionForeground); margin-bottom: 12px; font-size: 12px; }
  .meta span { margin-right: 16px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .col-label { font-weight: bold; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  pre { margin: 0; padding: 10px; border-radius: 4px; overflow: auto; max-height: 70vh; background: var(--vscode-textBlockQuote-background); border: 1px solid var(--vscode-panel-border); white-space: pre-wrap; word-break: break-all; font-size: 12px; }
</style>
</head>
<body>
<h2>TPT Prompt Diff</h2>
<div class="meta">
  <span><b>Time:</b> ${esc(date)}</span>
  <span><b>Format:</b> ${esc(snapshot.format)}</span>
  <span><b>Actions:</b> ${esc(actions)}</span>
  <span><b>Router override:</b> ${esc(upstream)}</span>
  <span><b>Cache hit:</b> ${snapshot.cacheHit ? 'yes' : 'no'}</span>
</div>
<div class="columns">
  <div>
    <div class="col-label">Original (sent by client)</div>
    <pre>${esc(original)}</pre>
  </div>
  <div>
    <div class="col-label">After TPT pipeline (sent to upstream)</div>
    <pre>${esc(processed)}</pre>
  </div>
</div>
</body>
</html>`;
}
