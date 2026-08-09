import { z } from 'zod';

import { defineDomainApi, targetProcedure, type TargetCall } from '@/lib/api';
import { operationResultSchema } from '@/modules/operations/contract';
import { playlistCollectionSnapshotSchema, playlistDeletePreviewSchema, playlistDetailSchema } from '@/modules/playlists/contract';

const install = z.object({ installId: z.string().min(1) });

export const playlistsApi = defineDomainApi(
   'playlists',
   {
      list: targetProcedure({ capability: 'manage-playlists', input: install, output: playlistCollectionSnapshotSchema }),
      rescan: targetProcedure({ capability: 'manage-playlists', input: install, output: playlistCollectionSnapshotSchema }),
      getDetail: targetProcedure({
         capability: 'manage-playlists',
         input: install.extend({ playlistId: z.string().min(1) }),
         output: playlistDetailSchema.nullable()
      }),
      previewDelete: targetProcedure({
         capability: 'manage-playlists',
         input: install.extend({ playlistIds: z.array(z.string().min(1)), deleteMaps: z.boolean().optional() }),
         output: playlistDeletePreviewSchema
      }),
      startDelete: targetProcedure({
         capability: 'manage-playlists',
         input: install.extend({ playlistIds: z.array(z.string().min(1)), deleteMaps: z.boolean().optional() }),
         output: operationResultSchema
      }),
      startDownload: targetProcedure({
         capability: 'manage-playlists',
         input: install.extend({ url: z.string().min(1) }),
         output: operationResultSchema
      }),
      startInstallMissing: targetProcedure({
         capability: 'manage-playlists',
         input: install.extend({ playlistId: z.string().min(1) }),
         output: operationResultSchema
      })
   },
   { snapshot: playlistCollectionSnapshotSchema }
);

export type TargetPlaylistCollectionRequest = TargetCall<typeof playlistsApi.procedures.list>;
export type TargetPlaylistDetailRequest = TargetCall<typeof playlistsApi.procedures.getDetail>;
export type TargetPlaylistSelectionRequest = TargetCall<typeof playlistsApi.procedures.previewDelete>;
export type TargetPlaylistDownloadRequest = TargetCall<typeof playlistsApi.procedures.startDownload>;
