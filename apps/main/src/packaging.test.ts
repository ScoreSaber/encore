import { createAppPackaging } from '@/packaging';

import { describe, expect, test } from 'bun:test';

describe('app packaging policy', () => {
   test('uses self-updates only for formats the updater can install', () => {
      const cases: [NodeJS.Platform, NodeJS.ProcessEnv, string, boolean, boolean][] = [
         ['win32', {}, 'nsis', true, true],
         ['darwin', {}, 'macos', false, true],
         ['linux', { APPIMAGE: '/tmp/Encore.AppImage' }, 'appimage', true, true],
         ['linux', { FLATPAK_ID: 'com.scoresaber.encore' }, 'flatpak', false, false],
         ['linux', {}, 'linux-package', false, false]
      ];

      for (const [platform, env, format, selfUpdates, updateChecks] of cases) {
         expect(createAppPackaging({ packaged: true, platform, env })).toMatchObject({ format, selfUpdates, updateChecks });
      }

      expect(createAppPackaging({ packaged: false, platform: 'linux', env: {} })).toMatchObject({
         format: 'development',
         selfUpdates: false,
         updateChecks: false
      });
   });
});
