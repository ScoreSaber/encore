import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { resolveRepositoryListingUrl } from '@/modules/mods/main/repo-url';

function resolve(input: string) {
   const resolved = resolveRepositoryListingUrl(input);

   return Result.isOk(resolved) ? resolved.value : resolved.error;
}

describe('repository listing url', () => {
   test('accepts a local JSON file or directory', () => {
      expect(resolve('file:///tmp/encore-repo/index.json')).toBe('file:///tmp/encore-repo/index.json');
      expect(resolve('file:///tmp/encore-repo')).toBe('file:///tmp/encore-repo/index.json');
   });

   test('refuses anything that is not plain https or a local file', () => {
      expect(resolve('http://example.com/index.json')).toMatchObject({ issue: 'invalid-url' });
      expect(resolve('file://example.com/index.json')).toMatchObject({ issue: 'invalid-url' });
      expect(resolve('https://user:secret@example.com/index.json')).toMatchObject({ issue: 'invalid-url' });
      expect(resolve('https://example.com:8443/index.json')).toMatchObject({ issue: 'invalid-url' });
      expect(resolve('not a url')).toMatchObject({ issue: 'invalid-url' });
   });
});
