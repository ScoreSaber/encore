import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { parseQmodManifest } from '@/modules/quest/main/qmod';
import { localQmod, validateQmod } from '@/modules/quest/main/quest-mod-install';

describe('qmod manifest parsing', () => {
   test('rejects ids that could escape the packages folder', () => {
      const unsafe = parseQmodManifest(JSON.stringify({ id: '../evil', name: 'Evil', version: '1.0.0' }));
      expect(Result.isError(unsafe) && unsafe.error.code).toBe('quest.qmod.invalid-manifest');
   });

   test('only holds mods, not libraries, to the game version', () => {
      const manifest = (isLibrary: boolean) =>
         parseQmodManifest(
            JSON.stringify({
               id: 'tinyxml2',
               name: 'tinyxml2',
               version: '10.0.0',
               modloader: 'Scotland2',
               packageVersion: '1.29.0_4466478251',
               isLibrary
            })
         ).unwrap();
      const validate = (isLibrary: boolean) => validateQmod('1.40.8_7379', localQmod('tinyxml2.qmod', 'tinyxml2'), manifest(isLibrary));

      expect(Result.isOk(validate(true))).toBe(true);
      expect(Result.isError(validate(false))).toBe(true);
   });
});
