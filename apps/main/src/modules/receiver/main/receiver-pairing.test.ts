import { Result } from 'better-result';
import { afterEach, expect, test } from 'vite-plus/test';

import { createReceiverPairingController, maxAddressFailures, maxTrackedFailureAddresses } from '@/modules/receiver/main/receiver-pairing';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

test('pairing codes are single use and repeated guesses lock the address out', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-pairing-'));
   tempRoots.push(dataPath);
   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   const controller = createReceiverPairingController({ settingsStore, onSessionChanged: () => {} });

   const session = controller.start();
   const raced = await Promise.all([
      controller.complete({ code: session.code, deviceName: 'first', address: '127.0.0.1' }),
      controller.complete({ code: session.code, deviceName: 'second', address: '127.0.0.1' })
   ]);
   expect(raced.filter(Result.isOk)).toHaveLength(1);

   for (let failure = 0; failure < maxAddressFailures; failure += 1) {
      controller.start();
      await controller.complete({ code: '000000', deviceName: 'controller', address: '192.168.1.20' });
   }
   for (let address = 0; address < maxTrackedFailureAddresses + 10; address += 1) {
      controller.start();
      await controller.complete({ code: '000000', deviceName: 'controller', address: `10.0.${address >> 8}.${address & 0xff}` });
   }

   const next = controller.start();
   const blocked = await controller.complete({ code: next.code, deviceName: 'controller', address: '192.168.1.20' });
   expect(Result.isError(blocked) && blocked.error).toMatchObject({ status: 429, code: 'receiver.pairing.rate-limited' });
   expect(Result.isOk(await controller.complete({ code: next.code, deviceName: 'controller', address: '192.168.1.21' }))).toBe(true);
});
