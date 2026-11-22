import { Result } from 'better-result';
import { zipSync } from 'fflate';
import { expect, test } from 'vite-plus/test';

import { createDownloadService } from '@/modules/downloads/main/download-service';
import { createOculusDownloader } from '@/modules/downloads/main/oculus-downloader';
import { createSteamDownloader } from '@/modules/downloads/main/steam-downloader';
import { createVersionCatalog } from '@/modules/downloads/main/version-catalog';
import { createInstallTestbed } from '@/modules/installs/main/install-registry.fixture';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createAppLogWriter } from '@/modules/support/main/app-log';

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const accessToken = 'FRLtestaccesstoken';
const gameFiles = {
   'Beat Saber.exe': 'oculus beat saber binary',
   'Beat Saber_Data/globalgamemanagers': 'public.app-category.games  1.37.0 '
};
const steamFiles = { ...gameFiles, 'UnityPlayer.dll': 'engine' };

test('copies a settled Steam depot into the install root and leaves existing depot content in place', async () => {
   const { downloads, operations, registry, installRoot, depotPath } = await createHarness();
   await mkdir(join(depotPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(depotPath, 'leftover.bin'), 'stale', 'utf8');

   const installPath = join(installRoot, 'Beat Saber 1.37.0');
   expect(await download(downloads, operations, 'steam')).toMatchObject({ status: 'completed', result: { store: 'steam', path: installPath } });
   expect((await readdir(depotPath)).sort()).toEqual(['Beat Saber_Data', 'leftover.bin']);
   expect(await readdir(installPath)).toEqual(expect.arrayContaining(['Beat Saber.exe', 'leftover.bin']));
   expect((await registry.list()).installs).toMatchObject([{ status: 'ready', store: 'steam', path: installPath }]);
});

test('keeps waiting on a Steam depot that stalls before its manifest is complete', async () => {
   const { downloads, operations, registry, installRoot, depotPath, stallSteam } = await createHarness();
   stallSteam();

   expect(await download(downloads, operations, 'steam')).toMatchObject({ status: 'failed', error: { code: 'downloads.steam.timed-out' } });
   expect(await readdir(installRoot)).toEqual([]);
   expect((await readdir(depotPath)).sort()).toEqual(['Beat Saber.exe', 'Beat Saber_Data', 'UnityPlayer.dll']);
   expect((await registry.list()).installs).toEqual([]);
});

test('refuses an Oculus build that fails its checksums and installs a valid one without leaking the token', async () => {
   const { downloads, operations, registry, installRoot, dataPath, useManifest } = await createHarness();

   useManifest('corrupt');
   const refused = await download(downloads, operations, 'oculus');
   expect(refused).toMatchObject({ status: 'failed', error: { code: 'downloads.oculus.integrity-failed' } });
   expect(await readdir(installRoot)).toEqual([]);

   useManifest('valid');
   const installPath = join(installRoot, 'Beat Saber 1.37.0');
   expect(await download(downloads, operations, 'oculus')).toMatchObject({ status: 'completed', result: { store: 'oculus', path: installPath } });
   expect(await readFile(join(installPath, 'Beat Saber.exe'), 'utf8')).toBe(gameFiles['Beat Saber.exe']);
   expect((await registry.list()).installs).toMatchObject([{ status: 'ready', store: 'oculus', path: installPath }]);
   expect((await readdir(installPath, { recursive: true })).some((name) => name.includes('.encore-oculus-'))).toBe(false);
   expect(JSON.stringify([refused, operations.list()])).not.toContain(accessToken);
   expect(await readLogs(join(dataPath, 'logs'))).not.toContain(accessToken);
});

test('downloads an Oculus build into a library folder that does not exist yet', async () => {
   const { downloads, operations, installRoot, settingsStore } = await createHarness();
   const newRoot = join(installRoot, 'New library');
   await settingsStore.updateLibrarySettings({ installRoot: newRoot });

   expect(await download(downloads, operations, 'oculus')).toMatchObject({
      status: 'completed',
      result: { path: join(newRoot, 'Beat Saber 1.37.0') }
   });
});

async function createHarness() {
   const { dataPath, installRoot, settingsStore, registry, operations } = await createInstallTestbed();
   const steamRoot = join(dataPath, 'steam');
   const depotPath = join(steamRoot, 'steamapps', 'content', 'app_620980', 'depot_620981');
   const segments = new Map<string, Buffer>();
   const manifests = { corrupt: createManifest(segments, true), valid: createManifest(segments, false) };
   let manifest = manifests.valid;
   let steamManifest = createSteamManifest(steamFiles);

   const downloads = createDownloadService({
      settingsStore,
      registry,
      operations,
      catalog: createVersionCatalog({
         dataPath,
         sourceUrl: 'https://versions.test/bs-versions.json',
         fetchCatalog: () =>
            Promise.resolve(
               Response.json([
                  {
                     version: '1.37.0',
                     manifestId: '3',
                     oculusBinaryId: 'binary-1370',
                     releaseUrl: null,
                     releaseDate: '2024-01-01T00:00:00.000Z',
                     year: '2024',
                     recommended: false
                  }
               ])
            )
      }),
      stores: ['steam', 'oculus'],
      ensureProton: () => Promise.resolve(false),
      steam: createSteamDownloader({
         operations,
         readClientState: () => Promise.resolve({ status: 'ready', executablePath: join(steamRoot, 'steam.exe'), depotPath }),
         launch: async ({ manifestId }) => {
            await mkdir(join(steamRoot, 'depotcache'), { recursive: true });
            await writeFile(join(steamRoot, 'depotcache', `620981_${manifestId}.manifest`), steamManifest);
            await writeFiles(depotPath, steamFiles);
            return Result.ok<void, string>(undefined);
         },
         pollIntervalMs: 10,
         settleMs: 40,
         firstBytesTimeoutMs: 200,
         timeoutMs: 1_000
      }),
      oculus: createOculusDownloader({
         operations,
         platform: 'win32',
         requestToken: () => Promise.resolve(Result.ok(accessToken)),
         maxAttempts: 1,
         concurrency: 1,
         fetchBinary: (url) => {
            const query = new URL(url).searchParams;
            if (query.get('get_manifest') === '1') return Promise.resolve(new Response(manifest));

            const segment = segments.get(query.get('segment_sha256') ?? '');
            return Promise.resolve(segment ? new Response(new Uint8Array(segment)) : new Response('missing', { status: 404 }));
         }
      }),
      log: createAppLogWriter({ logsPath: join(dataPath, 'logs') })
   });

   return {
      downloads,
      operations,
      settingsStore,
      registry,
      installRoot,
      dataPath,
      depotPath,
      useManifest: (kind: keyof typeof manifests) => {
         manifest = manifests[kind];
      },
      stallSteam: () => {
         steamManifest = createSteamManifest({ ...steamFiles, 'Beat Saber_Data/level0': 'level data steam never delivers' });
      }
   };
}

async function download(
   downloads: ReturnType<typeof createDownloadService>,
   operations: Awaited<ReturnType<typeof createInstallTestbed>>['operations'],
   store: 'steam' | 'oculus'
) {
   const started = await downloads.start({ store, version: '1.37.0' });
   if (Result.isError(started)) throw new Error('the download did not start');

   return waitForOperation(operations, started.value.id);
}

async function readLogs(logsPath: string) {
   const files = await readdir(logsPath);
   return (await Promise.all(files.map((file) => readFile(join(logsPath, file), 'utf8')))).join('\n');
}

async function writeFiles(root: string, files: Record<string, string>) {
   for (const [name, content] of Object.entries(files)) {
      await mkdir(join(root, name, '..'), { recursive: true });
      await writeFile(join(root, name), content, 'latin1');
   }
}

function createSteamManifest(files: Record<string, string>) {
   const varint = (value: number) => {
      const bytes: number[] = [];
      for (; value >= 0x80; value = Math.floor(value / 0x80)) bytes.push((value % 0x80) | 0x80);
      return Buffer.from([...bytes, value]);
   };
   const field = (id: number, value: Buffer) => Buffer.concat([varint(id * 8 + 2), varint(value.length), value]);
   const payload = Buffer.concat(
      Object.entries(files).map(([name, content]) => {
         const data = Buffer.from(content, 'latin1');
         const sha1 = createHash('sha1').update(data).digest();
         return field(
            1,
            Buffer.concat([field(1, Buffer.from(name.replaceAll('/', '\\'))), Buffer.concat([varint(2 * 8), varint(data.length)]), field(5, sha1)])
         );
      })
   );
   const header = Buffer.alloc(8);
   header.writeUInt32LE(0x71f617d0);
   header.writeUInt32LE(payload.length, 4);
   const end = Buffer.alloc(4);
   end.writeUInt32LE(0x32c415ab);
   return Buffer.concat([header, payload, end]);
}

function createManifest(segments: Map<string, Buffer>, corrupt: boolean) {
   const files = Object.fromEntries(
      Object.entries(gameFiles).map(([name, content]) => {
         const payload = Buffer.from(content, 'latin1');
         const compressed = deflateSync(payload);
         const sha256 = createHash('sha256').update(compressed).digest('hex');
         segments.set(sha256, compressed);

         return [
            name,
            {
               sha256: corrupt ? 'deadbeef' : createHash('sha256').update(payload).digest('hex'),
               size: payload.length,
               segments: [[0, sha256, compressed.length]]
            }
         ];
      })
   );

   return zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ files })) });
}
