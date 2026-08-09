import { shell, type IpcMainInvokeEvent } from 'electron';

import { showOpenDialog, showSaveDialog } from '@/ipc/dialogs';
import { broadcastIpcEvent, defineIpcHandlers } from '@/ipc/main';
import type { TargetPlaylistCollectionRequest, TargetPlaylistSelectionRequest } from '@/modules/playlists/api';
import {
   parsePlaylistLink,
   playlistFileExtension,
   playlistLinkScheme,
   type PlaylistExportChoice,
   type PlaylistImportChoice,
   type PlaylistLinkProtocolResult,
   type PlaylistLinkProtocolState,
   type PlaylistOpenFolderResult
} from '@/modules/playlists/contract';
import { playlistsIpc } from '@/modules/playlists/ipc';
import type { PlaylistService } from '@/modules/playlists/main/playlist-service';
import { canUnregisterProtocol, isProtocolRegistered, onDeepLink, onFileOpened, setProtocolRegistered } from '@/modules/shortcuts/main/deep-link';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

import { basename } from 'node:path';

const importFilters = [{ name: 'Playlist', extensions: ['bplist', 'json'] }];

export function createPlaylistsIpcModule(service: PlaylistService) {
   onDeepLink([playlistLinkScheme], (link) => {
      const parsed = parsePlaylistLink(link);
      broadcastIpcEvent(
         playlistsIpc.onLinkOpened,
         parsed.status === 'ok' ? { status: 'ready', source: { kind: 'url', url: parsed.url } } : { status: 'rejected', issue: parsed.issue }
      );
   });

   onFileOpened([playlistFileExtension], (path) => {
      broadcastIpcEvent(playlistsIpc.onLinkOpened, { status: 'ready', source: { kind: 'file', path, fileName: basename(path) } });
   });

   return defineIpcHandlers(playlistsIpc, {
      getPlaylistLinkState: () => readLinkState(),
      openPlaylistFolder: (_event, request) => openPlaylistsFolder(service, request),
      choosePlaylistImport,
      importPlaylists: (_event, request) =>
         request.targetId === localTargetId
            ? service.startImport({ installId: request.installId, paths: request.paths })
            : unsupportedTarget('playlists', 'manage playlists', request),
      choosePlaylistExport,
      exportPlaylists: (_event, request) =>
         request.targetId === localTargetId
            ? service.startExport({ installId: request.installId, playlistIds: request.playlistIds, destinationPath: request.destinationPath })
            : unsupportedTarget('playlists', 'manage playlists', request),
      setPlaylistLinkRegistered: (_event, request) => setLinkRegistered(request.registered)
   });
}

async function openPlaylistsFolder(service: PlaylistService, request: TargetPlaylistCollectionRequest): Promise<PlaylistOpenFolderResult> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const path = await service.getPlaylistsPath({ installId: request.installId });
   if (!path) return { status: 'failed', message: 'this install has no playlists folder yet' };

   const failed = await shell.openPath(path);
   return failed ? { status: 'failed', message: failed } : { status: 'opened' };
}

async function choosePlaylistImport(event: IpcMainInvokeEvent, request: TargetPlaylistCollectionRequest): Promise<PlaylistImportChoice> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const picked = await showOpenDialog(event, {
      properties: ['openFile', 'multiSelections'],
      filters: importFilters
   });

   if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled' };

   return { status: 'selected', paths: picked.filePaths };
}

async function choosePlaylistExport(event: IpcMainInvokeEvent, request: TargetPlaylistSelectionRequest): Promise<PlaylistExportChoice> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };
   if (request.playlistIds.length === 0) return { status: 'cancelled' };

   const single = request.playlistIds.length === 1;
   const chosen = await showSaveDialog(event, {
      defaultPath: single ? `playlist${playlistFileExtension}` : 'playlists.zip',
      filters: single ? [{ name: 'Playlist', extensions: ['bplist'] }] : [{ name: 'Playlist archive', extensions: ['zip'] }]
   });

   if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };

   return { status: 'selected', path: chosen.filePath };
}

function readLinkState(): PlaylistLinkProtocolState {
   return {
      scheme: playlistLinkScheme,
      registered: isProtocolRegistered(playlistLinkScheme),
      canUnregister: canUnregisterProtocol()
   };
}

function setLinkRegistered(registered: boolean): PlaylistLinkProtocolResult {
   setProtocolRegistered(playlistLinkScheme, registered);

   return { ok: true, value: readLinkState() };
}
