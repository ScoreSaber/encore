import { afterEach, describe, expect, test } from 'vite-plus/test';

import { type InstallRegistrySnapshot } from '@/modules/installs/contract';
import { createDefaultAppSettings, createDefaultLibrarySettings, type SettingsSnapshot } from '@/modules/settings/contract';
import { localTargetId } from '@/modules/targets/contract';
import { describeLinuxDistribution, describeProtonVersion } from '@/modules/telemetry/main/host-details';
import {
   createTelemetryService,
   createTelemetrySnapshot,
   describeOperatingSystem,
   normalizeTelemetryRepositoryUrl,
   type TelemetryClient
} from '@/modules/telemetry/main/telemetry-service';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('telemetry census', () => {
   test('coarsens operating system versions', () => {
      expect(describeOperatingSystem('win32', '10.0.26100')).toBe('Windows 11');
      expect(describeOperatingSystem('win32', '10.0.19045')).toBe('Windows 10');
      expect(describeOperatingSystem('darwin', '27.3.1')).toBe('macOS 27.x');
      expect(describeOperatingSystem('linux', '6.14.9-arch1-1')).toBe('Linux 6.x');
   });

   test('describes Linux distributions and selected Proton builds without patch-level distro data', () => {
      expect(describeLinuxDistribution('NAME="Ubuntu"\nVERSION_ID="24.04.3"\n')).toBe('Ubuntu 24.04');
      expect(describeLinuxDistribution('NAME="Arch Linux"\nID=arch\n')).toBe('Arch Linux');
      expect(describeProtonVersion('1758761202 GE-Proton10-17\n')).toBe('GE-Proton10-17');
   });

   test('removes URL metadata and excludes local repository addresses', () => {
      expect(normalizeTelemetryRepositoryUrl('https://Example.com/mods/index.json?token=secret#latest')).toBe('https://example.com/mods/index.json');
      expect(normalizeTelemetryRepositoryUrl('file:///home/user/private-repo/index.json')).toBeNull();
      expect(normalizeTelemetryRepositoryUrl('https://localhost/mods/index.json')).toBeNull();
      expect(normalizeTelemetryRepositoryUrl('https://192.168.1.10/mods/index.json')).toBeNull();
   });

   test('reports an anonymous current-state snapshot once until it changes or is remotely refreshed', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-telemetry-'));
      tempRoots.push(dataPath);
      let currentTime = new Date('2026-08-10T00:00:00.000Z');
      let refreshGeneration: string | null = null;
      const captures: Parameters<TelemetryClient['capture']>[0][] = [];
      const app = {
         ...createDefaultAppSettings(),
         selection: { targetId: localTargetId, installIds: { [localTargetId]: 'install-main' } },
         modRepositories: [
            {
               id: 'community',
               name: 'Community',
               owner: 'Community',
               listingUrl: 'https://repo.example.com/index.json?token=not-collected',
               infoUrl: null,
               contactUrl: null,
               enabled: true,
               addedAt: '2026-08-01T00:00:00.000Z',
               acknowledgedAt: '2026-08-01T00:00:00.000Z'
            }
         ]
      };
      const settingsSnapshot: SettingsSnapshot = {
         status: 'ready',
         app,
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
      const installSnapshot: InstallRegistrySnapshot = {
         installRoot: '/games/encore',
         scannedAt: '2026-08-10T00:00:00.000Z',
         problems: [],
         installs: [
            {
               id: 'install-main',
               name: '1.40.8',
               pinned: false,
               version: '1.40.8',
               store: 'steam',
               source: 'store',
               path: '/games/encore/1.40.8',
               color: null,
               status: 'ready',
               createdAt: '2026-08-01T00:00:00.000Z',
               updatedAt: '2026-08-01T00:00:00.000Z'
            }
         ]
      };
      const settings = {
         getSnapshot: async () => settingsSnapshot,
         subscribe: () => () => undefined
      };
      const installs = {
         list: async () => installSnapshot,
         subscribe: () => () => undefined
      };
      const client: TelemetryClient = {
         capture: (event) => captures.push(event),
         getRefreshGeneration: async () => refreshGeneration,
         shutdown: async () => undefined
      };
      const service = createTelemetryService({
         dataPath,
         appVersion: '1.2.3',
         operatingSystem: 'Windows 11',
         platform: 'win32',
         settings,
         installs,
         client,
         now: () => currentTime
      });

      await service.start();

      expect(captures).toHaveLength(2);
      expect(captures[0]).toMatchObject({
         event: 'encore.census.reported',
         properties: {
            app_version: '1.2.3',
            operating_system: 'Windows 11',
            beat_saber_install_count: 1,
            active_beat_saber_version: '1.40.8',
            custom_repository_count: 1
         }
      });
      expect(captures[1]).toMatchObject({
         event: 'encore.repository.reported',
         properties: { repository_url: 'https://repo.example.com/index.json', enabled: true }
      });
      expect(captures[0]?.distinctId).toBe(captures[1]?.distinctId);

      await service.report();
      expect(captures).toHaveLength(2);

      refreshGeneration = '2';
      currentTime = new Date('2026-08-11T00:00:00.000Z');
      await service.report();

      expect(captures).toHaveLength(4);
      expect(captures[2]?.properties.report_reason).toBe('remote-refresh');

      settingsSnapshot.app.telemetryEnabled = false;
      currentTime = new Date('2026-08-20T00:00:00.000Z');
      await service.report();
      expect(captures).toHaveLength(4);

      await service.dispose();
   });

   test('derives counts and the active local Beat Saber version', () => {
      const app = {
         ...createDefaultAppSettings(),
         selection: { targetId: localTargetId, installIds: { [localTargetId]: 'selected' } }
      };
      const settings: SettingsSnapshot = {
         status: 'ready',
         app,
         library: createDefaultLibrarySettings('/games'),
         diagnostics: {
            platform: 'linux',
            arch: 'x64',
            appVersion: '1.0.0',
            dataPath: '/data',
            settingsPath: '/data/settings.json',
            installRoot: '/games',
            receiverEnabled: false
         }
      };
      const installs: InstallRegistrySnapshot = {
         installRoot: '/games',
         scannedAt: '2026-08-10T00:00:00.000Z',
         problems: [],
         installs: [
            {
               id: 'selected',
               name: '1.39.1',
               pinned: false,
               version: '1.39.1',
               store: null,
               source: 'imported',
               path: '/games/1.39.1',
               color: null,
               status: 'ready',
               createdAt: '2026-08-01T00:00:00.000Z',
               updatedAt: '2026-08-01T00:00:00.000Z'
            }
         ]
      };

      expect(
         createTelemetrySnapshot({
            appVersion: '1.0.0',
            operatingSystem: 'Linux 6.x',
            linuxDistribution: 'Arch Linux',
            protonVersion: 'GE-Proton10-9',
            settings,
            installs
         })
      ).toMatchObject({
         beatSaberInstallCount: 1,
         activeBeatSaberVersion: '1.39.1',
         linuxDistribution: 'Arch Linux',
         protonVersion: 'GE-Proton10-9'
      });
   });
});
