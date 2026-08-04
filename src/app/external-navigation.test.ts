import { openExternalUrl } from '@/app/external-navigation';
import type { ExternalNavigationBlockReason } from '@/lib/security/external-url';
import { supportLinkUrls } from '@/modules/support/contract';

import { describe, expect, test } from 'bun:test';

describe('Encore external navigation policy', () => {
   test('hands only Encore and support destinations to the OS', async () => {
      const opened: string[] = [];
      const open = async (url: string) => {
         opened.push(url);
      };
      const allowed = [...Object.values(supportLinkUrls), 'https://scoresaber.com/support', 'https://wiki.scoresaber.com/en_US/support'];

      for (const url of allowed) {
         expect(await openExternalUrl(url, open)).toEqual({ allowed: true, url });
      }

      const blocked: [string, ExternalNavigationBlockReason][] = [
         ['file:///etc/passwd', 'blocked-scheme'],
         ['https://example.com/support', 'blocked-destination'],
         ['https://scoresaber.com.example.com/support', 'blocked-destination'],
         ['https://scoresaber.com@example.com/support', 'blocked-destination'],
         ['https://github.com/ScoreSaber/encore-malware', 'blocked-destination']
      ];
      for (const [url, reason] of blocked) {
         expect(await openExternalUrl(url, open)).toEqual({ allowed: false, reason });
      }
      expect(opened).toEqual(allowed);
   });
});
