import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createSecretStore, type SecretProtection, type SecretStoreAvailability } from '@/lib/security/secret-store';

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];
type SecretBackend = ReturnType<SecretProtection['getSelectedStorageBackend']>;
type SecretUnavailableReason = Extract<SecretStoreAvailability, { available: false }>['reason'];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('secret store', () => {
   const unavailableCases: [NodeJS.Platform, boolean, SecretBackend, SecretUnavailableReason][] = [
      ['darwin', false, 'gnome_libsecret', 'encryption-unavailable'],
      ['linux', true, 'basic_text', 'insecure-backend']
   ];

   test('fails closed without secure OS storage', async () => {
      for (const [platform, available, backend, reason] of unavailableCases) {
         const dataPath = await createTempRoot();
         const store = createSecretStore({ dataPath, platform, protection: createTestProtection({ available, backend }) });

         const written = await store.write('account:token', 'plain-token');

         expect(store.getAvailability()).toEqual({ available: false, reason });
         expect(written).toMatchObject({ status: 'error', error: { code: 'secret-store.unavailable' } });
         expect(await readdir(dataPath)).toEqual([]);
      }
   });

   test('stores only encrypted opaque payloads outside settings', async () => {
      const dataPath = await createTempRoot();
      const store = createSecretStore({ dataPath, platform: 'linux', protection: createTestProtection() });

      const written = await store.write('receiver:controller', 'plain-token');
      const entries = await readdir(join(dataPath, 'secrets'));
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (!entry) throw new Error('secret file was not written');
      const persisted = await readFile(join(dataPath, 'secrets', entry), 'utf8');
      const read = await store.read('receiver:controller');

      written.unwrap();
      expect(entries[0]).toMatch(/^[a-f0-9]{64}\.secret$/);
      expect(persisted).not.toContain('plain-token');
      expect(read.unwrap()).toBe('plain-token');
   });
});

async function createTempRoot() {
   const tempRoot = await mkdtemp(join(tmpdir(), 'encore-secrets-'));
   tempRoots.push(tempRoot);
   return tempRoot;
}

function createTestProtection({
   available = true,
   backend = 'gnome_libsecret'
}: { available?: boolean; backend?: ReturnType<SecretProtection['getSelectedStorageBackend']> } = {}): SecretProtection {
   return {
      isEncryptionAvailable: () => available,
      getSelectedStorageBackend: () => backend,
      encryptString: (plainText) => Buffer.from(`protected:${Buffer.from(plainText).toString('base64')}`),
      decryptString: (encrypted) => Buffer.from(encrypted.toString().slice('protected:'.length), 'base64').toString()
   };
}
