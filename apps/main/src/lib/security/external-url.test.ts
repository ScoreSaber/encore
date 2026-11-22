import { expect, test } from 'vite-plus/test';

import { evaluateHttpsUrl, isTrustedRendererNavigation } from '@/lib/security/external-url';

test('hands only plain HTTPS URLs to the OS and keeps the renderer on its own origin', () => {
   expect(evaluateHttpsUrl('https://github.com/someone/their-mod')).toEqual({ allowed: true, url: 'https://github.com/someone/their-mod' });
   for (const url of ['not a URL', 'http://example.com/mod', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com/mod']) {
      expect(evaluateHttpsUrl(url).allowed).toBe(false);
   }

   const renderer = 'file:///opt/Encore/resources/app.asar/out/renderer/index.html';
   expect(isTrustedRendererNavigation(`${renderer}#/settings`, renderer)).toBe(true);
   expect(isTrustedRendererNavigation('file:///etc/passwd', renderer)).toBe(false);
   expect(isTrustedRendererNavigation('http://localhost:5173.evil.example/settings', 'http://localhost:5173')).toBe(false);
});
