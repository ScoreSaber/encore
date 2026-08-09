import { parseMapLink } from '@/modules/maps/contract';

import { describe, expect, test } from 'bun:test';

describe('map links', () => {
   test('rejects anything that is not a plain map key', () => {
      expect(parseMapLink('beatsaver://../../etc/passwd')).toEqual({ status: 'invalid', issue: 'invalid-key' });
      expect(parseMapLink('beatsaver://')).toEqual({ status: 'invalid', issue: 'invalid-key' });
      expect(parseMapLink('https://beatsaver.com/maps/2a1b')).toEqual({ status: 'invalid', issue: 'unsupported-link' });
      expect(parseMapLink('not a url')).toEqual({ status: 'invalid', issue: 'unsupported-link' });
   });
});
