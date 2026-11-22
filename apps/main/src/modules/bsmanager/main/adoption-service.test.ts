import { expect, test } from 'vite-plus/test';

import { createBSManagerAdoptionService } from '@/modules/bsmanager/main/adoption-service';
import { createBSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';

import { mkdir, readlink, symlink, writeFile } from 'node:fs/promises';
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
