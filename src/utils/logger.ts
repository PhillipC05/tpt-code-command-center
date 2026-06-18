import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('TPT Command Center');
  }
  return outputChannel;
}

export function log(message: string, verbose = false): void {
  const channel = getChannel();
  const ts = new Date().toISOString().substring(11, 23);
  if (!verbose) {
    channel.appendLine(`[${ts}] ${message}`);
  } else {
    // verbose logs only appear when the setting is on — callers check first
    channel.appendLine(`[${ts}] [verbose] ${message}`);
  }
}

export function disposeChannel(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
