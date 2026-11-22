import { expect, onTestFinished, test } from 'vite-plus/test';

import { defaultReceiverPort } from '@/modules/receiver/address';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('recovers usable fields without overwriting a damaged settings file', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
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

test('keeps a copy of unparseable settings before saving over them', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
   const damaged = '{"app": {"telemetryEnabled": false';
   await writeFile(join(dataPath, 'settings.json'), damaged, 'utf8');

   const store = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   expect(await store.getSnapshot()).toMatchObject({ status: 'recovered', problem: { code: 'settings.read.corrupt' } });
   expect(await store.updateAppSettings({ theme: 'dark' })).toMatchObject({ ok: true, value: { status: 'ready' } });

   const backups = (await readdir(dataPath)).filter((name) => name.startsWith('settings.invalid-'));
   expect(await Promise.all(backups.map((name) => readFile(join(dataPath, name), 'utf8')))).toEqual([damaged]);
});

test('upgrades a settings file from an older release in memory', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-settings-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
   const repository = { name: 'Repo', listingUrl: 'https://example.com/index.json', enabled: true, addedAt: 'then', acknowledgedAt: 'then' };
   const legacyOptions = { flags: ['fpfc'], args: [], runAsAdmin: false };
   const legacy = {
      app: {
         theme: 'dark',
         accentColor: '#ABCDEF',
         locale: 'en',
         selection: { targetId: 'local', installIds: {} },
         receiver: { enabled: true, interfaceName: null, pairedDevices: [], remoteTargets: [] },
         modRepositories: [
            { ...repository, id: 'com.ScoreSaber.latest' },
            { ...repository, id: 'com.example.repo' }
         ],
         linkHandling: { launchWithoutAsking: false, downloadInstall: { targetId: 'local', installId: 'install_1' } }
      },
      library: {
         installRoot: '/games/encore',
         sharedRoot: null,
         protonPath: null,
         lastLaunch: { installId: 'install_1', launchedAt: 'then', options: legacyOptions }
      }
   };
   await writeFile(join(dataPath, 'settings.json'), JSON.stringify(legacy), 'utf8');

   const snapshot = await createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' }).getSnapshot();

   expect(snapshot).toMatchObject({
      status: 'ready',
      app: {
         accentColor: '#abcdef',
         receiver: { enabled: true, bindHost: null, port: defaultReceiverPort },
         modRepositories: [{ id: 'com.example.repo', owner: '' }],
         telemetryEnabled: true,
         linkHandling: { launchWithoutAsking: false, downloadInstalls: [{ targetId: 'local', installId: 'install_1' }] }
      },
      library: {
         installRoot: '/games/encore',
         sharedRoots: [],
         launchOptions: { install_1: { ...legacyOptions, environment: {}, closeEncore: false } }
      }
   });
   expect(snapshot.problem).toBeUndefined();
});
