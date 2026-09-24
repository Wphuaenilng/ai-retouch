import type { MeDTO } from '@retouch/shared';
import { err } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/password';
import { signToken, verifyToken, type SessionClaims } from '../lib/jwt';
import { bumpTokenVersion, checkCredentials, findUser, registerWithInvite, setPassword, type UserRow } from '../store/users';
import { getQuota } from './quota';

const USERNAME = /^[a-z0-9_.-]{3,24}$/;

export function toMe(user: UserRow): MeDTO {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    quota: getQuota(user.id),
    createdAt: user.created_at,
  };
}

function issueToken(user: UserRow): Promise<string> {
  return signToken({ sub: user.id, username: user.username, role: user.role, tv: user.token_version });
}

/**
 * 会话是否还有效：账号还在、且 token 里的版本号和库里一致。
 * 角色一律以库为准 —— 以前直接信 JWT 里的 role，被降级的人在 30 天有效期内还是管理员。
 */
export function sessionValid(claims: SessionClaims): UserRow {
  const user = findUser(claims.sub);
  if (!user) throw err('UNAUTHORIZED', '账号已不存在');
  if (claims.tv !== user.token_version) throw err('UNAUTHORIZED', '登录状态已失效，请重新登录');
  return user;
}

export async function login(username: string, password: string): Promise<{ me: MeDTO; token: string }> {
  const user = checkCredentials(username, password);
  if (!user) throw err('BAD_CREDENTIALS', '用户名或密码不对');
  return { me: toMe(user), token: await issueToken(user) };
}

export async function register(inviteCode: string, username: string, password: string): Promise<{ me: MeDTO; token: string }> {
  const name = (username ?? '').trim().toLowerCase();
  if (!USERNAME.test(name)) throw err('BAD_REQUEST', '用户名 3-24 位，只能用小写字母、数字、_ . -');
  if ((password ?? '').length < 8) throw err('BAD_REQUEST', '密码至少 8 位');
  const r = registerWithInvite(inviteCode, name, password);
  if (!r.ok) {
    throw r.reason === 'taken'
      ? err('USERNAME_TAKEN', '这个用户名已经被占了')
      : err('INVITE_INVALID', r.reason === 'expired' ? '这个邀请码已经过期了，找管理员要一个新的' : '邀请码无效或已被使用');
  }
  return { me: toMe(r.user), token: await issueToken(r.user) };
}

/** 退出：把版本号推一格，之前签发的 cookie 立刻失效（以前只是清 cookie，token 自己还能用 30 天） */
export function logout(userId: string): void {
  bumpTokenVersion(userId);
}

/** 改密：验证旧密码，写新哈希并吊销所有会话 */
export function changePassword(userId: string, current: string, next: string): void {
  if (typeof next !== 'string' || next.length < 8 || next.length > 128) {
    throw err('BAD_REQUEST', '新密码至少 8 位、最长 128 位');
  }
  const user = findUser(userId);
  if (!user) throw err('UNAUTHORIZED', '账号已不存在');
  if (!verifyPassword(typeof current === 'string' ? current : '', user.password_hash)) {
    throw err('BAD_CREDENTIALS', '当前密码不对');
  }
  setPassword(userId, hashPassword(next));
  bumpTokenVersion(userId);
}

export function meFromClaims(claims: SessionClaims): MeDTO | null {
  const user = findUser(claims.sub);
  return user ? toMe(user) : null;
}

export { verifyToken };
