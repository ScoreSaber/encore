import { Result } from 'better-result';
import { z } from 'zod';

import appPackage from '../../main/package.json';
import { createQuestDaemon } from './daemon';
import { createMobileCore } from './mobile-core';
import { createDaemonSecretProtection } from './secret-protection';

import { createProblem } from '@/lib/errors';
import { createSecretStore } from '@/lib/security/secret-store';

import { webcrypto } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const cliSettingsSchema = z.object({
   dataPath: z.string(),
   host: z.string().default('127.0.0.1'),
   port: z.coerce.number().int().min(1).max(65_535).default(5555),
   receiverHost: z.string().default('0.0.0.0'),
   receiverPort: z.coerce.number().int().min(1).max(65_535).default(38_567)
});

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true, configurable: true });

void Result.tryPromise({
   try: run,
   catch: (cause) => createProblem('daemon.start-failed', { cause })
}).then((result) => {
   const completed = Result.flatten(result);
   if (Result.isError(completed)) {
      const { message, detail } = completed.error;
      process.stderr.write(`${detail ? `${message}: ${detail}` : message}\n`);
      process.exitCode = 1;
   }
});

async function run() {
   const parsed = cliSettingsSchema.safeParse({
      dataPath: resolve(process.env.ENCORE_DATA_PATH ?? resolve(homedir(), '.encore-daemon')),
      host: process.env.ENCORE_ADB_HOST,
      port: process.env.ENCORE_ADB_PORT,
      receiverHost: process.env.ENCORE_RECEIVER_HOST,
      receiverPort: process.env.ENCORE_RECEIVER_PORT
   });
   if (!parsed.success) return Result.err(createProblem('daemon.invalid-config'));
   const config = parsed.data;
   const key = process.env.ENCORE_SECRET_KEY;
   const secretStore = createSecretStore({
      dataPath: config.dataPath,
      platform: 'android',
      protection: key
         ? createDaemonSecretProtection(Buffer.from(key, 'base64'), 'android_keystore')
         : {
              isEncryptionAvailable: () => false,
              getSelectedStorageBackend: () => 'unknown',
              encryptString: () => Buffer.alloc(0),
              decryptString: () => ''
           }
   });
   const core = createMobileCore({ dataPath: config.dataPath, appVersion: appPackage.version, platform: 'android', secretStore });
   const daemon = createQuestDaemon(core, { endpoint: { host: config.host, port: config.port } });
   const started = await Result.tryPromise({
      try: async () => {
         await daemon.start();
         const settings = await core.settingsStore.updateAppSettings({
            receiver: { enabled: true, bindHost: config.receiverHost, port: config.receiverPort }
         });
         if (!settings.ok) return Result.err(settings.error);
         const listening = await daemon.receiver.start();
         if (Result.isError(listening)) return Result.err(listening.error);
         const pairing = daemon.receiver.startPairing();
         if (Result.isError(pairing)) return Result.err(pairing.error);
         process.stdout.write(
            JSON.stringify({ addresses: listening.value.addresses, fingerprint: listening.value.identity?.fingerprint, pairing: pairing.value }) +
               '\n'
         );
         return Result.ok(undefined);
      },
      catch: (cause) => createProblem('daemon.start-failed', { cause })
   }).then(Result.flatten);
   if (Result.isError(started)) {
      await daemon.stop();
      return started;
   }
   let stopping = false;
   const stop = () => {
      if (stopping) return;
      stopping = true;
      void daemon.stop();
   };
   process.once('SIGTERM', stop);
   process.once('SIGINT', stop);
   return Result.ok(undefined);
}
