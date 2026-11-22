import { useCallback } from 'react';

import type { FileExportChoice, FileImportChoice, IpcResult } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import type { Problem } from '@/lib/errors';
import type { OperationId } from '@/modules/operations/contract';
import { useOperationFlow, type OperationFlowDismissOutcome, type OperationFlowState } from '@/modules/operations/renderer/use-operation-flow';
import type { TargetId } from '@/modules/targets/contract';
import { unwrapTarget } from '@/renderer/ipc-result';

type StartedOperation = IpcResult<{ id: OperationId }> | TargetCallResult<IpcResult<{ id: OperationId }>>;

export type CollectionActionReady<DeletePreview, ItemId, ExtraKind extends string = never> =
   | { kind: 'delete'; preview: DeletePreview; selection: ItemId[] }
   | { kind: 'download' | 'export' | 'import' | ExtraKind; preview: null };

export type CollectionActionPreset<Request extends { targetId: TargetId }, ItemId, DeletePreview extends { status: 'ok' }, DownloadSource> = {
   failures: {
      start: Problem;
      preview: Problem;
      importUnsupported: Problem;
      exportUnsupported: Problem;
   };
   chooseImport: (request: Request) => Promise<FileImportChoice>;
   startImport: (request: Request, paths: string[]) => Promise<StartedOperation>;
   chooseExport: (request: Request, ids: ItemId[]) => Promise<FileExportChoice>;
   startExport: (request: Request, ids: ItemId[], destinationPath: string) => Promise<StartedOperation>;
   startDownload: (request: Request, source: DownloadSource) => Promise<StartedOperation>;
   startDelete: (request: Request, selection: ItemId[], preview: DeletePreview) => Promise<StartedOperation>;
};

export function useCollectionActions<
   Request extends { targetId: TargetId },
   ItemId,
   DeletePreview extends { status: 'ok' },
   ProblemType extends { status: 'invalid' },
   DownloadSource,
   ExtraKind extends string = never
>(request: Request, preset: CollectionActionPreset<Request, ItemId, DeletePreview, DownloadSource>, onFinished: () => void) {
   type Ready = CollectionActionReady<DeletePreview, ItemId, ExtraKind>;

   const onDismiss = useCallback(
      (_state: OperationFlowState<Ready, ProblemType>, outcome: OperationFlowDismissOutcome) => {
         if (outcome.completed) onFinished();
      },
      [onFinished]
   );
   const flow = useOperationFlow<Ready, ProblemType>(request.targetId, onDismiss);
   const { choose, preview, start, fail } = flow;

   const previewDelete = useCallback(
      (selection: ItemId[], load: () => Promise<TargetCallResult<DeletePreview | ProblemType>>, pending?: Ready) =>
         preview(
            'delete',
            async () => {
               const previewed = unwrapTarget(await load());
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'delete', preview: previewed, selection }
                  : { status: 'invalid', kind: 'delete', problem: previewed };
            },
            preset.failures.preview,
            pending
         ),
      [preset, preview]
   );

   const importItems = useCallback(
      () =>
         choose(
            'import',
            async () => {
               const chosen = await preset.chooseImport(request);
               return chosen.status === 'cancelled' ? null : chosen;
            },
            async (chosen) => {
               if (chosen.status === 'unsupported') {
                  fail('import', preset.failures.importUnsupported);
                  return;
               }

               await start({ kind: 'import', preview: null }, () => preset.startImport(request, chosen.paths), preset.failures.start);
            },
            preset.failures.start
         ),
      [choose, fail, preset, request, start]
   );

   const exportItems = useCallback(
      (ids: ItemId[]) =>
         choose(
            'export',
            async () => {
               const chosen = await preset.chooseExport(request, ids);
               return chosen.status === 'cancelled' ? null : chosen;
            },
            async (chosen) => {
               if (chosen.status === 'unsupported') {
                  fail('export', preset.failures.exportUnsupported);
                  return;
               }

               await start({ kind: 'export', preview: null }, () => preset.startExport(request, ids, chosen.path), preset.failures.start);
            },
            preset.failures.start
         ),
      [choose, fail, preset, request, start]
   );

   const download = useCallback(
      (source: DownloadSource) => start({ kind: 'download', preview: null }, () => preset.startDownload(request, source), preset.failures.start),
      [preset, request, start]
   );

   const confirm = useCallback(
      (ready: Ready) => {
         if (ready.kind !== 'delete' || !('selection' in ready)) return;

         void start(ready, () => preset.startDelete(request, ready.selection, ready.preview), preset.failures.start);
      },
      [preset, request, start]
   );

   return { flow, previewDelete, importItems, exportItems, download, confirm };
}
