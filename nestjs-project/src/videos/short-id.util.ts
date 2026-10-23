import { randomBytes } from 'node:crypto';

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const SHORT_ID_LENGTH = 11;
export const SHORT_ID_PATTERN = /^[0-9A-Za-z]{11}$/;

// Largest multiple of 62 that fits in a byte; bytes above it are discarded so
// every symbol is equally likely (no modulo bias).
const MAX_UNBIASED_BYTE = 256 - (256 % ALPHABET.length);

export function generateShortId(): string {
  let id = '';
  while (id.length < SHORT_ID_LENGTH) {
    for (const byte of randomBytes(SHORT_ID_LENGTH * 2)) {
      if (byte >= MAX_UNBIASED_BYTE) continue;
      id += ALPHABET[byte % ALPHABET.length];
      if (id.length === SHORT_ID_LENGTH) break;
    }
  }
  return id;
}
