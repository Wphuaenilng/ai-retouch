import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { err } from '../lib/errors';
import { take } from '../lib/ratelimit';
import { verifyToken, type SessionClaims } from '../lib/jwt';
import { parseCookies, SESSION_COOKIE } from '../lib/cookies';
import { findUser } from '../store/users';

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionClaims | null;
  }
}

export async function authPreHandler(req: FastifyRequest): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  req.session = token ? await verifyToken(token) : null;
}

export function requireUser(req: FastifyRequest): SessionClaims {
  if (!req.session) throw err('UNAUTHORIZED', '登录状态已过期，请重新登录');
  const user = findUser(req.session.sub);
  if (!user) throw err('UNAUTHORIZED', '账号已不存在');
  return req.session;
}

export function requireAdmin(req: FastifyRequest): SessionClaims {
  const s = requireUser(req);
  if (s.role !== 'admin') throw err('FORBIDDEN', '需要管理员权限');
  return s;
}

/** 统一的限流入口；超限直接抛 429 */
export function limit(req: FastifyRequest, name: string, max: number, windowMs: number): void {
  const key = `${name}:${req.session?.sub ?? req.ip}`;
  const r = take(key, max, windowMs);
  if (!r.ok) throw err('QUOTA_EXCEEDED', `操作太频繁，${r.retryAfterSec}s 后再试`);
}

/** Fastify v5 默认没给 params 类型，路由里统一走这个窄化 */
export function p(req: FastifyRequest): Record<string, string> {
  return req.params as Record<string, string>;
}

export function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-store');
}

export type Route = (app: FastifyInstance) => void | Promise<void>;
