import type { MeDTO } from '@retouch/shared';
import { err } from '../lib/errors';
import { signToken, verifyToken, type SessionClaims } from '../lib/jwt';
import { checkCredentials, findUser, registerWithInvite, type UserRow } from '../store/users';
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

export async function login(username: string, password: string): Promise<{ me: MeDTO; token: string }> {
  const user = checkCredentials(username, password);
  if (!user) throw err('BAD_CREDENTIALS', '用户名或密码不对');
  return { me: toMe(user), token: await signToken({ sub: user.id, username: user.username, role: user.role }) };
}

export async function register(
  inviteCode: string,
  username: string,
  password: string,
): Promise<{ me: MeDTO; token: string }> {
  const name = (username ?? '').trim().toLowerCase();
  if (!USERNAME.test(name)) throw err('BAD_REQUEST', '用户名 3-24 位，只能用小写字母、数字、_ . -');
  if ((password ?? '').length < 8) throw err('BAD_REQUEST', '密码至少 8 位');
  const r = registerWithInvite(inviteCode, name, password);
  if (!r.ok) {
    throw r.reason === 'invite'
      ? err('INVITE_INVALID', '邀请码无效或已被使用')
      : err('USERNAME_TAKEN', '这个用户名已经被占了');
  }
  return { me: toMe(r.user), token: await signToken({ sub: r.user.id, username: r.user.username, role: r.user.role }) };
}

export function meFromClaims(claims: SessionClaims): MeDTO | null {
  const user = findUser(claims.sub);
  return user ? toMe(user) : null;
}

export { verifyToken };
