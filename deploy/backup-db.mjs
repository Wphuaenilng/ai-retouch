/** 在线备份 SQLite：VACUUM INTO 生成一致性快照，不需要 sqlite3 CLI */
import { DatabaseSync } from 'node:sqlite';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('用法: node backup-db.mjs <源库> <目标文件>');
  process.exit(1);
}
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
db.close();
console.log(`已备份 → ${dst}`);
