import { useCallback } from 'react';

import { useContentActions } from '@/components/content/use-content-actions';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import type { ModelActionProblem, ModelDownloadSource, ModelId, ReadyModelDeletePreview } from '@/modules/models/contract';

type ModelActionKind = 'delete' | 'download' | 'export' | 'import';

export type ModelActions = ReturnType<typeof useModelActions>;

export function useModelActions(request: TargetModelCollectionRequest, onFinished?: () => void) {
   const models = window.encore.models;
   const { state, setState, operation, start, startTarget, confirmTargetDelete, cancel, dismiss } = useContentActions<
      Exclude<ModelActionKind, 'delete'>,
      ModelActionProblem,
      ReadyModelDeletePreview,
      ModelId[]
   >(
      request.targetId,
      {
         code: 'models.start-failed',
         message: 'the model operation could not be started'
      },
      {
         code: 'models.start-failed',
         message: 'the delete could not be started'
      },
      onFinished
   );

   const previewDelete = useCallback(
      async (modelIds: ModelId[]) => {
         setState({ status: 'previewing', kind: 'delete' });

         const response = await models.previewDelete({ ...request, modelIds }).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({
               status: 'failed',
               kind: 'delete',
               error: {
                  code: 'models.preview-failed',
                  message: 'the selected models could not be read'
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
                    selection: modelIds
                 }
               : { status: 'invalid', kind: 'delete', problem: previewed }
         );
      },
      [models, request, setState]
   );

   const confirm = useCallback(
      () => confirmTargetDelete((modelIds) => models.startDelete({ ...request, modelIds })),
      [confirmTargetDelete, models, request]
   );

   const importModels = useCallback(async () => {
      const chosen = await models.chooseModelImport(request).catch(() => null);
      if (!chosen || chosen.status === 'cancelled') return;

      if (chosen.status === 'unsupported') {
         setState({
            status: 'failed',
            kind: 'import',
            error: {
               code: 'models.import-unsupported',
               message: 'this target cannot import models'
            }
         });
         return;
      }

      await start('import', () => models.importModels({ ...request, paths: chosen.paths }));
   }, [models, request, setState, start]);

   const exportModels = useCallback(
      async (modelIds: ModelId[]) => {
         const chosen = await models.chooseModelExport({ ...request, modelIds }).catch(() => null);
         if (!chosen || chosen.status === 'cancelled') return;

         if (chosen.status === 'unsupported') {
            setState({
               status: 'failed',
               kind: 'export',
               error: {
                  code: 'models.export-unsupported',
                  message: 'this target cannot export models'
               }
            });
            return;
         }

         await start('export', () =>
            models.exportModels({
               ...request,
               modelIds,
               destinationPath: chosen.path
            })
         );
      },
      [models, request, setState, start]
   );

   const downloadModel = useCallback(
      (source: ModelDownloadSource) => startTarget('download', () => models.startDownload({ ...request, source })),
      [models, request, startTarget]
   );

   const openFolder = useCallback((modelId: ModelId) => models.openModelFolder({ ...request, modelId }), [models, request]);

   return {
      state,
      operation,
      previewDelete,
      confirm,
      importModels,
      exportModels,
      downloadModel,
      cancel,
      dismiss,
      openFolder
   };
}
