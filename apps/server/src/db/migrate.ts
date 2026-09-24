import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export function migrate(): void {
  db.exec(SQL);
}

// 直接 `pnpm db:migrate` 时执行
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate();
  console.log('[db] 迁移完成');
}
