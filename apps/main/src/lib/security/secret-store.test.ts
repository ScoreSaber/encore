import { afterEach, expect, test } from 'vite-plus/test';

import { createSecretStore, type SecretProtection } from '@/lib/security/secret-store';

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

test('refuses plaintext backends and persists only encrypted payloads', async () => {
   const insecurePath = await createTempRoot();
   const insecure = createSecretStore({ dataPath: insecurePath, platform: 'linux', protection: createTestProtection('basic_text') });

   expect(insecure.getAvailability()).toEqual({ available: false, reason: 'insecure-backend' });
   expect(await insecure.write('account:token', 'plain-token')).toMatchObject({ status: 'error', error: { code: 'secret-store.unavailable' } });
   expect(await readdir(insecurePath)).toEqual([]);

   const dataPath = await createTempRoot();
   const store = createSecretStore({ dataPath, platform: 'linux', protection: createTestProtection('gnome_libsecret') });
   (await store.write('receiver:controller', 'plain-token')).unwrap();
   const [entry] = await readdir(join(dataPath, 'secrets'));
   if (!entry) throw new Error('secret file was not written');

   expect(await readFile(join(dataPath, 'secrets', entry), 'utf8')).not.toContain('plain-token');
   expect((await store.read('receiver:controller')).unwrap()).toBe('plain-token');
});

async function createTempRoot() {
   const tempRoot = await mkdtemp(join(tmpdir(), 'encore-secrets-'));
   tempRoots.push(tempRoot);
   return tempRoot;
}

function createTestProtection(backend: ReturnType<SecretProtection['getSelectedStorageBackend']>): SecretProtection {
   return {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => backend,
      encryptString: (plainText) => Buffer.from(`protected:${Buffer.from(plainText).toString('base64')}`),
      decryptString: (encrypted) => Buffer.from(encrypted.toString().slice('protected:'.length), 'base64').toString()
   };
}
