/**
 * 账号注销（5.8c）。这是全应用唯一"删了就没有下一步"的操作，
 * 所以要钉住三件事：密码不对时**一点都不能动**、对了就**真的全清**（含磁盘目录）、
 * 别人的数据**不受牵连**。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { baseCanvas } from '@retouch/shared';
import { Rgba } from '../src/lib/png';

const dir = mkdtempSync(join(tmpdir(), 'rt-acct-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'a.db');
process.env.DATA_DIR = dir;

const { db, closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const { createInvites, registerWithInvite } = await import('../src/store/users');
const { saveImage } = await import('../src/services/images');
const { insertDocument } = await import('../src/store/documents');
const { deleteAccount } = await import('../src/services/accounts');

migrate();

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const PW = 'pw-1234567890';
const png = (): Buffer => new Rgba(16, 8, [20, 30, 40, 255]).toPng();
const n = (sql: string, ...args: (string | number | null)[]): number =>
  Number((db.prepare(sql).get(...args) as { n: number | bigint }).n);

/** 造一个带图、带项目、带账目的账号 */
async function makeUser(tag: string): Promise<{ id: string; name: string; imagePaths: string[] }> {
  const code = createInvites(null, 1, 0)[0];
  const name = `${tag}_${Date.now().toString(36)}`;
  const r = registerWithInvite(code, name, PW);
  if (!r.ok) throw new Error(`注册失败：${r.reason}`);
  const id = r.user.id;
  const paths: string[] = [];
  const a = await saveImage({ userId: id, kind: 'original', buf: png() });
  paths.push(a.path);
  insertDocument({ userId: id, title: tag, sourceImageId: a.id, canvas: baseCanvas(16, 8, a.id) });
  db.prepare(
    `INSERT INTO tasks (id, user_id, tool, status, progress, input, cost_yuan, attempts, charged, created_at)
     VALUES (?, ?, 'cutout', 'succeeded', 1, '{}', 0.03, 1, 1, ?)`,
  ).run(`tk_${tag}_${Date.now().toString(36)}`, id, new Date().toISOString());
  db.prepare('INSERT INTO usage_daily (user_id, date, ai_calls, cost_yuan) VALUES (?, ?, 1, 0.03)').run(id, '2026-09-24');
  return { id, name, imagePaths: paths };
}

describe('注销', () => {
  it('密码不对时什么都不会删', async () => {
    const u = await makeUser('badpw');
    await assert.rejects(
      () => deleteAccount(u.id, u.name, 'wrong-password-123'),
      (e: unknown) => (e as { code?: string }).code === 'BAD_CREDENTIALS',
    );
    assert.equal(n('SELECT COUNT(*) n FROM users WHERE id = ?', u.id), 1);
    assert.equal(n('SELECT COUNT(*) n FROM images WHERE user_id = ?', u.id), 1);
    assert.ok(existsSync(u.imagePaths[0]), '文件也该还在');
  });

  it('用户名对但密码是别人的，同样不行', async () => {
    const a = await makeUser('own');
    const b = await makeUser('other');
    await assert.rejects(
      () => deleteAccount(a.id, b.name, PW),
      (e: unknown) => (e as { code?: string }).code === 'BAD_CREDENTIALS',
    );
    assert.equal(n('SELECT COUNT(*) n FROM users WHERE id = ?', a.id), 1);
  });

  it('对了就真清：行、目录、当天账目都没了，别人不受牵连', async () => {
    const a = await makeUser('gone');
    const b = await makeUser('stays');
    const r = await deleteAccount(a.id, a.name, PW);
    assert.equal(r.files, 1);

    assert.equal(n('SELECT COUNT(*) n FROM users WHERE id = ?', a.id), 0);
    assert.equal(n('SELECT COUNT(*) n FROM images WHERE user_id = ?', a.id), 0);
    assert.equal(n('SELECT COUNT(*) n FROM documents WHERE user_id = ?', a.id), 0);
    assert.equal(n('SELECT COUNT(*) n FROM tasks WHERE user_id = ?', a.id), 0);
    assert.equal(n('SELECT COUNT(*) n FROM usage_daily WHERE user_id = ?', a.id), 0);
    // 目录整棵删掉，路径写法变过的孤儿文件也一起走
    assert.ok(!existsSync(join(dir, 'images', a.id)), `图片目录该没了：${a.id}`);

    assert.equal(n('SELECT COUNT(*) n FROM users WHERE id = ?', b.id), 1);
    assert.equal(n('SELECT COUNT(*) n FROM images WHERE user_id = ?', b.id), 1);
    assert.ok(existsSync(join(dir, 'images', b.id)));
  });

  it('注销者发过的邀请码留着，只是不再记创建人', async () => {
    const code = createInvites(null, 1, 0)[0];
    const u = await makeUser('issuer');
    db.prepare('UPDATE invites SET created_by = ? WHERE code = ?').run(u.id, code);
    await deleteAccount(u.id, u.name, PW);
    assert.equal(n('SELECT COUNT(*) n FROM invites WHERE code = ?', code), 1);
    assert.equal(
      (db.prepare('SELECT created_by FROM invites WHERE code = ?').get(code) as { created_by: string | null }).created_by,
      null,
    );
    // 码还能注册下一个人
    assert.equal(registerWithInvite(code, `after_${Date.now().toString(36)}`, PW).ok, true);
  });
});
