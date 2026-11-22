import type { IpcMainInvokeEvent } from 'electron';

import { chooseLocalExport, chooseLocalImport, openLocalPath } from '@/ipc/dialogs';
import { defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import { translate } from '@/lib/messages';
import { parsePlaylistLink, playlistFileExtension, playlistLinkScheme, type PlaylistLinkEvent } from '@/modules/playlists/contract';
import { playlistsIpc } from '@/modules/playlists/ipc';
import type { PlaylistService } from '@/modules/playlists/main/playlist-service';
import { onDeepLink, onFileOpened, readProtocolLinkState, setProtocolLinkRegistered } from '@/modules/shortcuts/main/deep-link';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

import { basename } from 'node:path';

const importFilters = [{ name: translate('playlists.fileTypes.playlist'), extensions: ['bplist', 'json'] }];

export function createPlaylistsIpcModule(service: PlaylistService, broadcast: IpcBroadcast) {
   const links = createPendingIpcEvent<PlaylistLinkEvent>((event) => broadcast(playlistsIpc.onLinkOpened, event));

   onDeepLink([playlistLinkScheme], (link) => {
      const parsed = parsePlaylistLink(link);
      links.publish(
         parsed.status === 'ok' ? { status: 'ready', source: { kind: 'url', url: parsed.url } } : { status: 'rejected', issue: parsed.issue }
      );
   });

   onFileOpened([playlistFileExtension], (path) => {
      links.publish({
         status: 'ready',
         source: { kind: 'file', path, fileName: basename(path) }
      });
   });

   return defineIpcHandlers<typeof playlistsIpc, IpcMainInvokeEvent>(playlistsIpc, {
      getPlaylistLinkState: () => readProtocolLinkState(playlistLinkScheme),
      openPlaylistFolder: (request) => openLocalPath(request.targetId, () => service.getPlaylistsPath(request)),
      choosePlaylistImport: (request, event) => chooseLocalImport(request.targetId, event, importFilters),
      importPlaylists: (request) => (request.targetId === localTargetId ? service.startImport(request) : unsupportedTarget(request)),
      choosePlaylistExport: (request, event) => {
         const single = request.playlistIds.length === 1;
         return chooseLocalExport(request.targetId, request.playlistIds.length, event, {
            defaultPath: single ? `playlist${playlistFileExtension}` : 'playlists.zip',
            filters: single
               ? [{ name: translate('playlists.fileTypes.playlist'), extensions: ['bplist'] }]
               : [{ name: translate('playlists.fileTypes.archive'), extensions: ['zip'] }]
         });
      },
      exportPlaylists: (request) => (request.targetId === localTargetId ? service.startExport(request) : unsupportedTarget(request)),
      setPlaylistLinkRegistered: (request) => setProtocolLinkRegistered(playlistLinkScheme, request.registered),
      takePendingLink: () => links.take()
   });
}
