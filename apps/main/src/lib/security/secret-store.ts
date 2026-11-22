import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { writeFileAtomic } from '@/lib/filesystem/atomic-write';

import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const secretDirectoryName = 'secrets';

export type SecretProtection = {
   isEncryptionAvailable: () => boolean;
   getSelectedStorageBackend: () =>
      | 'basic_text'
      | 'gnome_libsecret'
      | 'kwallet'
      | 'kwallet5'
      | 'kwallet6'
      | 'unknown'
      | 'android_keystore'
      | 'keychain';
   encryptString: (plainText: string) => Buffer;
   decryptString: (encrypted: Buffer) => string;
};

export type SecretStoreAvailability =
   | { available: true }
   | { available: false; reason: 'encryption-unavailable' | 'insecure-backend' | 'unsupported-platform' };

type SecretStoreOptions = {
   dataPath: string;
   platform: NodeJS.Platform;
   protection: SecretProtection;
   allowBasicText?: boolean;
};

export type SecretStore = ReturnType<typeof createSecretStore>;

export function createSecretStore(options: SecretStoreOptions) {
   const directoryPath = join(options.dataPath, secretDirectoryName);

   function getAvailability(): SecretStoreAvailability {
      if (!options.protection.isEncryptionAvailable()) {
         return {
            available: false,
            reason: 'encryption-unavailable'
         };
      }

      if (options.platform === 'android') {
         if (options.protection.getSelectedStorageBackend() !== 'android_keystore') {
            return { available: false, reason: 'insecure-backend' };
         }
      } else if (options.platform === 'linux') {
         const backend = options.protection.getSelectedStorageBackend();
         if (backend === 'unknown' || (backend === 'basic_text' && !options.allowBasicText)) {
            return {
               available: false,
               reason: 'insecure-backend'
            };
         }
      } else if (options.platform !== 'darwin' && options.platform !== 'win32') {
         return {
            available: false,
            reason: 'unsupported-platform'
         };
      }

      return { available: true };
   }

   async function read(key: string): Promise<Result<string | null, Problem>> {
      const availability = getAvailability();
      if (!availability.available) return Result.err(createProblem('secret-store.unavailable', { cause: availability.reason }));

      const secretPath = pathForKey(directoryPath, key);
      const encrypted = await Result.tryPromise({
         try: () => readFile(secretPath),
         catch: (cause) => createProblem('secret-store.read-failed', { cause })
      });
      if (Result.isError(encrypted)) return encrypted.error.detail === 'ENOENT' ? Result.ok(null) : Result.err(encrypted.error);

      return Result.try({
         try: () => options.protection.decryptString(encrypted.value),
         catch: (cause) => createProblem('secret-store.decrypt-failed', { cause })
      });
   }

   async function write(key: string, value: string): Promise<Result<void, Problem>> {
      const availability = getAvailability();
      if (!availability.available) return Result.err(createProblem('secret-store.unavailable', { cause: availability.reason }));

      const secretPath = pathForKey(directoryPath, key);
      const encrypted = Result.try({
         try: () => options.protection.encryptString(value),
         catch: (cause) => createProblem('secret-store.write-failed', { cause })
      });
      if (Result.isError(encrypted)) return Result.err(encrypted.error);

      const written = await writeFileAtomic(secretPath, encrypted.value, { dirMode: 0o700, fileMode: 0o600 });
      return written.mapError((error) => createProblem('secret-store.write-failed', { cause: error.detail ?? error.message }));
   }

   async function remove(key: string) {
      const secretPath = pathForKey(directoryPath, key);
      return Result.tryPromise({
         try: () => rm(secretPath, { force: true }),
         catch: (cause) => createProblem('secret-store.remove-failed', { cause })
      });
   }

   return {
      getAvailability,
      read,
      write,
      remove
   };
}

function pathForKey(directoryPath: string, key: string) {
   const digest = createHash('sha256').update(key).digest('hex');
   return join(directoryPath, `${digest}.secret`);
}
