/**
 * 会话吊销与角色时效：以前 role 直接取自 JWT，降级要等 30 天 token 过期才生效；
 * 退出登录也只是清 cookie，token 本身仍然可用。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

// 必须在 import 任何 repo 模块之前定好路径：db/index 一被加载就会打开 SQLITE_PATH
const dir = mkdtempSync(join(tmpdir(), 'rt-session-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 's.db');
process.env.DATA_DIR = join(dir, 'data');

const { get, run, closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const { verifyToken } = await import('../src/lib/jwt');
const auth = await import('../src/services/auth');
const users = await import('../src/store/users');

migrate();
users.createInvites(null, 6);

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function signUp(username: string, password = 'good-pass-123'): Promise<string> {
  const inv = get<{ code: string }>('SELECT code FROM invites WHERE used_by IS NULL LIMIT 1')?.code ?? '';
  const r = await auth.register(inv, username, password);
  return r.token;
}

describe('会话吊销', () => {
  it('登录签出的 token 带版本号，且当时有效', async () => {
    const claims = await verifyToken(await signUp('alice'));
    assert.ok(claims, 'token 应该能验过');
    assert.equal(claims.tv, 0);
    assert.equal(auth.sessionValid(claims).username, 'alice');
  });

  it('logout 之后旧 token 立刻失效', async () => {
    const claims = (await verifyToken(await signUp('bob')))!;
    auth.sessionValid(claims); // 先确认可用
    auth.logout(claims.sub);
    assert.throws(() => auth.sessionValid(claims), /已失效/);
  });

  it('改密会吊销所有会话，旧密码不再能用', async () => {
    const claims = (await verifyToken(await signUp('carol')))!;
    assert.throws(() => auth.changePassword(claims.sub, 'wrong-pass', 'new-pass-123'), /当前密码不对/);
    auth.changePassword(claims.sub, 'good-pass-123', 'new-pass-123');
    assert.throws(() => auth.sessionValid(claims), /已失效/);
    await assert.rejects(auth.login('carol', 'good-pass-123'), /用户名或密码不对/);
    const again = await auth.login('carol', 'new-pass-123');
    assert.ok(again.token);
  });

  it('角色以库为准：升降级都马上生效，不认 token 里的旧值', async () => {
    const claims = (await verifyToken(await signUp('dave')))!;
    assert.equal(auth.sessionValid(claims).role, 'user');
    run("UPDATE users SET role = 'admin' WHERE id = ?", claims.sub);
    assert.equal(auth.sessionValid(claims).role, 'admin');
    run("UPDATE users SET role = 'user' WHERE id = ?", claims.sub);
    assert.equal(auth.sessionValid(claims).role, 'user');
  });

  it('改动前签发的旧 token（没有版本号）一律拒绝', async () => {
    const claims = { ...(await verifyToken(await signUp('erin')))! } as Record<string, unknown>;
    delete claims.tv;
    assert.throws(() => auth.sessionValid(claims as never), /已失效/);
    assert.equal(users.bumpTokenVersion(claims.sub as string), 1);
  });
});
