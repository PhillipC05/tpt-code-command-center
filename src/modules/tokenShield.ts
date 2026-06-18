import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { hashPrompt } from '../utils/hash';
import { Message } from '../proxy/types';
import type { Database } from 'sql.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initSqlJs: (config?: any) => Promise<any>;
let db: Database | undefined;

async function getDb(): Promise<Database> {
  if (db) return db;

  if (!initSqlJs) {
    initSqlJs = require('sql.js');
  }

  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
  });

  const tptDir = getTptDir();
  const dbPath = tptDir ? path.join(tptDir, 'cache.db') : undefined;

  if (dbPath && fs.existsSync(dbPath)) {
    const data = fs.readFileSync(dbPath);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }

  db!.run(`
    CREATE TABLE IF NOT EXISTS cache (
      hash TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      ts INTEGER NOT NULL,
      size INTEGER NOT NULL
    )
  `);

  return db!;
}

function getTptDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const dir = path.join(folders[0].uri.fsPath, '.tpt');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function persistDb(): void {
  if (!db) return;
  const tptDir = getTptDir();
  if (!tptDir) return;
  const data = db.export();
  fs.writeFileSync(path.join(tptDir, 'cache.db'), Buffer.from(data));
}

export async function runTokenShield(messages: Message[]): Promise<string | null> {
  const hash = hashPrompt(messages);
  const database = await getDb();
  const result = database.exec('SELECT response FROM cache WHERE hash = ?', [hash]);
  return (result[0]?.values[0]?.[0] as string) ?? null;
}

export async function storeCachedResponse(
  messages: Message[],
  response: string,
  maxCacheSizeMB: number
): Promise<void> {
  const hash = hashPrompt(messages);
  const database = await getDb();
  const size = Buffer.byteLength(response);

  database.run(
    'INSERT OR REPLACE INTO cache (hash, response, ts, size) VALUES (?,?,?,?)',
    [hash, response, Date.now(), size]
  );

  // Enforce size cap — evict oldest 10% when over limit
  const maxBytes = maxCacheSizeMB * 1024 * 1024;
  const totalResult = database.exec('SELECT SUM(size) FROM cache');
  const totalSize = Number(totalResult[0]?.values[0]?.[0] ?? 0);

  if (totalSize > maxBytes) {
    database.run(`
      DELETE FROM cache WHERE hash IN (
        SELECT hash FROM cache ORDER BY ts ASC LIMIT MAX(0, (
          SELECT COUNT(*) FROM cache
        ) - (
          SELECT COUNT(*) FROM (
            SELECT hash, SUM(size) OVER (ORDER BY ts DESC) AS running FROM cache
          ) WHERE running <= ?
        ))
      )
    `, [maxBytes * 0.9]);
  }

  persistDb();
}

export async function clearCache(): Promise<void> {
  const database = await getDb();
  database.run('DELETE FROM cache');
  persistDb();
}
