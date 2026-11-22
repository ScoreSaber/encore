import { useCallback } from 'react';

import { useCollectionActions, type CollectionActionPreset } from '@/components/collection/use-collection-actions';

import { createProblem } from '@/lib/errors';
import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { MapActionProblem, MapDownloadSource, MapId, ReadyMapDeletePreview } from '@/modules/maps/contract';

const mapActionsPreset: CollectionActionPreset<TargetMapCollectionRequest, MapId, ReadyMapDeletePreview, MapDownloadSource> = {
   failures: {
      start: createProblem('maps.start-failed'),
      preview: createProblem('maps.preview-failed'),
      importUnsupported: createProblem('maps.import-unsupported'),
      exportUnsupported: createProblem('maps.export-unsupported')
   },
   chooseImport: (request) => window.encore.maps.chooseMapImport(request),
   startImport: (request, paths) => window.encore.maps.importMaps({ ...request, paths }),
   chooseExport: (request, mapIds) => window.encore.maps.chooseMapExport({ ...request, mapIds }),
   startExport: (request, mapIds, destinationPath) => window.encore.maps.exportMaps({ ...request, mapIds, destinationPath }),
   startDownload: (request, source) => window.encore.maps.startDownload({ ...request, source }),
   startDelete: (request, mapIds) => window.encore.maps.startDelete({ ...request, mapIds })
};

export type MapActions = ReturnType<typeof useMapActions>;

export function useMapActions(request: TargetMapCollectionRequest, onFinished: () => void) {
   const {
      flow,
      previewDelete: runPreviewDelete,
      confirm,
      importItems: importMaps,
      exportItems: exportMaps,
      download: downloadMap
   } = useCollectionActions<TargetMapCollectionRequest, MapId, ReadyMapDeletePreview, MapActionProblem, MapDownloadSource>(
      request,
      mapActionsPreset,
      onFinished
   );

   const previewDelete = useCallback(
      (mapIds: MapId[]) => runPreviewDelete(mapIds, () => window.encore.maps.previewDelete({ ...request, mapIds })),
      [request, runPreviewDelete]
   );

   const openFolder = useCallback((mapId: MapId) => window.encore.maps.openMapFolder({ ...request, mapId }), [request]);

   return { flow, previewDelete, confirm, importMaps, exportMaps, downloadMap, openFolder };
}
