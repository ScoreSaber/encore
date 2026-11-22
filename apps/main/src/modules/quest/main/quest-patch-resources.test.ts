import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import { beatSaberPackageId } from '@/modules/quest/contract';
import { createQuestPatchResources } from '@/modules/quest/main/quest-patch-resources';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];

afterEach(async () => {
   await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('quest patch resources', () => {
   test('rejects Unity index versions that would escape the cache before downloading', async () => {
      const cacheRoot = await mkdtemp(join(tmpdir(), 'encore-quest-resources-'));
      directories.push(cacheRoot);
      const resources = createQuestPatchResources({
         cacheRoot,
         fetchJson: async () => Result.ok({ [beatSaberPackageId]: { '1.40.0': '../../outside' } }),
         download: async () => {
            throw new Error('downloaded an unsafe path');
         }
      });

      const downloaded = await resources.unstrippedUnity('1.40.0', new AbortController().signal);
      expect(downloaded).toMatchObject({ status: 'error', error: { code: 'quest.patch.unity-index-invalid' } });
   });
});
