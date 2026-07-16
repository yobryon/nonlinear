import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return expected.length === derived.length && timingSafeEqual(derived, expected);
}
