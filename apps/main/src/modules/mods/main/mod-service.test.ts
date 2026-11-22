import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { buildZipArchive } from '@/lib/archive/zip-read.fixture';
import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createProblem } from '@/lib/errors';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { defaultModSourceResolutionSettings } from '@/modules/mods/contract';
import { beatModsDownloadUrl, createBeatModsApi } from '@/modules/mods/main/beatmods-api';
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

const catalogResponse = {
   mods: [
      catalogMod(1, 'BSIPA', zips.bsipa, [], { 'IPA.exe': 'ipa-exe', 'IPA/Data/Managed/IPA.Injector.dll': 'injector' }),
      catalogMod(2, 'BSML', zips.bsml, [10], { 'Plugins/BSML.dll': 'bsml' }),
      catalogMod(3, 'Counters+', zips.counters, [20], { 'Plugins/Counters.dll': 'counters' }),
      catalogMod(4, 'Broken', zips.broken, [], { 'Plugins/Broken.dll': 'broken' })
   ]
};

function catalogMod(id: number, name: string, zip: Buffer, dependencies: number[], files: Record<string, string>) {
   return {
      mod: { id, name, summary: name, category: id === 1 ? 'core' : 'gameplay', authors: [] },
      latest: {
         id: id * 10,
         modId: id,
         modVersion: '1.0.0',
         zipHash: md5(zip),
         dependencies,
         contentHashes: Object.entries(files).map(([path, data]) => ({ path, hash: md5(data) }))
      }
   };
}

const oldBsml = 'old-bsml';

function fakeBeatMods(url: string) {
   const { pathname, searchParams } = new URL(url);
   if (pathname === '/api/status') return Promise.resolve(Response.json({ status: 'ok' }));
   if (pathname !== '/api/hashlookup') return Promise.resolve(Response.json(catalogResponse));

   const older = { ...catalogMod(2, 'BSML', zips.bsml, [], { 'Plugins/OldBSML.dll': oldBsml }).latest, modVersion: '0.9.0' };
   return Promise.resolve(Response.json({ modVersions: searchParams.get('hash') === md5(oldBsml) ? [older] : [] }));
}

const archives = new Map(Object.values(zips).map((zip) => [beatModsDownloadUrl(md5(zip)), zip]));
const fakeCdn: ContentFetch = (url) => {
   const archive = archives.get(url);

   return Promise.resolve(archive ? new Response(new Uint8Array(archive)) : new Response('not found', { status: 404 }));
};

function md5(value: string | Buffer) {
   return createHash('md5').update(value).digest('hex');
}
