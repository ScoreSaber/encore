import { useCallback, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import type { ReadyDownloadPreview, UnavailableDownloadPreview } from '@/modules/downloads/contract';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import type { StoreKind } from '@/modules/stores/contract';
import { localTargetId, type TargetId } from '@/modules/targets/contract';
import { unwrapTarget } from '@/renderer/ipc-result';
import { targetKey } from '@/renderer/query/api-query';

type DownloadReady = { kind: 'download'; preview: ReadyDownloadPreview };
type DownloadStep =
   | { status: 'closed' }
   | { status: 'where' }
   | { status: 'stores' }
   | { status: 'versions'; store: StoreKind; version: string | null };

const previewFailure = createProblem('downloads.inspect-failed');

export type VersionDownloader = ReturnType<typeof useVersionDownload>;

export function useVersionDownload() {
   const downloads = window.encore.downloads;
   const queryClient = useQueryClient();
   const [step, setStep] = useState<DownloadStep>({ status: 'closed' });
   const [targetId, setTargetId] = useState<TargetId>(localTargetId);
   const [askedWhere, setAskedWhere] = useState(false);
   const flow = useOperationFlow<DownloadReady, UnavailableDownloadPreview>(targetId);
   const queryKey = targetKey('downloads', targetId, 'getCatalog');
   const catalogQuery = useQuery({
      queryKey,
      queryFn: async () => unwrapTarget(await downloads.getCatalog({ targetId })),
      enabled: step.status === 'stores' || step.status === 'versions',
      staleTime: 0
   });
   const catalog = catalogQuery.data ?? null;
   const { dismiss: dismissFlow, preview: previewFlow, start: startFlow } = flow;

   const open = useCallback(
      (destination: TargetId) => {
         dismissFlow();
         setTargetId(destination);
         setAskedWhere(false);
         setStep({ status: 'stores' });
      },
      [dismissFlow]
   );

   const openWhere = useCallback(() => {
      dismissFlow();
      setAskedWhere(true);
      setStep({ status: 'where' });
   }, [dismissFlow]);

   const chooseTarget = useCallback(
      (destination: TargetId) => {
         dismissFlow();
         setTargetId(destination);
         setStep({ status: 'stores' });
      },
      [dismissFlow]
   );

   const refresh = useCallback(async () => {
      await Result.tryPromise(() =>
         queryClient.fetchQuery({ queryKey, queryFn: async () => unwrapTarget(await downloads.refreshCatalog({ targetId })) })
      );
   }, [downloads, queryClient, queryKey, targetId]);

   const check = useCallback(
      (store: StoreKind, version: string) => {
         setStep({ status: 'versions', store, version });

         return previewFlow(
            'download',
            async () => {
               const previewed = unwrapTarget(await downloads.preview({ targetId, store, version }));
               if (!previewed) throw new Error('the download could not be prepared');

               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'download', preview: previewed }
                  : { status: 'invalid', kind: 'download', problem: previewed };
            },
            previewFailure
         );
      },
      [downloads, previewFlow, targetId]
   );

   const chooseStore = useCallback((store: StoreKind) => setStep({ status: 'versions', store, version: null }), []);

   const select = useCallback(
      (version: string) => {
         if (step.status === 'versions') void check(step.store, version);
      },
      [check, step]
   );

   const recheck = useCallback(() => {
      if (step.status === 'versions' && step.version) void check(step.store, step.version);
   }, [check, step]);

   const back = useCallback(() => {
      if (flow.state.status !== 'idle') return dismissFlow();
      if (step.status === 'versions') setStep({ status: 'stores' });
      if (step.status === 'stores' && askedWhere) setStep({ status: 'where' });
   }, [askedWhere, dismissFlow, flow.state.status, step.status]);

   const confirm = useCallback(
      (ready: DownloadReady) =>
         void startFlow(
            ready,
            () => downloads.start({ targetId, store: ready.preview.store, version: ready.preview.version }),
            createProblem('downloads.start-failed')
         ),
      [downloads, startFlow, targetId]
   );

   const dismiss = useCallback(() => {
      dismissFlow();
      setStep({ status: 'closed' });
   }, [dismissFlow]);

   return {
      flow,
      step,
      catalog,
      catalogStatus: catalogQuery.isPending ? 'loading' : catalog?.status === 'ready' ? 'ready' : 'unavailable',
      targetId,
      askedWhere,
      open,
      openWhere,
      chooseTarget,
      refresh,
      chooseStore,
      select,
      recheck,
      back,
      confirm,
      dismiss
   };
}
