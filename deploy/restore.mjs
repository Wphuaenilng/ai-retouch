/**
 * 从 VACUUM INTO 快照恢复数据库。
 * 用法: node deploy/restore.mjs <快照.db> <目标库> [--force]
 *
 * 快照是单文件（VACUUM INTO 已把 WAL 合并进去），所以恢复就是"落文件 + 体检"。
 * 目标库已存在时必须 --force，避免把还在跑的库覆盖掉。
 */
import { existsSync, copyFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [src, dst] = args.filter((a) => !a.startsWith('--'));

if (!src || !dst) {
  console.error('用法: node deploy/restore.mjs <快照.db> <目标库> [--force]');
  process.exit(2);
}
if (!existsSync(src)) {
  console.error(`快照不存在：${src}`);
  process.exit(1);
}
if (existsSync(dst) && !force) {
  console.error(`目标库已存在（${Math.round(statSync(dst).size / 1024)}KB）。确认要覆盖请加 --force`);
  process.exit(1);
}

mkdirSync(dirname(dst), { recursive: true });
if (existsSync(dst)) {
  // 覆盖走"落临时文件再改名"，中途失败时原库还在
  const tmp = `${dst}.restoring`;
  copyFileSync(src, tmp);
  renameSync(tmp, dst);
  // 旧的 WAL/SHM 必须先清掉，否则它们会盖掉刚恢复的内容
  rmSync(`${dst}-wal`, { force: true });
  rmSync(`${dst}-shm`, { force: true });
} else {
  copyFileSync(src, dst);
}

const db = new DatabaseSync(dst);
const check = db.prepare('PRAGMA integrity_check').get();
const verdict = Object.values(check ?? {})[0];
if (verdict !== 'ok') {
  db.close();
  console.error(`恢复后的库体检不通过：${String(verdict)}`);
  process.exit(1);
}

const tables = [
  'users',
  'invites',
  'images',
  'documents',
  'tasks',
  'plans',
  'usage_daily',
].map((t) => {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
  return `${t}=${Object.values(row ?? {})[0]}`;
});
const version = Object.values(db.prepare('PRAGMA user_version').get() ?? {})[0];
db.close();

console.log(`已恢复 ${src} → ${dst}`);
console.log(`user_version=${version} · ${tables.join(' ')}`);
