import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { buildZipArchive } from '@/lib/archive/zip-read.fixture';
import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createProblem } from '@/lib/errors';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { defaultModSourceResolutionSettings } from '@/modules/mods/contract';
import { createBeatModsApi, type BeatModsEntry } from '@/modules/mods/main/beatmods-api';
import { createModCatalogService } from '@/modules/mods/main/mod-catalog';
import { createModPatcher } from '@/modules/mods/main/mod-patcher';
import { createModService } from '@/modules/mods/main/mod-service';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('refuses tampered archives and uninstalls only the files a mod owns', async () => {
   const { dataPath, installRoot, registry, operations, log, register } = await createInstallTestbed();
   const installPath = await writeInstallFolder(join(installRoot, 'Beat Saber'));
   const install = await register(installPath);
   const mods = createModService({
      registry,
      operations,
      dataPath,
      log,
      ingestion: createContentIngestionService({ dataPath, fetchContent: fakeCdn }),
      catalog: createModCatalogService({
         dataPath,
         log,
         api: createBeatModsApi({ fetchJson: fakeBeatMods }),
         repositories: {
            isBeatModsEnabled: () => Promise.resolve(true),
            listEntries: () => Promise.resolve({ sources: [], entries: [], fileMatches: [], resolution: defaultModSourceResolutionSettings })
         }
      }),
      repositories: { checkDownloadHost: () => Promise.resolve(Result.ok(undefined)) },
      patcher: createModPatcher({ platform: 'win32', run: () => Promise.resolve(Result.ok(undefined)) })
   });
   const request = { targetId: 'local', installId: install.id };
   const run = (started: Awaited<ReturnType<typeof mods.installMods>>) => {
      if (Result.isError(started)) throw new Error('the mod operation did not start');

      return waitForOperation(operations, started.value.id);
   };

   const snapshot = await mods.getMods(request);
   if (snapshot.status !== 'ready') throw new Error('the mod catalogue did not load');
   expect(snapshot.mods.find(({ modId }) => modId === 'beatmods:2')?.latestVersion).toBe('1.0.0');
   expect(snapshot.mods.find(({ modId }) => modId === 'beatmods:1')).toMatchObject({
      iconUrl: 'https://beatmods.com/files/1/icon.png',
      category: 'core',
      isRequired: true
   });
   expect(snapshot.mods.some(({ modId }) => modId === 'beatmods:5')).toBe(false);

   expect(await run(await mods.installMods({ ...request, modIds: ['beatmods:4'] }))).toMatchObject({
      status: 'failed',
      error: { code: 'mods.install-failed', details: { detail: createProblem('content.extract.checksum-mismatch').message } }
   });
   expect(await readdir(installPath)).not.toContain('IPA');

   expect(await run(await mods.installMods({ ...request, modIds: ['beatmods:3'] }))).toMatchObject({
      status: 'completed',
      result: { mods: 3, files: 4 }
   });
   await mkdir(join(installPath, 'Plugins'), { recursive: true });
   await writeFile(join(installPath, 'Plugins', 'Handmade.dll'), 'handmade', 'utf8');
   await writeFile(join(installPath, 'Plugins', 'OldBSML.dll'), oldBsml, 'utf8');

   expect(await run(await mods.uninstallMods({ ...request, scope: 'selection', modIds: ['beatmods:2'], externalIds: [] }))).toMatchObject({
      status: 'completed',
      result: { mods: 1, files: 2 }
   });
   expect(await readdir(join(installPath, 'IPA', 'Pending', 'Plugins'))).toEqual(['Counters.dll']);
   expect(await readdir(join(installPath, 'Plugins'))).toEqual(['Handmade.dll']);
   expect(await readFile(join(installPath, 'Plugins', 'Handmade.dll'), 'utf8')).toBe('handmade');
   expect(await readFile(join(installPath, 'IPA.exe'), 'utf8')).toBe('ipa-exe');

   expect(await run(await mods.uninstallMods({ ...request, scope: 'selection', modIds: [], externalIds: ['Plugins/Handmade.dll'] }))).toMatchObject({
      status: 'completed',
      result: { files: 1 }
   });
   expect(await readdir(join(installPath, 'Plugins'))).not.toContain('Handmade.dll');
});

