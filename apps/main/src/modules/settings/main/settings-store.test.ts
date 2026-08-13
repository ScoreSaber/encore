import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createDefaultAppSettings, createDefaultLibrarySettings } from '@/modules/settings/contract';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('settings store', () => {
   test('defaults fields added after an existing settings file was written', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
      tempRoots.push(dataPath);
      const {
         scoreSaberModSourceEnabled: _scoreSaberModSourceEnabled,
         linkHandling: _linkHandling,
         telemetryEnabled: _telemetryEnabled,
         ...app
      } = createDefaultAppSettings();
      const { customFolders: _customFolders, launchOptions: _launchOptions, ...library } = createDefaultLibrarySettings('/games/encore');
      await writeFile(join(dataPath, 'settings.json'), JSON.stringify({ app, library }), 'utf8');

      const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
      const snapshot = await store.getSnapshot();

      expect(snapshot.status).toBe('ready');
      expect(snapshot.app.scoreSaberModSourceEnabled).toBe(true);
      expect(snapshot.app.linkHandling).toEqual({ launchWithoutAsking: false, downloadInstall: null });
      expect(snapshot.app.telemetryEnabled).toBe(true);
      expect(snapshot.library.launchOptions).toEqual({});
      expect(snapshot.library.customFolders).toEqual([]);
   });

   test('persists each link handling choice without discarding the other', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
      tempRoots.push(dataPath);
      const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
      const downloadInstall = { targetId: 'remote-lounge', installId: 'install_abcdef012345' };

      await store.updateAppSettings({ linkHandling: { downloadInstall } });
      await store.updateAppSettings({ linkHandling: { launchWithoutAsking: true } });

      expect((await store.getSnapshot()).app.linkHandling).toEqual({
         launchWithoutAsking: true,
         downloadInstall
      });
   });

   test('persists the default folder used by new installs', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
      tempRoots.push(dataPath);
      const installRoot = join(dataPath, 'Beat Saber installs');
      const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });

      expect((await store.updateLibrarySettings({ installRoot })).ok).toBe(true);

      const reloaded = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
      expect((await reloaded.getSnapshot()).library.installRoot).toBe(installRoot);
   });

   test('defaults the resource saver off in an existing last launch', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
      tempRoots.push(dataPath);
      const library = createDefaultLibrarySettings('/games/encore');
      await writeFile(
         join(dataPath, 'settings.json'),
         JSON.stringify({
            app: createDefaultAppSettings(),
            library: {
               ...library,
               lastLaunch: {
                  installId: 'install_abcdef012345',
                  launchedAt: '2026-08-06T00:00:00.000Z',
                  options: { flags: [], args: [], runAsAdmin: false }
               }
            }
         }),
         'utf8'
      );

      const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });

      expect((await store.getSnapshot()).library.lastLaunch?.options.closeEncore).toBe(false);
   });

   test('recovers usable fields without overwriting a damaged file', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
      tempRoots.push(dataPath);
      const settingsPath = join(dataPath, 'settings.json');
      const damaged = {
         app: {
            theme: 'dark',
            receiver: { enabled: true, pairedDevices: [{ id: 'incomplete' }] },
            linkHandling: { launchWithoutAsking: true, downloadInstall: { targetId: '', installId: '' } }
         },
         library: { installRoot: '/games/encore' }
      };
      await writeFile(settingsPath, JSON.stringify(damaged), 'utf8');

      const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });

      expect(await store.getSnapshot()).toMatchObject({
         status: 'recovered',
         problem: { code: 'settings.read.invalid' },
         app: {
            theme: 'dark',
            receiver: { enabled: true, pairedDevices: [] },
            linkHandling: { launchWithoutAsking: true, downloadInstall: null }
         },
         library: { installRoot: '/games/encore' }
      });
      expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(damaged);
   });
});
