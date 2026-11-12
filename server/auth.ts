/**
 * 认证:全部用 node:crypto 内置,零 npm 依赖。
 * - 密码:scrypt + 随机盐,存 "salt:hash"(hex)
 * - 令牌:HMAC-SHA256 签名的 payload.token,无状态
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../shared/types.ts';

const TOKEN_TTL = 12 * 3600 * 1000; // 12 小时

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const calc = scryptSync(plain, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
}

let SECRET = '';

export function setSecret(s: string) { SECRET = s; }

interface TokenPayload { uid: number; role: Role; exp: number }

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export function signToken(uid: number, role: Role): string {
  const payload: TokenPayload = { uid, role, exp: Date.now() + TOKEN_TTL };
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || !SECRET) return null;
  const expect = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (typeof payload.uid !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
