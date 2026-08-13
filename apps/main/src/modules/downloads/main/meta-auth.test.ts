import { describe, expect, test } from 'vite-plus/test';

import { isMetaAuthToken } from '@/modules/downloads/main/meta-auth';

describe('meta auth', () => {
   test('only accepts cookie values shaped like a Meta access token', () => {
      expect(isMetaAuthToken('FRLsomeaccesstoken')).toBe(true);
      expect(isMetaAuthToken('OCsomeaccesstoken')).toBe(true);

      expect(isMetaAuthToken(undefined)).toBe(false);
      expect(isMetaAuthToken('')).toBe(false);
      expect(isMetaAuthToken('FRL%2Fencoded')).toBe(false);
      expect(isMetaAuthToken('FRL|scoped')).toBe(false);
      expect(isMetaAuthToken('FRL:scoped')).toBe(false);
      expect(isMetaAuthToken('sometoken')).toBe(false);
      expect(isMetaAuthToken('OC123456789012345')).toBe(false);
   });
});
