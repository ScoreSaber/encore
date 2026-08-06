import { Result } from 'better-result';

import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { buildZipArchive } from '@/lib/content/zip-archive.fixture';
import type { ModIndexEntry } from '@/modules/mods/main/mod-index';
import { installModVersion } from '@/modules/mods/main/mod-install';

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('mod install', () => {
   test('follows GitHub release asset redirects without allowing unrelated hosts', async () => {
      const root = await mkdtemp(join(tmpdir(), 'encore-mod-install-'));
      tempRoots.push(root);
      const installPath = join(root, 'Beat Saber');
      await mkdir(installPath);

      const archive = buildZipArchive([{ name: 'Plugins/ScoreSaber.dll', data: 'scoresaber' }]);
      const entry = githubEntry(archive);
      const releaseAssetUrl = 'https://release-assets.githubusercontent.com/github-production-release-asset/scoresaber';
      const ingestion = createContentIngestionService({
         dataPath: root,
         fetchContent: (url) =>
            Promise.resolve(
               url === entry.downloadUrl
                  ? new Response(null, { status: 302, headers: { location: releaseAssetUrl } })
                  : url === releaseAssetUrl
                    ? new Response(new Uint8Array(archive))
                    : new Response('not found', { status: 404 })
            )
      });

      const installed = await installModVersion({ ingestion, installPath, entry });

      expect(Result.isOk(installed)).toBe(true);
      expect(await readFile(join(installPath, 'IPA', 'Pending', 'Plugins', 'ScoreSaber.dll'), 'utf8')).toBe('scoresaber');

      const blocked = await installModVersion({
         ingestion: createContentIngestionService({ dataPath: root, fetchContent: redirectToUnrelatedHost }),
         installPath,
         entry
      });
      expect(Result.isError(blocked) && blocked.error.code).toBe('content.source.unsupported-host');
   });
});

function githubEntry(archive: Buffer): ModIndexEntry {
   return {
      modId: 'scoresaber-latest:scoresaber',
      packageId: 'scoresaber',
      sourceId: 'scoresaber-latest',
      sourceName: 'ScoreSaber Latest',
      sourceKind: 'unofficial',
      name: 'ScoreSaber',
      summary: '',
      description: '',
      iconUrl: null,
      links: [],
      category: 'other',
      author: 'ScoreSaber',
      version: '3.4.1',
      sizeBytes: archive.byteLength,
      isBsipa: false,
      claimedIdentity: null,
      dependencies: [],
      downloadUrl: 'https://github.com/ScoreSaber/pc-mod/releases/download/v3.4.1/ScoreSaber.zip',
      downloadHost: 'github.com',
      archiveHash: { algorithm: 'md5', value: digest(archive) },
      files: [{ path: 'Plugins/ScoreSaber.dll', hash: { algorithm: 'md5', value: digest('scoresaber') } }]
   };
}

const redirectToUnrelatedHost: ContentFetch = () =>
   Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://downloads.example.com/ScoreSaber.zip' } }));

function digest(value: string | Buffer) {
   return createHash('md5').update(value).digest('hex');
}
