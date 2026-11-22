import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { defaultModSourceResolutionSettings } from '@/modules/mods/contract';
import { createQuestModCatalog, questCoreModsUrl } from '@/modules/quest/main/quest-mod-catalog';

const gameVersion = '1.40.8_7379';
const mod = (id: string, version: string, dependencies: { id: string; version: string }[] = []) => ({
   id,
   name: id,
   version,
   download: `https://example.com/${id}-${version}.qmod`,
   modloader: 'Scotland2',
   dependencies
});

describe('Quest mod catalog', () => {
   test('picks the global library builds that this version of the game asks for and files core dependencies under core', async () => {
      const catalog = createQuestModCatalog({
         repositories: {
            isQuestModsEnabled: async () => true,
            listEntries: async () => ({ sources: [], entries: [], fileMatches: [], resolution: defaultModSourceResolutionSettings })
         },
         fetchJson: async (url) =>
            Result.ok(
               url === questCoreModsUrl
                  ? { [gameVersion]: { mods: [{ id: 'bsml', version: '0.4.55', downloadLink: 'https://example.com/bsml-0.4.55.qmod' }] } }
                  : url.endsWith(`${gameVersion}.json`)
                    ? { bsml: { '0.4.55': mod('bsml', '0.4.55', [{ id: 'beatsaber-hook', version: '^6.4.1' }]) } }
                    : {
                         'beatsaber-hook': {
                            '6.4.2': mod('beatsaber-hook', '6.4.2'),
                            '8.2.1': mod('beatsaber-hook', '8.2.1', [{ id: 'flamingo', version: '^1.2.1' }])
                         },
                         flamingo: { '1.1.2': mod('flamingo', '1.1.2'), '1.2.1': mod('flamingo', '1.2.1') }
                      }
            )
      });

      const index = (await catalog.get(gameVersion)).unwrap();
      expect(Object.fromEntries(index.entries.map((entry) => [entry.packageId, `${entry.version} ${entry.category}`]))).toEqual({
         bsml: '0.4.55 core',
         'beatsaber-hook': '6.4.2 core',
         flamingo: '1.2.1 core'
      });
   });

   test('refuses a core install when the core mod list is unreachable instead of installing only what the listing marks core', async () => {
      const catalog = createQuestModCatalog({
         repositories: {
            isQuestModsEnabled: async () => true,
            listEntries: async () => ({ sources: [], entries: [], fileMatches: [], resolution: defaultModSourceResolutionSettings })
         },
         fetchJson: async (url) =>
            url === questCoreModsUrl
               ? Result.err({ code: 'quest.catalog.fetch-failed', message: 'offline' })
               : Result.ok(url.endsWith(`${gameVersion}.json`) ? { flamingo: { '1.2.1': mod('flamingo', '1.2.1') } } : {})
      });

      expect((await catalog.refresh(gameVersion, { requiredCore: true })).match({ ok: () => '', err: (error) => error.code })).toBe(
         'quest.catalog.fetch-failed'
      );
      expect(Result.isOk(await catalog.refresh(gameVersion))).toBe(true);
   });
});
