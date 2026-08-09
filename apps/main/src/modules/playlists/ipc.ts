import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/ipc/core';
import type { TargetPlaylistCollectionRequest, TargetPlaylistSelectionRequest } from '@/modules/playlists/api';
import type {
   PlaylistExportChoice,
   PlaylistExportRequest,
   PlaylistImportChoice,
   PlaylistImportRequest,
   PlaylistLinkEvent,
   PlaylistLinkProtocolResult,
   PlaylistLinkProtocolState,
   PlaylistOpenFolderResult,
   PlaylistOperationResult
} from '@/modules/playlists/contract';
import type { TargetRequest } from '@/modules/targets/contract';
import { targetInstallRequestSchema } from '@/modules/targets/ipc';

const playlistSelectionRequestSchema = targetInstallRequestSchema.extend({
   playlistIds: z.array(z.string().min(1))
});

const playlistImportRequestSchema = targetInstallRequestSchema.extend({
   paths: z.array(z.string().min(1))
});

const playlistExportRequestSchema = playlistSelectionRequestSchema.extend({
   destinationPath: z.string().min(1)
});

const playlistLinkRegistrationSchema = z.object({
   registered: z.boolean()
});

export const playlistsIpc = defineIpcDescriptor({
   getPlaylistLinkState: defineIpcQuery<PlaylistLinkProtocolState>('playlists:link-state'),
   openPlaylistFolder: defineIpcCommand<PlaylistOpenFolderResult, TargetPlaylistCollectionRequest>(
      'playlists:open-folder',
      targetInstallRequestSchema
   ),
   choosePlaylistImport: defineIpcCommand<PlaylistImportChoice, TargetPlaylistCollectionRequest>(
      'playlists:choose-import',
      targetInstallRequestSchema
   ),
   importPlaylists: defineIpcCommand<PlaylistOperationResult, TargetRequest<PlaylistImportRequest>>('playlists:import', playlistImportRequestSchema),
   choosePlaylistExport: defineIpcCommand<PlaylistExportChoice, TargetPlaylistSelectionRequest>(
      'playlists:choose-export',
      playlistSelectionRequestSchema
   ),
   exportPlaylists: defineIpcCommand<PlaylistOperationResult, TargetRequest<PlaylistExportRequest>>('playlists:export', playlistExportRequestSchema),
   setPlaylistLinkRegistered: defineIpcCommand<PlaylistLinkProtocolResult, { registered: boolean }>(
      'playlists:set-link-registered',
      playlistLinkRegistrationSchema
   ),
   onLinkOpened: defineIpcEvent<PlaylistLinkEvent>('playlists:link-opened')
});
