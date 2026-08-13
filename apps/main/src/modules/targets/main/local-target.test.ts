import { describe, expect, test } from 'vite-plus/test';

import { getLocalTarget } from '@/modules/targets/main/local-target';

describe('local target capabilities', () => {
   test('keeps macOS focused on local support and remote Beat Saber management', () => {
      expect(getLocalTarget('darwin').capabilities).toEqual(['read-logs', 'run-operations']);
   });

   test('advertises install management on Windows and Linux', () => {
      const windowsCapabilities = getLocalTarget('win32').capabilities;
      expect(windowsCapabilities).toContain('download-install');
      expect(windowsCapabilities).toContain('launch-install');
      expect(windowsCapabilities).toContain('list-installs');
      expect(windowsCapabilities).toContain('share-content');

      const linuxCapabilities = getLocalTarget('linux').capabilities;
      expect(linuxCapabilities).toContain('launch-install');
      expect(linuxCapabilities).toContain('list-installs');
      expect(linuxCapabilities).toContain('share-content');
      expect(linuxCapabilities).not.toContain('download-install');
   });
});
