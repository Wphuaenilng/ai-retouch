import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { clearSessionCookie, serializeSessionCookie, SESSION_COOKIE } from '../lib/cookies';
import { err } from '../lib/errors';
import { strParam } from '../lib/parse';
import { deleteAccount } from '../services/accounts';
import { changePassword, login, logout, meFromClaims, register } from '../services/auth';
import { setConsent } from '../store/users';
import { limit, requireUser } from './_http';

const MAX_AGE = 30 * 24 * 3600;

const registerBody = z.object({
  inviteCode: z.string().min(4).max(32),
  username: z.string().min(3).max(24),
  password: z.string().min(8).max(128),
});
const loginBody = z.object({ username: z.string().min(1).max(24), password: z.string().min(1).max(128) });

export function authRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', async (req, reply) => {
    limit(req, 'register', 10, 60_000);
    const p = registerBody.safeParse(req.body);
    if (!p.success) throw err('BAD_REQUEST', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'));
    const { me, token } = await register(p.data.inviteCode, p.data.username, p.data.password);
    reply.header('set-cookie', serializeSessionCookie(token, MAX_AGE));
    return { ok: true, data: { me } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    limit(req, 'login', 20, 60_000);
    const p = loginBody.safeParse(req.body);
    if (!p.success) throw err('BAD_REQUEST', '用户名与密码都要填');
    const { me, token } = await login(p.data.username, p.data.password);
    reply.header('set-cookie', serializeSessionCookie(token, MAX_AGE));
    return { ok: true, data: { me } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const s = requireUser(req);
    logout(s.sub); // 让这颗 token 立刻作废，而不只是清 cookie
    reply.header('set-cookie', clearSessionCookie());
    return { ok: true, data: { loggedOut: true } };
  });

  const passwordBody = z.object({ current: z.string().min(1).max(128), next: z.string().min(8).max(128) });

  app.post('/api/auth/password', async (req, reply) => {
    const s = requireUser(req);
    limit(req, 'password', 5, 60_000);
    const p = passwordBody.safeParse(req.body ?? {});
    if (!p.success) throw err('BAD_REQUEST', '新密码至少 8 位');
    changePassword(s.sub, p.data.current, p.data.next);
    // 改密会吊销所有会话（包括这一个），所以要重新登录
    reply.header('set-cookie', clearSessionCookie());
    return { ok: true, data: { changed: true, reloginRequired: true } };
  });

  app.get('/api/me', async (req) => {
    const s = requireUser(req);
    const me = meFromClaims(s);
    if (!me) throw err('UNAUTHORIZED', '账号已不存在');
    return { ok: true, data: { me } };
  });

  // 隐私告知：确认过一次就记在账号上（换浏览器也要重新确认，所以不能只存前端）
  app.post('/api/consent', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { consentAt: setConsent(s.sub) } };
  });

  // 注销账号：不可撤销，所以要再报一次密码；成功后会话立刻作废
  app.delete('/api/me', async (req, reply) => {
    const s = requireUser(req);
    limit(req, 'delete-account', 3, 300_000);
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = strParam(body.username, { name: 'username', max: 24 });
    const password = strParam(body.password, { name: 'password', max: 128 });
    if (!username || !password) throw err('BAD_REQUEST', '注销要填用户名与密码确认');
    const r = await deleteAccount(s.sub, username, password);
    reply.header('set-cookie', clearSessionCookie());
    return { ok: true, data: { deleted: true, files: r.files } };
  });

  app.get('/api/config', async () => ({
    ok: true,
    data: {
      perUserDailyCalls: config.PER_USER_DAILY_CALLS,
      maxUploadMb: config.MAX_UPLOAD_MB,
      editCopyMaxEdge: config.EDIT_COPY_MAX_EDGE,
      planner: config.LLM_PLAN_PROVIDER,
      cookieSecure: config.cookieSecure,
    },
  }));
}

export { SESSION_COOKIE };
