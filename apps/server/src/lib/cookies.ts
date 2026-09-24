import { config } from '../config';
import { decodeParam } from './parse';

export const SESSION_COOKIE = 'rt_session';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeParam(v);
  }
  return out;
}

export function serializeSessionCookie(token: string, maxAgeSec: number): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config_secure()) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** 生产环境默认要求 Secure，开发环境允许 http://localhost；取值只认 config 一处 */
function config_secure(): boolean {
  return config.cookieSecure;
}
