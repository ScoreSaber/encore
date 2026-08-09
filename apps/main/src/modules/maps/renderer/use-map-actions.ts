import { useCallback } from 'react';

import { useContentActions } from '@/components/content/use-content-actions';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { MapActionProblem, MapDownloadSource, MapId, ReadyMapDeletePreview } from '@/modules/maps/contract';

type MapActionKind = 'delete' | 'download' | 'export' | 'import';

export type MapActions = ReturnType<typeof useMapActions>;

export function useMapActions(request: TargetMapCollectionRequest, onFinished?: () => void) {
   const maps = window.encore.maps;
   const { state, setState, operation, start, startTarget, confirmTargetDelete, cancel, dismiss } = useContentActions<
      Exclude<MapActionKind, 'delete'>,
      MapActionProblem,
      ReadyMapDeletePreview,
      MapId[]
   >(
      request.targetId,
      {
         code: 'maps.start-failed',
         message: 'the map operation could not be started'
      },
      { code: 'maps.start-failed', message: 'the delete could not be started' },
      onFinished
   );

   const previewDelete = useCallback(
      async (mapIds: MapId[]) => {
         setState({ status: 'previewing', kind: 'delete' });

         const response = await maps.previewDelete({ ...request, mapIds }).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({
               status: 'failed',
               kind: 'delete',
               error: {
                  code: 'maps.preview-failed',
                  message: 'the selected maps could not be read'
               }
            });
            return;
         }

         const previewed = response.value;
         setState(
            previewed.status === 'ok'
               ? {
                    status: 'ready',
                    kind: 'delete',
                    preview: previewed,
                    selection: mapIds
                 }
               : { status: 'invalid', kind: 'delete', problem: previewed }
         );
      },
      [maps, request, setState]
   );

   const confirm = useCallback(() => confirmTargetDelete((mapIds) => maps.startDelete({ ...request, mapIds })), [confirmTargetDelete, maps, request]);

   const importMaps = useCallback(async () => {
      const chosen = await maps.chooseMapImport(request).catch(() => null);
      if (!chosen || chosen.status === 'cancelled') return;

      if (chosen.status === 'unsupported') {
         setState({
            status: 'failed',
            kind: 'import',
            error: {
               code: 'maps.import-unsupported',
               message: 'this target cannot import maps'
            }
         });
         return;
      }

      await start('import', () => maps.importMaps({ ...request, paths: chosen.paths }));
   }, [maps, request, setState, start]);

   const exportMaps = useCallback(
      async (mapIds: MapId[]) => {
         const chosen = await maps.chooseMapExport({ ...request, mapIds }).catch(() => null);
         if (!chosen || chosen.status === 'cancelled') return;

         if (chosen.status === 'unsupported') {
            setState({
               status: 'failed',
               kind: 'export',
               error: {
                  code: 'maps.export-unsupported',
                  message: 'this target cannot export maps'
               }
            });
            return;
         }

         await start('export', () => maps.exportMaps({ ...request, mapIds, destinationPath: chosen.path }));
      },
      [maps, request, setState, start]
   );

   const downloadMap = useCallback(
      (source: MapDownloadSource) => startTarget('download', () => maps.startDownload({ ...request, source })),
      [maps, request, startTarget]
   );

   const openFolder = useCallback((mapId: MapId) => maps.openMapFolder({ ...request, mapId }), [maps, request]);

   return {
      state,
      operation,
      previewDelete,
      confirm,
      importMaps,
      exportMaps,
      downloadMap,
      cancel,
      dismiss,
      openFolder
   };
}
