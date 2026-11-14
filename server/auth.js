import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

/** Signed, expiring session token: "<userId>.<expiresMs>.<signature>" */
export function makeToken(secret, userId, ttlMs = 7 * 24 * 3600 * 1000) {
  const body = `${userId}.${Date.now() + ttlMs}`;
  return `${body}.${sign(secret, body)}`;
}

export function readToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const good = sign(secret, `${id}.${exp}`);
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(id);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Tiny fixed-window rate limiter keyed by string. */
export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now > rec.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    rec.n += 1;
    return rec.n <= max;
  };
}
