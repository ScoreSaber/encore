import { Result } from 'better-result';

import {
   createReceiverPairingController,
   lastSeenWriteIntervalMs,
   maxAddressFailures,
   maxTrackedFailureAddresses
} from '@/modules/receiver/main/receiver-pairing';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('receiver pairing', () => {
   test('blocks an address that keeps failing across sessions', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-pairing-'));
      tempRoots.push(dataPath);
      const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
      const controller = createReceiverPairingController({ settingsStore, onSessionChanged: () => {} });

      for (let failure = 0; failure < maxAddressFailures; failure += 1) {
         controller.start();
         await controller.complete({ code: '000000', deviceName: 'controller', address: '192.168.1.20' });
      }

      for (let address = 0; address < maxTrackedFailureAddresses + 10; address += 1) {
         controller.start();
         await controller.complete({ code: '000000', deviceName: 'controller', address: `10.0.${address >> 8}.${address & 0xff}` });
      }

      const session = controller.start();
      const blocked = await controller.complete({ code: session.code, deviceName: 'controller', address: '192.168.1.20' });
      const other = await controller.complete({ code: session.code, deviceName: 'controller', address: '192.168.1.21' });

      expect(Result.isError(blocked) && blocked.error).toMatchObject({ status: 429, code: 'receiver.pairing.rate-limited' });
      expect(Result.isOk(other)).toBe(true);
   });

   test('coalesces last-seen writes and leaves fresh devices alone', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-pairing-'));
      tempRoots.push(dataPath);
      const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
      let currentTime = Date.now();
      const controller = createReceiverPairingController({
         settingsStore,
         onSessionChanged: () => {},
         now: () => currentTime
      });
      const session = controller.start();
      const paired = await controller.complete({ code: session.code, deviceName: 'controller', address: '192.168.1.20' });
      expect(Result.isOk(paired)).toBe(true);
      if (Result.isError(paired)) return;

      let writes = 0;
      const unsubscribe = settingsStore.subscribe(() => {
         writes += 1;
      });

      expect(await controller.authenticate(paired.value.token)).not.toBeNull();
      expect(writes).toBe(0);

      currentTime += lastSeenWriteIntervalMs;
      const authenticated = await Promise.all([
         controller.authenticate(paired.value.token),
         controller.authenticate(paired.value.token),
         controller.authenticate(paired.value.token)
      ]);

      expect(authenticated.every(Boolean)).toBe(true);
      expect(writes).toBe(1);
      unsubscribe();
   });
});
