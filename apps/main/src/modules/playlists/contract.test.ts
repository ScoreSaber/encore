import { parsePlaylistLink } from '@/modules/playlists/contract';

import { describe, expect, test } from 'bun:test';

describe('playlist links', () => {
   test('accepts wrapped https playlists and rejects every other source', () => {
      expect(parsePlaylistLink('bsplaylist://playlist/https://example.com/list.bplist')).toEqual({
         status: 'ok',
         url: 'https://example.com/list.bplist'
      });
      expect(parsePlaylistLink('bsplaylist://playlist/https%3A%2F%2Fexample.com%2Flist.bplist')).toEqual({
         status: 'ok',
         url: 'https://example.com/list.bplist'
      });
      expect(parsePlaylistLink('bsplaylist://playlist/https://example.com/api?id=7')).toEqual({
         status: 'ok',
         url: 'https://example.com/api?id=7'
      });

      expect(parsePlaylistLink('bsplaylist://playlist/http://example.com/list.bplist')).toEqual({ status: 'invalid', issue: 'invalid-source' });
      expect(parsePlaylistLink('bsplaylist://playlist/file:///etc/passwd')).toEqual({ status: 'invalid', issue: 'invalid-source' });
      expect(parsePlaylistLink('bsplaylist://playlist/')).toEqual({ status: 'invalid', issue: 'invalid-source' });
      expect(parsePlaylistLink('bsplaylist://other/https://example.com/list.bplist')).toEqual({ status: 'invalid', issue: 'invalid-source' });
      expect(parsePlaylistLink('https://example.com/list.bplist')).toEqual({ status: 'invalid', issue: 'unsupported-link' });
      expect(parsePlaylistLink('not a url')).toEqual({ status: 'invalid', issue: 'unsupported-link' });
   });
});
