/**
 * auth.ts — авторизация админки (ОДНА роль). Механизм строит агент, СЕКРЕТ заводит
 * человек (CLAUDE.md §2). Агент НЕ создаёт пароли/секреты и НЕ коммитит .env.
 *
 * Env (кладёт Антон в web/.env):
 *  - ADMIN_USER            — логин (необязателен; дефолт 'admin').
 *  - ADMIN_PASSWORD_HASH   — scrypt-хэш пароля в формате 'scrypt$<saltHex>$<hashHex>'
 *                            (генерит web/scripts/hash-password.mjs).
 *  - SESSION_SECRET        — секрет для подписи сессионной cookie (длинная случайная строка).
 *
 * Если ADMIN_PASSWORD_HASH или SESSION_SECRET не заданы — админка отдаёт 503
 * «настройте доступ», НЕ падает; публичный сайт работает (isAuthConfigured()=false).
 *
 * Сессия — подписанная httpOnly+SameSite cookie. Значение: '<payloadB64>.<hmacB64url>',
 * payload = JSON {u, exp}. Подпись HMAC-SHA256 на SESSION_SECRET, сравнение
 * timing-safe. Никаких ПДн в cookie, только логин и срок.
 */
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'mst_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 часов

export function getAdminUser(): string {
  return (process.env.ADMIN_USER?.trim() || 'admin');
}

function getPasswordHash(): string | undefined {
  return process.env.ADMIN_PASSWORD_HASH?.trim() || undefined;
}

function getSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET?.trim() || undefined;
}

/** Настроена ли авторизация (есть хэш пароля и секрет сессии). */
export function isAuthConfigured(): boolean {
  return Boolean(getPasswordHash() && getSessionSecret());
}

/** Хэширует пароль scrypt → строка 'scrypt$<saltHex>$<hashHex>' (для hash-password.mjs). */
export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Проверяет пароль против хранимого scrypt-хэша (timing-safe). */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Проверяет логин+пароль против env. Возвращает true только если авторизация
 * настроена И пароль верный И логин совпал.
 */
export function checkCredentials(user: string, password: string): boolean {
  const hash = getPasswordHash();
  if (!hash || !getSessionSecret()) return false;
  if ((user || '').trim() !== getAdminUser()) return false;
  return verifyPassword(password, hash);
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest());
}

/** Выпускает подписанное значение сессионной cookie. */
export function issueSession(user: string): string {
  const secret = getSessionSecret();
  if (!secret) throw new Error('SESSION_SECRET not configured');
  const payload = { u: user, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Проверяет подпись и срок cookie. Возвращает {u} или null. */
export function verifySession(value: string | undefined): { u: string } | null {
  if (!value) return null;
  const secret = getSessionSecret();
  if (!secret) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return { u: String(payload.u) };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  path: '/' as const,
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};
