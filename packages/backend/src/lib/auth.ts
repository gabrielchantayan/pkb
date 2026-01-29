import bcrypt from 'bcrypt';
import crypto from 'crypto';

const BCRYPT_ROUNDS = 12;

export async function hash_password(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verify_password(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generate_session_token(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generate_api_key(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hash_api_key(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function constant_time_compare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
