import { z } from 'zod';

import {
   defineIpc,
   event,
   linkRegistrationSchema,
   request,
   type FileExportChoice,
   type FileImportChoice,
   type LinkProtocolResult,
   type LinkProtocolState,
   type OpenFolderResult
} from '@/ipc/core';
import type { PlaylistLinkEvent, PlaylistOperationResult } from '@/modules/playlists/contract';
import { targetInstallRequestSchema } from '@/modules/targets/contract';

const playlistSelectionRequestSchema = targetInstallRequestSchema.extend({
   playlistIds: z.array(z.string().min(1))
});

const playlistImportRequestSchema = targetInstallRequestSchema.extend({
   paths: z.array(z.string().min(1))
});

const playlistExportRequestSchema = playlistSelectionRequestSchema.extend({
   destinationPath: z.string().min(1)
});

export const playlistsIpc = defineIpc('playlists', {
   getPlaylistLinkState: request().returns<LinkProtocolState>(),
   openPlaylistFolder: request(targetInstallRequestSchema).returns<OpenFolderResult>(),
   choosePlaylistImport: request(targetInstallRequestSchema).returns<FileImportChoice>(),
   importPlaylists: request(playlistImportRequestSchema).returns<PlaylistOperationResult>(),
   choosePlaylistExport: request(playlistSelectionRequestSchema).returns<FileExportChoice>(),
   exportPlaylists: request(playlistExportRequestSchema).returns<PlaylistOperationResult>(),
   setPlaylistLinkRegistered: request(linkRegistrationSchema).returns<LinkProtocolResult>(),
   onLinkOpened: event<PlaylistLinkEvent>(),
   takePendingLink: request().returns<PlaylistLinkEvent | null>()
});
