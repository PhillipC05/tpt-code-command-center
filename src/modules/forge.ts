import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as vscode from 'vscode';
import { log } from '../utils/logger';

const FORGE_INDEX_URL = 'https://raw.githubusercontent.com/tpt-forge/registry/main/index.json';

export interface ForgeEntry {
  name: string;
  description: string;
  type: 'router-rule' | 'vault-pattern' | 'system-prompt';
  url: string;
  version: string;
}

function getTptDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const dir = path.join(folders[0].uri.fsPath, '.tpt', 'forge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'tpt-code-command-center/0.1.0' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

export async function fetchForgeIndex(): Promise<ForgeEntry[]> {
  try {
    const data = await fetchJson(FORGE_INDEX_URL) as { entries: ForgeEntry[] };
    return data.entries ?? [];
  } catch (e) {
    log(`Forge: could not fetch index — ${e}`);
    return [];
  }
}

export async function installForgeEntry(entry: ForgeEntry): Promise<boolean> {
  const dir = getTptDir();
  if (!dir) {
    vscode.window.showErrorMessage('TPT Forge requires an open workspace folder.');
    return false;
  }

  try {
    const content = await fetchJson(entry.url);
    const filename = `${entry.name.replace(/[^a-z0-9_-]/gi, '-')}.json`;
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(content, null, 2));
    log(`Forge: installed ${entry.name}`);
    return true;
  } catch (e) {
    log(`Forge: failed to install ${entry.name} — ${e}`);
    return false;
  }
}

export async function browseForge(): Promise<void> {
  const entries = await fetchForgeIndex();

  if (entries.length === 0) {
    vscode.window.showInformationMessage('TPT Forge: no community configs available or registry unreachable.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    entries.map((e) => ({
      label: e.name,
      description: e.type,
      detail: e.description,
      entry: e,
    })),
    { placeHolder: 'Select a community config to install', matchOnDescription: true, matchOnDetail: true }
  );

  if (!picked) return;

  const ok = await installForgeEntry(picked.entry);
  if (ok) {
    vscode.window.showInformationMessage(`TPT Forge: installed "${picked.entry.name}" to .tpt/forge/`);
  } else {
    vscode.window.showErrorMessage(`TPT Forge: failed to install "${picked.entry.name}"`);
  }
}
