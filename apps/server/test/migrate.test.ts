/**
 * 迁移版本表（PRAGMA user_version）的行为约束。
 * 这块以前没有：schema.sql 每次启动整份 exec、全是 IF NOT EXISTS，
 * 加列对已有库静默失效 —— 所以先把它钉住再往上加迁移。
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion, runMigrations, type Migration } from '../src/db/migrate';

const BASELINE_SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'schema.sql'), 'utf8');

const fresh = (): DatabaseSync => {
  const h = new DatabaseSync(':memory:');
  h.exec('PRAGMA foreign_keys = ON');
  return h;
};

const tables = (h: DatabaseSync): string[] =>
  (h.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe('迁移版本表', () => {
  it('新库跑到基线 v1 并建齐业务表', () => {
    const h = fresh();
    const v = runMigrations(h, []);
    assert.equal(v, 1);
    for (const t of ['users', 'invites', 'images', 'documents', 'tasks', 'plans', 'usage_daily']) {
      assert.ok(tables(h).includes(t), `缺表 ${t}`);
    }
  });

  it('已有表但没有版本号的老库：认领基线，数据不丢', () => {
    const h = fresh();
    h.exec(BASELINE_SQL);
    h.exec("INSERT INTO users (id, username, password_hash, role, quota_per_day, created_at) VALUES ('us_1', 'a', 'x', 'user', 30, '2026-01-01')");
    assert.equal(readVersion(h), 0);

    const v = runMigrations(h, []);
    assert.equal(v, 1);
    const kept = h.prepare("SELECT username FROM users WHERE id = 'us_1'").get() as { username: string } | undefined;
    assert.equal(kept?.username, 'a', '基线重放不应该动已有数据');
  });

  it('重复执行是幂等的（启动时每次都跑）', () => {
    const h = fresh();
    runMigrations(h, []);
    assert.equal(runMigrations(h, []), 1);
  });

  it('追加的迁移按序执行，新列立刻可用', () => {
    const h = fresh();
    const migs: Migration[] = [
      { name: 'a-add-quota2', sql: 'ALTER TABLE users ADD COLUMN quota2 INTEGER NOT NULL DEFAULT 7' },
      { name: 'b-add-note', sql: 'ALTER TABLE users ADD COLUMN note TEXT' },
    ];
    assert.equal(runMigrations(h, migs), 3);
    h.exec("INSERT INTO users (id, username, password_hash, role, quota_per_day, created_at) VALUES ('us_2', 'b', 'x', 'user', 30, '2026-01-01')");
    const row = h.prepare("SELECT quota2, note FROM users WHERE id = 'us_2'").get() as { quota2: number; note: string | null };
    assert.equal(row.quota2, 7);
    assert.equal(row.note, null);
  });

  it('迁移中途失败：回滚且版本号停在原地，错误里点名是哪条', () => {
    const h = fresh();
    runMigrations(h, []);
    const migs: Migration[] = [
      { name: '坏掉的迁移', sql: 'ALTER TABLE nonexistent_table ADD COLUMN x INTEGER' },
      { name: '不该被执行', sql: 'ALTER TABLE users ADD COLUMN never INTEGER' },
    ];
    assert.throws(() => runMigrations(h, migs), /坏掉的迁移/);
    assert.equal(readVersion(h), 1, '失败的迁移不能把版本号抬上去');
    const cols = (h.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(!cols.includes('never'), '第二条不应该跟着跑');
  });

  it('库版本比代码新（回滚或分支后的库）：拒绝启动而不是静默降级', () => {
    const h = fresh();
    runMigrations(h, []);
    h.exec('PRAGMA user_version = 99');
    assert.throws(() => runMigrations(h, []), /比代码能提供的/);
  });

  it('版本号与 DDL 同事务：崩溃不会留下改了一半的库', () => {
    const h = fresh();
    runMigrations(h, []);
    // 模拟"DDL 成功但版本没写"以外的另一种崩溃：事务内两条语句，第二条失败
    const migs: Migration[] = [
      {
        name: '两条语句的迁移',
        sql: 'ALTER TABLE users ADD COLUMN ok_col INTEGER; CREATE UNIQUE INDEX ux_users_name ON users(nope)',
      },
    ];
    assert.throws(() => runMigrations(h, migs), /两条语句的迁移/);
    assert.equal(readVersion(h), 1);
    const cols = (h.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(!cols.includes('ok_col'), '同一个迁移里的成功部分也要一起回滚');
  });
});
