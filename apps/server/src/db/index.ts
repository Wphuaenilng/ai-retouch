import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

/**
 * 数据库层：用 Node 22 内置的 node:sqlite，零原生依赖。
 * 生产若要换 Postgres，只需替换本文件的 run/get/all/tx 四个出口，
 * 上层仓储与业务代码不动（SQL 需按方言微调：TEXT→JSONB、无 ON CONFLICT 差异）。
 */
mkdirSync(dirname(config.SQLITE_PATH), { recursive: true });
mkdirSync(config.DATA_DIR, { recursive: true });

const handle = new DatabaseSync(config.SQLITE_PATH);
handle.exec('PRAGMA journal_mode = WAL');
handle.exec('PRAGMA foreign_keys = ON');
handle.exec('PRAGMA busy_timeout = 5000');

let closed = false;

/** 关库之后还有写入 = 有任务没被取消就走到收尾，宁可报错也不要往已 checkpoint 的库里写半截 */
function assertOpen(): void {
  if (closed) throw new Error('[db] 数据库已关闭（服务正在退出），忽略这次写入');
}

/** 退出前 checkpoint 并关连接；WAL 长期不回收会让主库文件与日志严重失衡 */
export function closeDb(): void {
  if (closed) return;
  try {
    handle.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* checkpoint 失败不该挡住退出 */
  }
  closed = true;
  handle.close();
}

type Param = string | number | bigint | null | Uint8Array;

export type DbHandle = DatabaseSync;

/** node:sqlite 不接受 undefined 与 boolean，统一在这里收口 */
function clean(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

export interface RunResult {
  changes: number;
}

type InParam = string | number | bigint | null | Uint8Array;

export function run(sql: string, ...params: unknown[]): RunResult {
  assertOpen();
  const r = handle.prepare(sql).run(...(params.map(clean) as InParam[]));
  return { changes: Number(r.changes) };
}

export function get<T>(sql: string, ...params: unknown[]): T | undefined {
  assertOpen();
  return handle.prepare(sql).get(...(params.map(clean) as InParam[])) as unknown as T | undefined;
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  assertOpen();
  return handle.prepare(sql).all(...(params.map(clean) as InParam[])) as unknown as T[];
}

export function count(sql: string, ...params: unknown[]): number {
  const row = get<{ n: number | bigint }>(sql, ...params);
  return Number(row?.n ?? 0);
}

let depth = 0;
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn(); // 嵌套事务直接沿用外层
  handle.exec('BEGIN IMMEDIATE');
  depth += 1;
  try {
    const r = fn();
    handle.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      handle.exec('ROLLBACK');
    } catch {
      /* 已经回滚失败说明连接断了，交给上层 */
    }
    throw e;
  } finally {
    depth -= 1;
  }
}

export const nowIso = () => new Date().toISOString();
/** 配额按天聚合用本地日期 */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const db = handle;
