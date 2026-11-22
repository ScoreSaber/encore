import { useCallback } from 'react';

import { useCollectionActions, type CollectionActionPreset } from '@/components/collection/use-collection-actions';

import { createProblem } from '@/lib/errors';
import type { TargetModelCollectionRequest } from '@/modules/models/api';
import type { ModelActionProblem, ModelDownloadSource, ModelId, ReadyModelDeletePreview } from '@/modules/models/contract';

const modelActionsPreset: CollectionActionPreset<TargetModelCollectionRequest, ModelId, ReadyModelDeletePreview, ModelDownloadSource> = {
   failures: {
      start: createProblem('models.start-failed'),
      preview: createProblem('models.preview-failed'),
      importUnsupported: createProblem('models.import-unsupported'),
      exportUnsupported: createProblem('models.export-unsupported')
   },
   chooseImport: (request) => window.encore.models.chooseModelImport(request),
   startImport: (request, paths) => window.encore.models.importModels({ ...request, paths }),
   chooseExport: (request, modelIds) => window.encore.models.chooseModelExport({ ...request, modelIds }),
   startExport: (request, modelIds, destinationPath) => window.encore.models.exportModels({ ...request, modelIds, destinationPath }),
   startDownload: (request, source) => window.encore.models.startDownload({ ...request, source }),
   startDelete: (request, modelIds) => window.encore.models.startDelete({ ...request, modelIds })
};

export type ModelActions = ReturnType<typeof useModelActions>;

export function useModelActions(request: TargetModelCollectionRequest, onFinished: () => void) {
   const {
      flow,
      previewDelete: runPreviewDelete,
      confirm,
      importItems: importModels,
      exportItems: exportModels,
      download: downloadModel
   } = useCollectionActions<TargetModelCollectionRequest, ModelId, ReadyModelDeletePreview, ModelActionProblem, ModelDownloadSource>(
      request,
      modelActionsPreset,
      onFinished
   );

   const previewDelete = useCallback(
      (modelIds: ModelId[]) => runPreviewDelete(modelIds, () => window.encore.models.previewDelete({ ...request, modelIds })),
      [request, runPreviewDelete]
   );

   const openFolder = useCallback((modelId: ModelId) => window.encore.models.openModelFolder({ ...request, modelId }), [request]);

   return { flow, previewDelete, confirm, importModels, exportModels, downloadModel, openFolder };
}
