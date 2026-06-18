import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { AnthropicRequest, OpenAIRequest } from '../proxy/types';
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
  if (!tptDir) {
    db = new SQL.Database();
  } else {
    const dbPath = path.join(tptDir, 'ledger.db');
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath);
      db = new SQL.Database(data);
    } else {
      db = new SQL.Database();
    }
  }

  db!.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      cache_hit INTEGER NOT NULL,
      module_actions TEXT NOT NULL
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
  const dbPath = path.join(tptDir, 'ledger.db');
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export interface LedgerEntry {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  moduleActions: string[];
  cacheHit: boolean;
}

export async function recordRequest(entry: LedgerEntry): Promise<void> {
  const database = await getDb();
  database.run(
    'INSERT INTO requests (ts, model, tokens_in, tokens_out, cost_usd, cache_hit, module_actions) VALUES (?,?,?,?,?,?,?)',
    [Date.now(), entry.model, entry.tokensIn, entry.tokensOut, entry.costUsd, entry.cacheHit ? 1 : 0, entry.moduleActions.join(',')]
  );
  persistDb();
}

export interface LedgerStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  cacheHits: number;
  estimatedSavingsUsd: number;
  last7Days: DayStat[];
}

export interface DayStat {
  date: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheHits: number;
}

export async function getStats(): Promise<LedgerStats> {
  const database = await getDb();

  const totals = database.exec(
    'SELECT COUNT(*), SUM(tokens_in), SUM(tokens_out), SUM(cost_usd), SUM(cache_hit) FROM requests'
  );
  const row = totals[0]?.values[0] ?? [0, 0, 0, 0, 0];
  const totalRequests = Number(row[0]);
  const totalTokensIn = Number(row[1]);
  const totalTokensOut = Number(row[2]);
  const totalCostUsd = Number(row[3]);
  const cacheHits = Number(row[4]);

  const avgCost = totalRequests > 0 ? totalCostUsd / totalRequests : 0;
  const estimatedSavingsUsd = cacheHits * avgCost;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const daily = database.exec(
    `SELECT date(ts/1000,'unixepoch') as d, SUM(tokens_in), SUM(tokens_out), SUM(cost_usd), SUM(cache_hit)
     FROM requests WHERE ts > ? GROUP BY d ORDER BY d`,
    [sevenDaysAgo]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const last7Days: DayStat[] = (daily[0]?.values ?? []).map((r: any) => ({
    date: String(r[0]),
    tokensIn: Number(r[1]),
    tokensOut: Number(r[2]),
    costUsd: Number(r[3]),
    cacheHits: Number(r[4]),
  }));

  return { totalRequests, totalTokensIn, totalTokensOut, totalCostUsd, cacheHits, estimatedSavingsUsd, last7Days };
}

export async function clearLedger(): Promise<void> {
  const database = await getDb();
  database.run('DELETE FROM requests');
  persistDb();
}

export function countTokens(body: AnthropicRequest | OpenAIRequest): number {
  let chars = 0;
  if ('messages' in body && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'object' && block !== null && 'text' in block) {
            chars += String((block as { text?: unknown }).text ?? '').length;
          }
        }
      }
    }
  }
  if ('system' in body && body.system) {
    chars += typeof body.system === 'string' ? body.system.length : JSON.stringify(body.system).length;
  }
  return Math.ceil(chars / 4);
}
