import { useCallback, useState } from 'react';

import type { IpcError } from '@/app/ipc/core';
import type { DownloadCatalogSnapshot, TargetReadyDownloadPreview, TargetUnavailableDownloadPreview } from '@/modules/downloads/contract';
import type { OperationId } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import type { StoreKind } from '@/modules/stores/contract';
import type { TargetId } from '@/modules/targets/contract';

type VersionDownloadState =
   | { status: 'idle' }
   | { status: 'loading' }
   | { status: 'catalog-unavailable'; catalog: DownloadCatalogSnapshot | null }
   | { status: 'choosing-store'; catalog: DownloadCatalogSnapshot }
   | { status: 'picking'; catalog: DownloadCatalogSnapshot; store: StoreKind }
   | { status: 'checking'; catalog: DownloadCatalogSnapshot; store: StoreKind; version: string }
   | { status: 'unavailable'; catalog: DownloadCatalogSnapshot; store: StoreKind; preview: TargetUnavailableDownloadPreview }
   | { status: 'ready'; catalog: DownloadCatalogSnapshot; store: StoreKind; preview: TargetReadyDownloadPreview }
   | { status: 'starting'; preview: TargetReadyDownloadPreview }
   | { status: 'running'; preview: TargetReadyDownloadPreview; operationId: OperationId }
   | { status: 'failed'; error: IpcError };

export type VersionDownloader = ReturnType<typeof useVersionDownload>;

export function useVersionDownload(targetId: TargetId) {
   const downloads = window.encore.downloads;
   const { operations, cancelOperation } = useOperations(targetId);
   const [state, setState] = useState<VersionDownloadState>({ status: 'idle' });

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const load = useCallback(
      async (refresh: boolean) => {
         setState({ status: 'loading' });

         const response = await (refresh ? downloads.refreshCatalog({ targetId }) : downloads.getCatalog({ targetId })).catch(() => null);
         const catalog = response?.status === 'ok' ? response.value : null;
         setState(catalog?.status === 'ready' ? { status: 'choosing-store', catalog } : { status: 'catalog-unavailable', catalog });
      },
      [downloads, targetId]
   );

   const open = useCallback(() => load(false), [load]);
   const refresh = useCallback(() => load(true), [load]);

   const chooseStore = useCallback((store: StoreKind) => {
      setState((current) => (current.status === 'choosing-store' ? { status: 'picking', catalog: current.catalog, store } : current));
   }, []);

   const check = useCallback(
      async (catalog: DownloadCatalogSnapshot, store: StoreKind, version: string) => {
         setState({ status: 'checking', catalog, store, version });

         const response = await downloads.preview({ targetId, store, version }).catch(() => null);
         if (!response || response.status !== 'ok' || !response.value) {
            setState({ status: 'failed', error: { code: 'downloads.preview-failed', message: 'the download could not be prepared' } });
            return;
         }
         const preview = { ...response.value, targetId: response.targetId };

         setState(preview.status === 'ok' ? { status: 'ready', catalog, store, preview } : { status: 'unavailable', catalog, store, preview });
      },
      [downloads, targetId]
   );

   const select = useCallback(
      async (version: string) => {
         if (state.status !== 'picking') return;

         await check(state.catalog, state.store, version);
      },
      [check, state]
   );

   const recheck = useCallback(async () => {
      if (state.status !== 'unavailable' && state.status !== 'ready') return;
      if (!state.preview.version) return;

      await check(state.catalog, state.store, state.preview.version);
   }, [check, state]);

   const back = useCallback(() => {
      setState((current) => {
         if (current.status === 'picking') return { status: 'choosing-store', catalog: current.catalog };
         if (current.status === 'ready' || current.status === 'unavailable' || current.status === 'checking') {
            return { status: 'picking', catalog: current.catalog, store: current.store };
         }

         return current;
      });
   }, []);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const preview = state.preview;
      setState({ status: 'starting', preview });

      const response = await downloads.start({ targetId, store: preview.store, version: preview.version }).catch(() => null);
      const started = response?.status === 'ok' ? response.value : null;
      setState(
         started?.ok
            ? { status: 'running', preview, operationId: started.value.id }
            : {
                 status: 'failed',
                 error: started?.error ?? { code: 'downloads.start-failed', message: 'the download could not be started' }
              }
      );
   }, [downloads, state, targetId]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   return {
      state,
      operation,
      targetId,
      open,
      refresh,
      chooseStore,
      select,
      recheck,
      back,
      confirm,
      cancel,
      dismiss
   };
}
