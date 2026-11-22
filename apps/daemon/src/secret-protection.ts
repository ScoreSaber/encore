import type { SecretProtection } from '@/lib/security/secret-store';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function createDaemonSecretProtection(key: Buffer, backend: 'android_keystore' | 'keychain'): SecretProtection {
   if (key.byteLength !== 32) throw new Error('Native secure storage returned an invalid key');

   return {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => backend,
      encryptString: (plainText) => {
         const nonce = randomBytes(12);
         const cipher = createCipheriv('aes-256-gcm', key, nonce);
         const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
         return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
      },
      decryptString: (encrypted) => {
         if (encrypted.byteLength < 28) throw new Error('Stored secret is invalid');
         const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
         decipher.setAuthTag(encrypted.subarray(12, 28));
         return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8');
      }
   };
}
