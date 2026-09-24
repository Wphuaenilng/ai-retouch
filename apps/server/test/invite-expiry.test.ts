/**
 * 邀请码期限（D11 of 05 / 任务 5.11）。
 * `invites.expires_at` 一直躺在 schema 里从没被写过值，认领侧的 SQL 认它，
 * 于是所有码实际上永不过期。这里钉住三件事：造码真的写期限、过期的码进不来、
 * 失败原因分得清"过期"和"已被别人用掉"。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rt-invite-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'inv.db');
process.env.DATA_DIR = join(dir, 'data');

const { db, closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const { createInvites, registerWithInvite } = await import('../src/store/users');

migrate();

after(() => {
  // Windows 上库里还留着句柄时 rmSync 会 EBUSY，必须先关
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const expiresOf = (code: string): string | null =>
  (db.prepare('SELECT expires_at FROM invites WHERE code = ?').get(code) as { expires_at: string | null }).expires_at;

/** 用户名每次换一个：registerWithInvite 也管用户名唯一，复用会先撞到 taken */
let seq = 0;
const name = (): string => `inv_${(seq += 1)}_${Date.now().toString(36)}`;

describe('造码', () => {
  it('默认带 30 天期限，0 表示不限期', () => {
    const [d30] = createInvites('seed', 1);
    const [forever] = createInvites('seed', 1, 0);
    const exp = expiresOf(d30);
    assert.ok(exp, '默认应当写出 expires_at');
    const days = (new Date(exp).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 29 && days < 31, `期限应约 30 天，实得 ${days}`);
    assert.equal(expiresOf(forever), null);
  });
});

describe('认领', () => {
  it('期限内的码能注册', () => {
    const [code] = createInvites('seed', 1, 30);
    const r = registerWithInvite(code, name(), 'pw-1234567890');
    assert.equal(r.ok, true);
  });

  it('过期的码进不来，原因写的是 expired 而不是含糊的"无效"', () => {
    const [code] = createInvites('seed', 1, 30);
    db.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run('2020-01-01T00:00:00.000Z', code);
    const r = registerWithInvite(code, name(), 'pw-1234567890');
    assert.deepEqual(r, { ok: false, reason: 'expired' });
    // 过期不等于作废：码还留着，只是不能再被认领
    assert.equal((db.prepare('SELECT used_by FROM invites WHERE code = ?').get(code) as { used_by: string | null }).used_by, null);
  });

  it('已被用掉的码与不存在的码分别报 used / invite', () => {
    const [code] = createInvites('seed', 1, 0);
    assert.equal(registerWithInvite(code, name(), 'pw-1234567890').ok, true);
    assert.deepEqual(registerWithInvite(code, name(), 'pw-1234567890'), { ok: false, reason: 'used' });
    assert.deepEqual(registerWithInvite('NOPE1234', name(), 'pw-1234567890'), { ok: false, reason: 'invite' });
  });
});
