import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService, type StagedArchive } from '@/lib/content/content-ingestion';
import { createContentStaging } from '@/lib/content/content-staging';
import { buildZipArchive } from '@/lib/content/zip-archive.fixture';

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];
const archiveUrl = 'https://cdn.example.com/maps/source.zip';

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('content ingestion', () => {
   test('stages a downloaded archive and commits it into the install', async () => {
      const archive = mapArchive();
      const service = await createService(archive);
      const installRoot = await createTempRoot();

      const staged = await service.ingestArchive({ source: { kind: 'url', url: archiveUrl } });
      expect(Result.isOk(staged)).toBe(true);
      if (!Result.isOk(staged)) return;

      expect(staged.value.sha256).toBe(createHash('sha256').update(archive).digest('hex'));
      expect(staged.value.manifest.rootEntries).toEqual(['Expert', 'info.dat']);
      expect(await readFile(join(staged.value.extractedPath, 'info.dat'), 'utf8')).toBe('info');

      const committed = await staged.value.commit({
         destinationPath: join(installRoot, 'Beat Saber_Data', 'CustomLevels', 'song'),
         destinationRoot: installRoot
      });

      expect(Result.isOk(committed) && committed.value.files).toBe(2);
      expect(await readFile(join(installRoot, 'Beat Saber_Data', 'CustomLevels', 'song', 'Expert', 'song.dat'), 'utf8')).toBe('notes');
      expect(await readdir(service.staging.root)).toEqual([]);
   });

   test('discards staging when integrity or commit fails', async () => {
      const service = await createService(mapArchive());
      const mismatched = await service.ingestArchive({
         source: { kind: 'url', url: archiveUrl },
         expectedHash: { algorithm: 'sha256', value: 'deadbeef' }
      });

      expect(problemCode(mismatched)).toBe('content.hash.mismatch');
      expect(await readdir(service.staging.root)).toEqual([]);

      const staged = await service.ingestArchive({
         source: { kind: 'url', url: archiveUrl }
      });
      if (!Result.isOk(staged)) throw new Error('the fixture archive was not staged');
      const installRoot = await createTempRoot();
      const committed = await staged.value.commit({
         destinationPath: join(installRoot, '..', 'escaped'),
         destinationRoot: installRoot
      });

      expect(Result.isError(committed) && committed.error.code).toBe('content.commit.failed');
      expect(await readdir(service.staging.root)).toEqual([]);
   });
});

function mapArchive() {
   return buildZipArchive([
      { name: 'Expert/', data: '' },
      { name: 'Expert/song.dat', data: 'notes', deflate: true },
      { name: 'info.dat', data: 'info' }
   ]);
}

async function createService(archive?: Buffer) {
   const dataPath = await createTempRoot();

   return createContentIngestionService({
      dataPath,
      staging: createContentStaging({ dataPath }),
      fetchContent: archive ? archiveFetch(archive) : undefined
   });
}

function archiveFetch(archive: Buffer): ContentFetch {
   return () => {
      const body = new ReadableStream<Uint8Array>({
         start(controller) {
            controller.enqueue(new Uint8Array(archive));
            controller.close();
         }
      });

      return Promise.resolve(new Response(body, { headers: { 'content-length': String(archive.byteLength) } }));
   };
}

function problemCode(staged: Awaited<ReturnType<ReturnType<typeof createContentIngestionService>['ingestArchive']>>) {
   return Result.isError(staged) ? staged.error.code : `unexpected success: ${describeStaged(staged.value)}`;
}

function describeStaged(staged: StagedArchive) {
   return staged.extractedPath;
}

async function createTempRoot() {
   const root = await mkdtemp(join(tmpdir(), 'encore-ingest-'));
   tempRoots.push(root);

   return root;
}
