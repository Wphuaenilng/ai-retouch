import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/**
 * 上游模型经常要求"可公网访问的图片地址"，而我们的 /api/images/:id 需要登录 Cookie。
 * 解法：给单个图片签发短期有效的签名 URL，带在查询串里，不暴露会话。
 */
const sig = (imageId: string) =>
  createHmac('sha256', config.JWT_SECRET).update(`img:${imageId}`).digest('base64url').slice(0, 32);

export function signedImageUrl(imageId: string, ttlHours = 6): string {
  const exp = Date.now() + ttlHours * 3600_000;
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/api/images/${imageId}?exp=${exp}&sig=${sig(`${imageId}.${exp}`)}`;
}

export function verifySignedImage(imageId: string, exp: string, provided: string): boolean {
  const t = Number(exp);
  if (!Number.isFinite(t) || t < Date.now()) return false;
  const want = sig(`${imageId}.${exp}`);
  const a = Buffer.from(want);
  const b = Buffer.from(provided ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
