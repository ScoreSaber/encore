import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { questCoreModsUrl } from '@/modules/quest/main/quest-mod-catalog';
import { createQuestVersionCatalog } from '@/modules/quest/main/quest-version-catalog';

const supportedVersion = '1.40.8_7379';
const storeVersion = '1.45.1_27839';
const file = { diff_name: 'game.diff', file_name: 'base.apk', file_crc: 1, output_file_name: 'base.apk', output_crc: 2, output_size: 3 };

describe('Quest downgrade planning', () => {
   test('rejects diff names that escape the download folder and diffs without source checksums', async () => {
      for (const apkDiff of [
         { ...file, diff_name: '../outside.diff' },
         { diff_name: 'apk.diff', file_name: 'base.apk' }
      ]) {
         const catalog = createQuestVersionCatalog({
            fetchJson: async (url) =>
               Result.ok(
                  url === questCoreModsUrl
                     ? { [supportedVersion]: { mods: [{ id: 'songcore' }] } }
                     : [{ from_version: storeVersion, to_version: supportedVersion, apk_diff: apkDiff, obb_diffs: [file] }]
               )
         });
         expect(await catalog.plan(storeVersion)).toMatchObject({ status: 'error', error: { code: 'quest.patch.invalid-diff-index' } });
      }
   });
});
