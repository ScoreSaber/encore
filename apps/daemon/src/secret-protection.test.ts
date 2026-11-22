import { describe, expect, test } from 'vite-plus/test';

import { createDaemonSecretProtection } from './secret-protection';

import { randomBytes } from 'node:crypto';

describe('native-backed daemon secrets', () => {
   test('encrypts with a fresh nonce and authenticates the ciphertext and key', () => {
      const protection = createDaemonSecretProtection(randomBytes(32), 'android_keystore');
      const first = protection.encryptString('receiver token');
      const second = protection.encryptString('receiver token');
      expect(first).not.toEqual(second);
      expect(first.includes('receiver token')).toBe(false);
      expect(protection.decryptString(first)).toBe('receiver token');
      expect(() => createDaemonSecretProtection(randomBytes(32), 'android_keystore').decryptString(first)).toThrow();
      first[28] = (first[28] ?? 0) ^ 1;
      expect(() => protection.decryptString(first)).toThrow();
   });
});
