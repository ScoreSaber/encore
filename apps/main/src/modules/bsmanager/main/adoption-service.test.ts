import { Result } from 'better-result';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';

import { createProblem } from '@/lib/errors';
import { bsmanagerAdoptResultSchema, bsmanagerPrefixCopyPhase } from '@/modules/bsmanager/contract';
import { createBSManagerAdoptionService } from '@/modules/bsmanager/main/adoption-service';
import { createBSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';

import { mkdir, readdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('adopts selected BSManager versions in place and keeps their shared links', async () => {
   const { dataPath, registry, settingsStore, operations } = await createInstallTestbed({ platform: process.platform });
   const appDataPath = join(dataPath, 'appdata');
   const rootPath = join(dataPath, 'games', 'BSManager');
   const installPath = await writeInstallFolder(join(rootPath, 'BSInstances', '1.37.0'));
   await writeInstallFolder(join(rootPath, 'BSInstances', '1.29.1'), '1.29.1');
   await mkdir(join(appDataPath, 'bs-manager'), { recursive: true });
   await writeFile(
      join(appDataPath, 'bs-manager', 'config.json'),
      JSON.stringify({ 'installation-folder': join(dataPath, 'games'), 'use-symlinks': true }),
      'utf8'
   );
   await writeFile(
      join(rootPath, 'config.cfg'),
      JSON.stringify({
         'custom-versions': [
            { BSVersion: '1.37.0', color: '#22c55e', metadata: { id: 'one', store: 'STEAM' } },
            { BSVersion: '1.29.1', metadata: { id: 'two', store: 'OCULUS' } }
         ]
      }),
      'utf8'
   );
   const sharedMaps = join(rootPath, 'SharedContent', 'SharedMaps', 'CustomLevels');
   const installMaps = join(installPath, 'Beat Saber_Data', 'CustomLevels');
   await mkdir(sharedMaps, { recursive: true });
   await symlink(sharedMaps, installMaps, process.platform === 'win32' ? 'junction' : 'dir');
   const locations = { platform: process.platform, homePath: dataPath, documentsPath: join(dataPath, 'documents'), appDataPath };
   const adoption = createBSManagerAdoptionService({
      operations,
      registry,
      settingsStore,
      converter: createBSManagerSharedContentConverter({ operations, locations }),
      locations
   });

   expect(await adoption.adopt({ rootPath, versionIds: ['1.37.0'], adoptSharedRoot: true })).toMatchObject({
      status: 'ok',
      value: { adopted: 1, skipped: 1, sharedRootPath: join(rootPath, 'SharedContent') }
   });
   expect((await registry.list()).installs).toMatchObject([
      { path: installPath, source: 'bsmanager', name: '1.37.0', store: 'steam', color: '#22c55e' }
   ]);
   expect((await settingsStore.getSnapshot()).library.sharedRoot).toBe(join(rootPath, 'SharedContent'));
   expect((await readlink(installMaps)).replace(/^\\\\\?\\/, '')).toBe(sharedMaps);
});

test.skipIf(process.platform !== 'linux')('copies an opted-in Proton prefix without sharing files or replacing existing data', async () => {
   const { dataPath, registry, settingsStore, operations } = await createInstallTestbed({ platform: 'linux' });
   const locations = { platform: 'linux', homePath: dataPath, documentsPath: dataPath, appDataPath: join(dataPath, 'appdata') } as const;
   const rootPath = join(dataPath, 'BSManager');
   for (const version of ['1.37.0', '1.29.1', '1.28.0']) {
      await writeInstallFolder(join(rootPath, 'BSInstances', version), version);
   }

   const source = join(rootPath, 'SharedContent', 'compatdata');
   const sourcePrefix = join(source, 'pfx');
   await mkdir(join(sourcePrefix, 'drive_c'), { recursive: true });
   await mkdir(join(sourcePrefix, 'dosdevices'));
   await symlink('../drive_c', join(sourcePrefix, 'dosdevices', 'c:'));
   await writeFile(join(sourcePrefix, 'system.reg'), 'BSManager registry');
   await writeFile(join(source, 'version'), 'prefix version');
   await writeFile(join(source, 'pfx.lock'), '');

   let launchActive = false;
   const adoption = createBSManagerAdoptionService({
      isPrefixInUse: () => launchActive,
      operations,
      registry,
      settingsStore,
      converter: createBSManagerSharedContentConverter({ operations, locations }),
      locations
   });
   const destination = join((await settingsStore.getSnapshot()).diagnostics.dataPath, 'compatdata');
   await mkdir(destination);

   expect(await adoption.plan()).toMatchObject({ status: 'ok', prefixPath: sourcePrefix });
   expect(await adoption.adopt({ rootPath, versionIds: ['1.37.0'], adoptSharedRoot: false })).toMatchObject({ status: 'ok' });
   expect(await readdir(destination)).toEqual([]);

   launchActive = true;
   expect(await adoption.adopt({ rootPath, versionIds: [], adoptSharedRoot: false, copyPrefix: true })).toMatchObject({
      error: { code: 'bsmanager.prefix-copy-game-active' }
   });
   expect(adoption.waitForPrefixCopy()).toBeUndefined();
   expect(await readdir(destination)).toEqual([]);
   launchActive = false;

   const copying = adoption.adopt({ rootPath, versionIds: ['1.29.1'], adoptSharedRoot: false, copyPrefix: true });
   expect(adoption.waitForPrefixCopy()).toBeInstanceOf(Promise);
   expect(operations.list().some((operation) => operation.status === 'running' && operation.progress?.phase === bsmanagerPrefixCopyPhase)).toBe(true);
   const concurrent = adoption.adopt({ rootPath, versionIds: [], adoptSharedRoot: false, copyPrefix: true });
   expect(await copying).toMatchObject({ status: 'ok' });
   expect(await concurrent).toMatchObject({ error: { code: 'bsmanager.prefix-replace-confirmation-required' } });
   expect(adoption.waitForPrefixCopy()).toBeUndefined();
   expect(
      operations
         .list()
         .filter((operation) => operation.progress?.phase === bsmanagerPrefixCopyPhase)
         .map((operation) => operation.status)
         .sort()
   ).toEqual(['completed', 'failed', 'failed']);
   expect((await readdir(destination)).sort()).toEqual(['pfx', 'version']);
   expect(await readlink(join(destination, 'pfx', 'dosdevices', 'c:'))).toBe('../drive_c');
   expect(await readFile(join(destination, 'pfx', 'system.reg'), 'utf8')).toBe('BSManager registry');
   await writeFile(join(destination, 'pfx', 'system.reg'), 'Encore registry');
   expect(await readFile(join(sourcePrefix, 'system.reg'), 'utf8')).toBe('BSManager registry');

   expect(await adoption.plan()).toMatchObject({ status: 'ok', prefixPath: sourcePrefix, existingPrefix: true });
   expect(await adoption.adopt({ rootPath, versionIds: ['1.28.0'], adoptSharedRoot: false, copyPrefix: true })).toMatchObject({
      status: 'error',
      error: { code: 'bsmanager.prefix-replace-confirmation-required' }
   });
   expect(await readFile(join(destination, 'pfx', 'system.reg'), 'utf8')).toBe('Encore registry');
   expect((await registry.list()).installs).toHaveLength(2);

   expect(await adoption.adopt({ rootPath, versionIds: ['1.28.0'], adoptSharedRoot: false, copyPrefix: true, replacePrefix: true })).toMatchObject({
      status: 'ok'
   });
   expect(await readFile(join(destination, 'pfx', 'system.reg'), 'utf8')).toBe('BSManager registry');
   expect((await registry.list()).installs).toHaveLength(3);

   await writeFile(join(destination, 'pfx', 'system.reg'), 'Encore registry after adopting all versions');
   const libraryBeforeCopy = (await settingsStore.getSnapshot()).library;
   expect(await adoption.adopt({ rootPath, versionIds: [], adoptSharedRoot: true, copyPrefix: true, replacePrefix: true })).toMatchObject({
      status: 'ok',
      value: { adopted: 0 }
   });
   expect(await readFile(join(destination, 'pfx', 'system.reg'), 'utf8')).toBe('BSManager registry');
   expect((await settingsStore.getSnapshot()).library).toEqual(libraryBeforeCopy);
   expect((await registry.list()).installs).toHaveLength(3);
});

test.each(['registration', 'settings'] as const)('reports the copied prefix when %s fails afterward', async (phase) => {
   const { dataPath, registry, settingsStore, operations } = await createInstallTestbed({ platform: 'linux' });
   const locations = { platform: 'linux', homePath: dataPath, documentsPath: dataPath, appDataPath: join(dataPath, 'appdata') } as const;
   const rootPath = join(dataPath, 'BSManager');
   await writeInstallFolder(join(rootPath, 'BSInstances', '1.37.0'));
   const source = join(rootPath, 'SharedContent', 'compatdata', 'pfx');
   await mkdir(source, { recursive: true });
   await writeFile(join(source, 'system.reg'), 'BSManager registry');
   const destination = join(dataPath, 'compatdata');
   await mkdir(destination);
   await writeFile(join(destination, 'old'), 'Encore registry');
   const adoption = createBSManagerAdoptionService({
      operations,
      registry,
      settingsStore,
      converter: createBSManagerSharedContentConverter({ operations, locations }),
      locations
   });
   const error = createProblem('filesystem.operation.write-failed', { path: dataPath, detail: `${phase} failed` });
   if (phase === 'registration') vi.spyOn(registry, 'register').mockResolvedValueOnce(Result.err(error));
   else vi.spyOn(settingsStore, 'updateLibrarySettingsWith').mockResolvedValueOnce({ ok: false, error });
   onTestFinished(() => {
      vi.restoreAllMocks();
   });

   const result = await adoption.adopt({ rootPath, versionIds: ['1.37.0'], adoptSharedRoot: true, copyPrefix: true, replacePrefix: true });
   expect(result).toMatchObject({
      status: 'error',
      error: { code: 'bsmanager.prefix-copied-adoption-failed', prefixState: 'copied', detail: expect.stringContaining(phase) }
   });
   if (Result.isError(result)) {
      expect(bsmanagerAdoptResultSchema.parse({ ok: false, error: result.error })).toMatchObject({ error: { prefixState: 'copied' } });
      expect(result.error.message).toContain('The copied prefix remains in use');
   }
   expect(await readFile(join(destination, 'pfx', 'system.reg'), 'utf8')).toBe('BSManager registry');
   expect(operations.list()).toMatchObject([{ status: 'failed', error: { code: 'bsmanager.prefix-copied-adoption-failed' } }]);
   expect(adoption.waitForPrefixCopy()).toBeUndefined();
});
