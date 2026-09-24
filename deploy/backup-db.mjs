/** 在线备份 SQLite：VACUUM INTO 生成一致性快照，不需要 sqlite3 CLI */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('用法: node backup-db.mjs <源库> <目标文件>');
  process.exit(1);
}
if (existsSync(dst)) {
  // VACUUM INTO 撞到已有文件时报的是底层 SQL 错误，先给一句人话
  console.error(`目标已存在，不覆盖：${dst}`);
  process.exit(1);
}
const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
db.close();
console.log(`已备份 → ${dst}`);
