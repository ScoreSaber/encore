import { redactSupportText } from '@/modules/support/main/log-redaction';

import { describe, expect, test } from 'bun:test';

describe('support redaction', () => {
   test('removes tokens, accounts and machine paths before a log can be shared', () => {
      const redacted = redactSupportText(
         [
            'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz',
            'token=jkq82hfkalsm2xt9',
            'refresh_token: "5f1a0c8e9d4b7a2f"',
            'loaded C:\\Users\\Jacob\\AppData\\Roaming\\Encore\\settings.json',
            'wrote /home/jacob/.local/share/encore/log.txt',
            'signed in as player@example.com with 76561198000000000',
            'session fingerprint a1b2c3d4e5f60718293a4b5c6d7e8f90'
         ].join('\n')
      );

      expect(redacted).toContain('Authorization: [redacted]');
      expect(redacted).toContain('token=[redacted]');
      expect(redacted).toContain('C:\\Users\\[user]\\AppData');
      expect(redacted).toContain('/home/[user]/.local');
      expect(redacted).toContain('[redacted]@[redacted]');
      expect(redacted).not.toContain('abcdefghijklmnop');
      expect(redacted).not.toContain('jkq82hfkalsm2xt9');
      expect(redacted).not.toContain('Jacob');
      expect(redacted).not.toContain('76561198000000000');
      expect(redacted).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
   });
});
