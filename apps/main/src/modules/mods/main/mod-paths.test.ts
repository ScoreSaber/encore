import { describe, expect, test } from 'vite-plus/test';

import { resolveModContentPath } from '@/modules/mods/main/mod-paths';

import { join } from 'node:path';

const installPath = join('/tmp', 'encore-install');

describe('mod paths', () => {
   test('refuses content paths that would write outside the install', () => {
      expect(resolveModContentPath(installPath, '../../evil.dll')).toBeNull();
      expect(resolveModContentPath(installPath, '/etc/passwd')).toBeNull();
      expect(resolveModContentPath(installPath, 'Plugins/../../evil.dll')).toBeNull();
      expect(resolveModContentPath(installPath, '')).toBeNull();
   });
});
