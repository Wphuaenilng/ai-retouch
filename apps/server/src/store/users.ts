import { all, db, nowIso, run, tx } from '../db/index';
import { newInviteCode, newUserId } from '../lib/ids';
import { hashPassword, verifyPassword } from '../lib/password';
import { config } from '../config';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: 'user' | 'admin';
  quota_per_day: number;
  created_at: string;
}

export interface InviteRow {
  code: string;
  created_by: string | null;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export function findUserByName(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase()) as
    | UserRow
    | undefined;
}

export function findUser(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function listUsers(): UserRow[] {
  return all<UserRow>('SELECT * FROM users ORDER BY created_at DESC');
}

export function checkCredentials(username: string, password: string): UserRow | null {
  const u = findUserByName(username);
  if (!u) {
    verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA'); // 拉平时间，避免用户名枚举
    return null;
  }
  return verifyPassword(password, u.password_hash) ? u : null;
}

/** 邀请码 + 用户名唯一性在同一事务里落定，避免并发抢码 */
export function registerWithInvite(
  code: string,
  username: string,
  password: string,
): { ok: true; user: UserRow } | { ok: false; reason: 'invite' | 'taken' } {
  const name = username.trim().toLowerCase();
  return tx(() => {
    const claimed = run(
      'UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)',
      '__pending__',
      nowIso(),
      code.trim().toUpperCase(),
      nowIso(),
    );
    if (claimed.changes !== 1) return { ok: false as const, reason: 'invite' as const };
    if (findUserByName(name)) {
      run("UPDATE invites SET used_by = NULL, used_at = NULL WHERE used_by = '__pending__'", );
      return { ok: false as const, reason: 'taken' as const };
    }
    const id = newUserId();
    run(
      'INSERT INTO users (id, username, password_hash, role, quota_per_day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      name,
      hashPassword(password),
      'user',
      config.PER_USER_DAILY_CALLS,
      nowIso(),
    );
    run("UPDATE invites SET used_by = ? WHERE used_by = '__pending__'", id);
    return { ok: true as const, user: findUser(id)! };
  });
}

export function createInvites(createdBy: string | null, n = 1): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const code = newInviteCode();
    run(
      'INSERT INTO invites (code, created_by, used_by, used_at, expires_at, created_at) VALUES (?, ?, NULL, NULL, NULL, ?)',
      code,
      createdBy,
      nowIso(),
    );
    codes.push(code);
  }
  return codes;
}

export function listInvites(): InviteRow[] {
  return all<InviteRow>('SELECT * FROM invites ORDER BY created_at DESC LIMIT 200');
}

export function updateUserQuota(id: string, quotaPerDay: number): void {
  run('UPDATE users SET quota_per_day = ? WHERE id = ?', quotaPerDay, id);
}
