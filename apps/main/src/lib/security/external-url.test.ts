import { evaluateHttpsUrl, isTrustedRendererNavigation, openHttpsUrl } from '@/lib/security/external-url';

import { describe, expect, test } from 'bun:test';

describe('external URLs', () => {
   test('accepts plain HTTPS URLs and rejects unsafe URL forms', () => {
      expect(evaluateHttpsUrl('https://github.com/someone/their-mod')).toEqual({
         allowed: true,
         url: 'https://github.com/someone/their-mod'
      });

      expect(evaluateHttpsUrl('not a URL')).toEqual({ allowed: false, reason: 'invalid-url' });
      for (const url of [
         'http://example.com/mod',
         'javascript:alert(1)',
         'file:///etc/passwd',
         'https://user:pass@example.com/mod',
         'https://example.com:8443/mod'
      ]) {
         expect(evaluateHttpsUrl(url).allowed).toBe(false);
      }
   });

   test('opens only accepted URLs and reports OS failures', async () => {
      const opened: string[] = [];
      const open = async (url: string) => {
         opened.push(url);
      };

      expect(await openHttpsUrl('https://example.com/mod', open)).toEqual({ allowed: true, url: 'https://example.com/mod' });
      expect(await openHttpsUrl('file:///tmp/secret', open)).toEqual({ allowed: false, reason: 'blocked-scheme' });
      expect(await openHttpsUrl('https://example.com/fail', async () => Promise.reject(new Error('blocked by OS')))).toEqual({
         allowed: false,
         reason: 'open-failed'
      });
      expect(opened).toEqual(['https://example.com/mod']);
   });

   test('allows only the configured renderer location as internal navigation', () => {
      expect(
         isTrustedRendererNavigation(
            'file:///opt/Encore/resources/app.asar/out/renderer/index.html#/settings',
            'file:///opt/Encore/resources/app.asar/out/renderer/index.html'
         )
      ).toBe(true);
      expect(isTrustedRendererNavigation('file:///etc/passwd', 'file:///opt/Encore/resources/app.asar/out/renderer/index.html')).toBe(false);
      expect(isTrustedRendererNavigation('http://localhost:5173/settings', 'http://localhost:5173')).toBe(true);
      expect(isTrustedRendererNavigation('http://localhost:5173.evil.example/settings', 'http://localhost:5173')).toBe(false);
   });
});
