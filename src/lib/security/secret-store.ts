import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const secretDirectoryName = 'secrets';

export type SecretProtection = {
   isEncryptionAvailable: () => boolean;
   getSelectedStorageBackend: () => 'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown';
   encryptString: (plainText: string) => Buffer;
   decryptString: (encrypted: Buffer) => string;
};

export type SecretStoreAvailability =
   | { available: true }
   | { available: false; reason: 'encryption-unavailable' | 'insecure-backend' | 'unsupported-platform' };

export type SecretStoreProblem = {
   code: 'secret-store.unavailable' | 'secret-store.read-failed' | 'secret-store.write-failed' | 'secret-store.remove-failed';
   message: string;
   operation: 'read' | 'write' | 'remove';
   detail?: string;
};

type SecretStoreOptions = {
   dataPath: string;
   platform: NodeJS.Platform;
   protection: SecretProtection;
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

      if (options.platform === 'linux') {
         const backend = options.protection.getSelectedStorageBackend();
         if (backend === 'basic_text' || backend === 'unknown') {
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

   async function read(key: string) {
      const availability = getAvailability();
      if (!availability.available) {
         return Result.err<string | null, SecretStoreProblem>(unavailableProblem('read', availability));
      }

      const secretPath = pathForKey(directoryPath, key);
      const encrypted = await Result.tryPromise({
         try: () => readFile(secretPath),
         catch: (cause) => createSecretStoreProblem('secret-store.read-failed', 'failed to read encrypted secret', 'read', cause)
      });
      if (Result.isError(encrypted)) {
         if (encrypted.error.detail === 'ENOENT') return Result.ok<string | null, SecretStoreProblem>(null);
         return Result.err<string | null, SecretStoreProblem>(encrypted.error);
      }

      return Result.try({
         try: () => options.protection.decryptString(encrypted.value),
         catch: (cause) => createSecretStoreProblem('secret-store.read-failed', 'failed to decrypt secret', 'read', cause)
      });
   }

   async function write(key: string, value: string) {
      const availability = getAvailability();
      if (!availability.available) {
         return Result.err<void, SecretStoreProblem>(unavailableProblem('write', availability));
      }

      const secretPath = pathForKey(directoryPath, key);
      const temporaryPath = join(directoryPath, `.${randomUUID()}.tmp`);
      const written = await Result.tryPromise({
         try: async () => {
            const encrypted = options.protection.encryptString(value);
            await mkdir(directoryPath, { recursive: true, mode: 0o700 });
            await writeFile(temporaryPath, encrypted, { mode: 0o600 });
            await rename(temporaryPath, secretPath);
         },
         catch: (cause) => createSecretStoreProblem('secret-store.write-failed', 'failed to persist encrypted secret', 'write', cause)
      });

      if (Result.isError(written)) await removeTemporaryFile(temporaryPath);
      return written;
   }

   async function remove(key: string) {
      const secretPath = pathForKey(directoryPath, key);
      return Result.tryPromise({
         try: () => rm(secretPath, { force: true }),
         catch: (cause) => createSecretStoreProblem('secret-store.remove-failed', 'failed to remove encrypted secret', 'remove', cause)
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

function unavailableProblem(
   operation: SecretStoreProblem['operation'],
   availability: Exclude<SecretStoreAvailability, { available: true }>
): SecretStoreProblem {
   return {
      code: 'secret-store.unavailable',
      message: 'secure secret persistence is unavailable',
      operation,
      detail: availability.reason
   };
}

function createSecretStoreProblem(
   code: SecretStoreProblem['code'],
   message: string,
   operation: SecretStoreProblem['operation'],
   cause: unknown
): SecretStoreProblem {
   return {
      code,
      message,
      operation,
      detail: causeCode(cause)
   };
}

async function removeTemporaryFile(path: string) {
   await Result.tryPromise({
      try: () => rm(path, { force: true }),
      catch: (cause) => cause
   });
}
