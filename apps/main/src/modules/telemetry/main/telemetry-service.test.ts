import { expect, onTestFinished, test } from 'vite-plus/test';

import { createDefaultAppSettings, createDefaultLibrarySettings, type SettingsSnapshot } from '@/modules/settings/contract';
import { createTelemetryService, type TelemetryClient } from '@/modules/telemetry/main/telemetry-service';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('sends nothing while opted out and strips private repository details once opted in', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-telemetry-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
   const captures: Parameters<TelemetryClient['capture']>[0][] = [];
   const repository = (listingUrl: string) => ({
      id: listingUrl,
      name: 'Community',
      owner: 'Community',
      listingUrl,
      infoUrl: null,
      contactUrl: null,
      enabled: true,
      addedAt: '2026-08-01T00:00:00.000Z',
      acknowledgedAt: '2026-08-01T00:00:00.000Z'
   });
   const settings: SettingsSnapshot = {
      status: 'ready',
      app: {
         ...createDefaultAppSettings(),
         telemetryEnabled: false,
         modRepositories: [
            repository('https://repo.example.com/index.json?token=not-collected#latest'),
            repository('file:///home/someone/private-repo/index.json'),
            repository('https://192.168.1.10/mods/index.json')
         ]
      },
      library: createDefaultLibrarySettings('/games/encore'),
      diagnostics: {
         platform: 'win32',
         arch: 'x64',
         appVersion: '1.2.3',
         dataPath,
         settingsPath: join(dataPath, 'settings.json'),
         installRoot: '/games/encore',
         receiverEnabled: false
      }
   };
   const service = createTelemetryService({
      dataPath,
      appVersion: '1.2.3',
      operatingSystem: 'Windows 11',
      platform: 'win32',
      settings: { getSnapshot: async () => settings, subscribe: () => () => undefined },
      installs: {
         list: async () => ({ installRoot: '/games/encore', scannedAt: '2026-08-10T00:00:00.000Z', problems: [], installs: [] }),
         subscribe: () => () => undefined
      },
      client: { capture: (event) => captures.push(event), getRefreshGeneration: async () => null, shutdown: async () => undefined }
   });
   onTestFinished(() => service.dispose());

   await service.start();
   expect(captures).toEqual([]);

   settings.app.telemetryEnabled = true;
   await service.report();

   expect(captures.map((capture) => capture.properties)).toMatchObject([
      { custom_repository_count: 1 },
      { repository_url: 'https://repo.example.com/index.json' }
   ]);
   expect(JSON.stringify(captures)).not.toMatch(/not-collected|someone|192\.168/);
});
