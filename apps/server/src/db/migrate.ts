import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, type DbHandle } from './index';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 基线：只在 user_version=0 的新库上跑一次。此后不要再改 schema.sql —— 改了不会重放到已有库。 */
const BASELINE_SQL = readFileSync(join(HERE, 'schema.sql'), 'utf8');

export interface Migration {
  name: string;
  sql: string;
}

/**
 * 顺序迁移。要加列/加索引/改约束，就往这个数组尾部追加一条，别动 schema.sql。
 * 每条迁移与它的 user_version 写在同一个事务里：中途崩溃不会留下"改了一半"的库。
 */
export const MIGRATIONS: Migration[] = [
  {
    name: 'plans.exec_token（计划执行锁）',
    sql: `ALTER TABLE plans ADD COLUMN exec_token TEXT;
          ALTER TABLE plans ADD COLUMN exec_started_at TEXT;`,
  },
  {
    name: 'users.token_version（会话可吊销）',
    sql: 'ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0',
  },
  {
    name: 'users.consent_at（隐私告知已确认时间）',
    sql: 'ALTER TABLE users ADD COLUMN consent_at TEXT',
  },
  {
    name: 'images.parent_image_id（同一次上传的派生关系）',
    sql: 'ALTER TABLE images ADD COLUMN parent_image_id TEXT',
  },
];

const BASELINE_VERSION = 1;

export function readVersion(handle: DbHandle): number {
  const row = handle.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined;
  return Number(row?.user_version ?? 0);
}

/** 返回执行后的版本号 */
export function runMigrations(
  handle: DbHandle,
  migrations: Migration[] = MIGRATIONS,
  log: (msg: string) => void = (m) => console.log(m),
): number {
  const target = BASELINE_VERSION + migrations.length;
  let v = readVersion(handle);

  // 老库（有表但没有版本号）先认领基线；基线全是 IF NOT EXISTS，对已存在的表是空操作
  if (v === 0) {
    handle.exec(BASELINE_SQL);
    handle.exec(`PRAGMA user_version = ${BASELINE_VERSION}`);
    v = BASELINE_VERSION;
    log('[db] 基线 schema 已应用 → v1');
  }

  if (v > target) {
    throw new Error(
      `[db] 数据库版本 v${v} 比代码能提供的 v${target} 更新：这是回滚或多人分支后的库，拒绝启动（请恢复代码或补迁移）`,
    );
  }

  for (let i = v; i < target; i += 1) {
    const m = migrations[i - BASELINE_VERSION];
    handle.exec('BEGIN IMMEDIATE');
    try {
      handle.exec(m.sql);
      handle.exec(`PRAGMA user_version = ${i + 1}`);
      handle.exec('COMMIT');
    } catch (e) {
      try {
        handle.exec('ROLLBACK');
      } catch {
        /* 事务已经不在了 */
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`[db] 迁移 #${i + 1}「${m.name}」失败，已回滚，库停在 v${readVersion(handle)}：${msg}`, { cause: e });
    }
    log(`[db] 迁移 #${i + 1}「${m.name}」完成 → v${i + 1}`);
  }

  return readVersion(handle);
}

export function migrate(): void {
  runMigrations(db);
}

// 直接 `pnpm db:migrate` 时执行
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate();
  console.log('[db] 迁移完成');
}