const zips = {
   bsipa: buildZipArchive([
      { name: 'IPA.exe', data: 'ipa-exe' },
      { name: 'IPA/Data/Managed/IPA.Injector.dll', data: 'injector' }
   ]),
   bsml: buildZipArchive([{ name: 'Plugins/BSML.dll', data: 'bsml' }]),
   counters: buildZipArchive([{ name: 'Plugins/Counters.dll', data: 'counters' }]),
   broken: buildZipArchive([{ name: 'Plugins/Broken.dll', data: 'tampered' }])
};

const bsml = catalogMod(2, 'BSML', zips.bsml, [{ pId: 1, sv: '^1.0.0' }], { 'Plugins/BSML.dll': 'bsml' });
const catalogResponse = [
   catalogMod(1, 'BSIPA', zips.bsipa, [], { 'IPA.exe': 'ipa-exe', 'IPA/Data/Managed/IPA.Injector.dll': 'injector' }),
   { ...bsml, version: { ...bsml.version, semver: '1.1.0', platform: 'oculus' } },
   catalogMod(3, 'Counters+', zips.counters, [{ pId: 2, sv: '^1.0.0' }], { 'Plugins/Counters.dll': 'counters' }),
   catalogMod(4, 'Broken', zips.broken, [], { 'Plugins/Broken.dll': 'broken' }),
   catalogMod(5, 'Incompatible mod', zips.broken, [{ pId: 2, sv: '^2.0.0' }], { 'Plugins/Broken.dll': 'broken' })
];

function catalogMod(id: number, name: string, zip: Buffer, dependencies: BeatModsEntry['version']['dependencies'], files: Record<string, string>) {
   return {
      project: {
         id,
         name,
         summary: name,
         description: '',
         category: id === 1 ? 'Mod Loader' : 'Gameplay',
         iconFileUrl: `https://beatmods.com/files/${id}/icon.png`,
         gitUrl: '',
         authors: []
      },
      version: {
         id: id * 10,
         projectId: id,
         uploaderId: 1,
         semver: '1.0.0',
         platform: 'universal',
         supportedGameVersions: [{ version: '1.37.0' }],
         zipHash: md5(zip),
         downloadUrl: `https://beatmods.com/files/${id}/${id * 10}/${encodeURIComponent(name)}.zip`,
         dependencies,
         fileSize: zip.length,
         contentHashes: Object.entries(files).map(([path, data]) => ({ path, hash: md5(data) }))
      }
   };
}

const oldBsml = 'old-bsml';

function fakeBeatMods(url: string) {
   const { pathname, searchParams } = new URL(url);
   expect(searchParams.get('status')).toBe('verified');
   if (pathname === '/api/v3/mods') {
      expect(searchParams.get('gameName')).toBe('beatsaber');
      expect(searchParams.get('platform')).toBe('steam');
      expect(searchParams.get('gameVersion')).toBe('1.37.0');
      return Promise.resolve(Response.json(catalogResponse));
   }
   if (pathname === '/api/v3/mods/2') {
      return Promise.resolve(
         Response.json({
            project: bsml.project,
            versions: [
               { ...bsml.version, semver: '1.2.0', supportedGameVersions: [{ version: '1.38.0' }] },
               { ...bsml.version, semver: '1.1.0', platform: 'oculus' },
               bsml.version
            ]
         })
      );
   }

   expect(pathname).toBe('/api/v3/hashlookup/version');
   if (searchParams.get('hash') !== md5(oldBsml)) return Promise.resolve(Response.json({}, { status: 404 }));
   const old = catalogMod(2, 'BSML', zips.bsml, [], { 'Plugins/OldBSML.dll': oldBsml });
   return Promise.resolve(Response.json({ [old.version.zipHash]: { project: old.project, version: { ...old.version, semver: '0.9.0' } } }));
}

const archives = new Map(Object.values(zips).map((zip) => [md5(zip), zip]));
const fakeCdn: ContentFetch = (url) => {
   const entry = catalogResponse.find(({ version }) => version.downloadUrl === url);
   const archive = entry && archives.get(entry.version.zipHash);

   return Promise.resolve(archive ? new Response(new Uint8Array(archive)) : new Response('not found', { status: 404 }));
};

function md5(value: string | Buffer) {
   return createHash('md5').update(value).digest('hex');
}
