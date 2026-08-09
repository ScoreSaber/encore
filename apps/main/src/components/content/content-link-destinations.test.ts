import { createContentLinkDestinations, type ContentLinkSharedState } from '@/components/content/content-link-destinations';

import { describe, expect, test } from 'bun:test';

describe('content link destinations', () => {
   test('groups installs only when every requested folder uses the same target library', () => {
      const installs = [
         { installId: 'one', name: '1.39.1', targetId: 'local', targetName: 'This computer' },
         { installId: 'two', name: '1.40.0', targetId: 'local', targetName: 'This computer' },
         { installId: 'remote', name: '1.40.0', targetId: 'lounge', targetName: 'Lounge PC' }
      ];
      const sharedStates: ContentLinkSharedState[] = [
         {
            targetId: 'local',
            installId: 'one',
            folders: [
               { id: 'maps', state: 'linked', rootPath: '/library' },
               { id: 'playlists', state: 'linked', rootPath: '/library' }
            ]
         },
         {
            targetId: 'local',
            installId: 'two',
            folders: [
               { id: 'maps', state: 'linked', rootPath: '/library' },
               { id: 'playlists', state: 'unlinked', rootPath: null }
            ]
         },
         {
            targetId: 'lounge',
            installId: 'remote',
            folders: [
               { id: 'maps', state: 'linked', rootPath: '/library' },
               { id: 'playlists', state: 'linked', rootPath: '/library' }
            ]
         }
      ];

      expect(createContentLinkDestinations(installs, sharedStates, ['maps']).map(({ targetId, installIds }) => ({ targetId, installIds }))).toEqual([
         { targetId: 'local', installIds: ['one', 'two'] },
         { targetId: 'lounge', installIds: ['remote'] }
      ]);
      expect(
         createContentLinkDestinations(installs, sharedStates, ['maps', 'playlists']).map(({ targetId, installIds }) => ({ targetId, installIds }))
      ).toEqual([
         { targetId: 'local', installIds: ['one'] },
         { targetId: 'local', installIds: ['two'] },
         { targetId: 'lounge', installIds: ['remote'] }
      ]);
   });
});
