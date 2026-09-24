import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config';

const secret = new TextEncoder().encode(config.JWT_SECRET);
export const SESSION_DAYS = '30d';

export interface SessionClaims extends JWTPayload {
  sub: string;
  username: string;
  role: 'user' | 'admin';
  /** 签发时的用户会话版本号；与库里的不一致就说明这个 token 已被吊销 */
  tv: number;
}

export function signToken(claims: Omit<SessionClaims, keyof JWTPayload>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience('retouch-web')
    .setExpirationTime(SESSION_DAYS)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { audience: 'retouch-web' });
    return payload as SessionClaims;
  } catch {
    return null;
  }
}
