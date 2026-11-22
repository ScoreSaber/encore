import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { createInstallManagementService } from '@/modules/installs/main/install-management';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';

import { readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';

test('deletes an imported install in place and refuses folders a store owns', async () => {
   const { dataPath, registry, operations, settingsStore, register, setCandidates } = await createInstallTestbed();
   const management = createInstallManagementService({ registry, operations, settingsStore });
   const storePath = await writeInstallFolder(join(dataPath, 'Steam Beat Saber'));
   const imported = await register(await writeInstallFolder(join(dataPath, 'Beat Saber')), 'imported');
   setCandidates([{ store: 'steam', path: storePath, libraryPath: storePath, appId: '620980' }]);
   const store = (await registry.rescan()).installs.find((install) => install.source === 'store');
   if (!store) throw new Error('store install was not detected');

   expect(await management.delete({ installId: store.id })).toMatchObject({ error: { code: 'installs.manage.store-owned' } });
   expect(await management.update({ installId: store.id, path: imported.path })).toMatchObject({ error: { code: 'installs.manage.store-owned' } });

   const started = await management.delete({ installId: imported.id });
   if (Result.isError(started)) throw new Error('the delete did not start');

   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ kind: 'delete', status: 'completed' });
   expect(await readdir(dataPath)).not.toContain('Beat Saber');
   expect(await readdir(storePath)).toContain('Beat Saber.exe');
   expect((await registry.list()).installs.map((install) => install.id)).toEqual([store.id]);
});

test('refuses to delete an install that holds a shared library', async () => {
   const { dataPath, registry, operations, settingsStore, register } = await createInstallTestbed();
   const management = createInstallManagementService({ registry, operations, settingsStore });
   const install = await register(await writeInstallFolder(join(dataPath, 'Beat Saber')), 'imported');
   await symlink(install.path, join(dataPath, 'alias'));
   await settingsStore.updateLibrarySettings({ sharedRoots: [join(dataPath, 'alias', 'Shared')] });

   expect(await management.delete({ installId: install.id })).toMatchObject({ error: { code: 'installs.manage.holds-shared-library' } });
   expect(await readdir(install.path)).toContain('Beat Saber_Data');
});

test('keeps every install registered at the same time', async () => {
   const { dataPath, registry, register } = await createInstallTestbed();
   const paths = await Promise.all(['First', 'Second', 'Third'].map((name) => writeInstallFolder(join(dataPath, name))));

   await Promise.all(paths.map((path) => register(path, 'imported')));

   expect((await registry.rescan()).installs.map((install) => install.path).toSorted()).toEqual(paths.toSorted());
});
