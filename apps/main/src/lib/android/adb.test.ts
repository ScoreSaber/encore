import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { createAdbClient, quoteShellArg } from '@/lib/android/adb';

describe('adb', () => {
   test('quotes shell arguments and never passes unvalidated endpoints to adb', async () => {
      expect(quoteShellArg("it's; rm -rf /")).toBe(`'it'\\''s; rm -rf /'`);

      const calls: string[][] = [];
      const client = createAdbClient({
         adbPath: 'adb',
         exec: async (input) => {
            calls.push(input.args);
            return Result.ok({ stdout: 'connected to 192.168.1.10:5555', stderr: '' });
         }
      });
      expect(Result.isOk(await client.connect('192.168.1.10'))).toBe(true);
      expect(Result.isError(await client.connect('-H attacker'))).toBe(true);
      expect(calls).toEqual([['connect', '192.168.1.10:5555']]);
   });
});
