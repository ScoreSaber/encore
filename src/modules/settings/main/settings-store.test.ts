import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('settings store', () => {
   test('recovers usable fields without overwriting a damaged file', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
      tempRoots.push(dataPath);
      const settingsPath = join(dataPath, 'settings.json');
      const damaged = {
         app: { theme: 'dark', receiver: { enabled: true, pairedDevices: [{ id: 'incomplete' }] } },
         library: { installRoot: '/games/encore' }
      };
      await writeFile(settingsPath, JSON.stringify(damaged), 'utf8');

      const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });

      expect(await store.getSnapshot()).toMatchObject({
         status: 'recovered',
         problem: { code: 'settings.read.invalid' },
         app: { theme: 'dark', receiver: { enabled: true, pairedDevices: [] } },
         library: { installRoot: '/games/encore' }
      });
      expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(damaged);
   });
});
