import { getLocalTarget } from '@/modules/targets/main/local-target';

import { describe, expect, test } from 'bun:test';

describe('local target capabilities', () => {
   test('keeps macOS focused on local support and remote Beat Saber management', () => {
      expect(getLocalTarget('darwin').capabilities).toEqual(['read-logs', 'run-operations']);
   });

   test('advertises install management on Windows and Linux', () => {
      expect(getLocalTarget('win32').capabilities).toEqual(
         expect.arrayContaining(['download-install', 'launch-install', 'list-installs', 'share-content'])
      );
      expect(getLocalTarget('linux').capabilities).toEqual(expect.arrayContaining(['launch-install', 'list-installs', 'share-content']));
      expect(getLocalTarget('linux').capabilities).not.toContain('download-install');
   });
});
