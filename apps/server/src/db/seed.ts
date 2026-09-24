import { config } from '../config';
import { newInviteCode, newUserId } from '../lib/ids';
import { hashPassword } from '../lib/password';
import { db, nowIso, run } from './index';
import { migrate } from './migrate';

/** 幂等地创建管理员与首批邀请码；命令行直接跑时打印可用凭据 */
export function seed(): { adminCreated: boolean; invites: string[] } {
  migrate();
  let adminCreated = false;

  if (config.BOOTSTRAP_ADMIN_USERNAME && config.BOOTSTRAP_ADMIN_PASSWORD) {
    const username = config.BOOTSTRAP_ADMIN_USERNAME.trim().toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!exists) {
      run(
        'INSERT INTO users (id, username, password_hash, role, quota_per_day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newUserId(),
        username,
        hashPassword(config.BOOTSTRAP_ADMIN_PASSWORD),
        'admin',
        config.PER_USER_DAILY_CALLS * 4,
        nowIso(),
      );
      adminCreated = true;
    }
  }

  const invites: string[] = [];
  const wanted = config.BOOTSTRAP_INVITE_CODE
    ? config.BOOTSTRAP_INVITE_CODE.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [newInviteCode()];

  for (const code of wanted) {
    if (!db.prepare('SELECT code FROM invites WHERE code = ?').get(code)) {
      run('INSERT INTO invites (code, created_by, used_by, used_at, expires_at, created_at) VALUES (?, ?, NULL, NULL, NULL, ?)', code, 'seed', nowIso());
      invites.push(code);
    }
  }
  return { adminCreated, invites };
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const r = seed();
  console.log(`[db] 管理员${r.adminCreated ? '已创建' : '跳过'}`);
  if (r.invites.length) console.log(`[db] 可用邀请码：${r.invites.join(' ')}`);
}
