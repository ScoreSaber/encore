import { describe, expect, test } from 'vite-plus/test';

import { parseLaunchLink } from '@/modules/shortcuts/contract';

describe('launch links', () => {
   test('accepts only explicit boolean launch options', () => {
      const prefix = 'encore://launch?install=install_abcdef012345';

      expect(parseLaunchLink(`${prefix}&admin=1`)).toMatchObject({ status: 'ok', request: { options: { runAsAdmin: true } } });
      expect(parseLaunchLink(`${prefix}&admin=true`)).toMatchObject({ status: 'ok', request: { options: { runAsAdmin: false } } });
      expect(parseLaunchLink(`${prefix}&close=1`)).toMatchObject({ status: 'ok', request: { options: { closeEncore: true } } });
      expect(parseLaunchLink(`${prefix}&close=true`)).toMatchObject({ status: 'ok', request: { options: { closeEncore: false } } });
      expect(parseLaunchLink(prefix)).toMatchObject({ status: 'ok', request: { options: { runAsAdmin: false, closeEncore: false } } });
   });

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
