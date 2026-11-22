import { describe, expect, test } from 'vite-plus/test';

import { parseLaunchLink } from '@/modules/shortcuts/contract';

describe('launch links', () => {
   test('rejects ids, flags and args that could carry a command', () => {
      expect(parseLaunchLink('encore://launch?install=C:\\Windows\\System32\\cmd.exe')).toEqual({ status: 'invalid', issue: 'invalid-request' });
      expect(parseLaunchLink('encore://launch?install=install_abcdef012345&target=../../etc')).toEqual({
         status: 'invalid',
         issue: 'invalid-request'
      });
      expect(parseLaunchLink('encore://launch?install=install_abcdef012345&flag=rm-rf')).toEqual({ status: 'invalid', issue: 'invalid-request' });
      expect(parseLaunchLink('encore://launch?install=install_abcdef012345&arg=%00drop')).toEqual({ status: 'invalid', issue: 'invalid-request' });
   });
});
