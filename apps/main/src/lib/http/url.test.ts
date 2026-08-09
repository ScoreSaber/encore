import { Result } from 'better-result';

import { redactUrl, resolveHttpsUrl } from '@/lib/http/url';

import { describe, expect, test } from 'bun:test';

describe('content url policy', () => {
   test('rejects unsafe addresses without leaking their credentials', () => {
      for (const input of ['http://cdn.example.com/map.zip', 'file:///etc/passwd']) {
         const resolved = resolveHttpsUrl(input);
         expect(Result.isError(resolved) && resolved.error.code).toBe('unsupported-scheme');
      }

      const embedded = resolveHttpsUrl('https://user:secret@cdn.example.com/map.zip');
      const allowed = resolveHttpsUrl('https://cdn.example.com/map.zip', { allowedHosts: ['cdn.example.com'] });
      const blocked = resolveHttpsUrl('https://other.example.com/map.zip', { allowedHosts: ['cdn.example.com'] });

      expect(Result.isError(embedded) && embedded.error.code).toBe('embedded-credentials');
      expect(Result.isError(embedded) && embedded.error.detail).toBe('https://cdn.example.com/map.zip');
      expect(Result.isOk(allowed)).toBe(true);
      expect(Result.isError(blocked) && blocked.error.code).toBe('unsupported-host');
      expect(Result.isError(blocked) && blocked.error.detail).toBe('other.example.com');
      expect(redactUrl(new URL('https://user:secret@cdn.example.com/map.zip?token=abc'))).toBe('https://cdn.example.com/map.zip');
   });
});
