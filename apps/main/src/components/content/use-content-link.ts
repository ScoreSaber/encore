import { useCallback, useEffect, useState } from 'react';

import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createContentLinkDestinations, findContentLinkDestination } from '@/components/content/content-link-destinations';

import type { IpcError, IpcResult } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import type { InstallId } from '@/modules/installs/contract';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import type { OperationId, OperationSnapshot } from '@/modules/operations/contract';
import { isOperationFinished } from '@/modules/operations/renderer/operation-progress';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import type { SharedFolderId } from '@/modules/shared-content/contract';
import { sharedContentOverviewQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import { localTargetId, type Target, type TargetCapability, type TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { inlineTargetIpcResult } from '@/renderer/ipc-result';

type ContentLinkDownloadOptions<Source> = {
   sharedFolderIds: (source: Source) => readonly SharedFolderId[];
   supportsTarget?: (source: Source, target: Target) => boolean;
   start: (source: Source, targetId: TargetId, installId: InstallId) => Promise<TargetCallResult<IpcResult<OperationSnapshot>>>;
   startFailure: IpcError;
   successMessage: string;
};

export type ContentLinkState<Source, Issue> =
   | { status: 'idle' }
   | { status: 'rejected'; issue: Issue; detail?: string }
   | { status: 'ready'; source: Source }
   | { status: 'starting'; source: Source; automatic: boolean }
   | {
        status: 'running';
        source: Source;
        targetId: TargetId;
        operationId: OperationId;
        automatic: boolean;
     }
   | { status: 'failed'; error: IpcError };

export function useContentLinkDestinations(supportsTarget: (target: Target) => boolean, sharedFolderIds: readonly SharedFolderId[]) {
   const { status: targetStatus, targets } = useTargets();
   const eligibleTargets = targets.filter((target) => target.status === 'ready' && supportsTarget(target));
   const installQueries = useQueries({
      queries: eligibleTargets.map((target) => installListQueryOptions(target.id))
   });
   const candidates = eligibleTargets.flatMap((target, index) =>
      (installQueries[index]?.data?.installs ?? []).map((install) => ({
         installId: install.id,
         name: install.name,
         targetId: target.id,
         targetName: target.name
      }))
   );
   const sharedTargets = sharedFolderIds.length === 0 ? [] : eligibleTargets.filter((target) => target.capabilities.includes('share-content'));
   const sharedQueries = useQueries({
      queries: sharedTargets.map((target) => sharedContentOverviewQueryOptions(target.id))
   });
   const sharedStates = sharedTargets.flatMap((target, index) => {
      const response = sharedQueries[index]?.data;

      return response?.status === 'ok'
         ? response.value.installs.map((install) => ({
              targetId: target.id,
              installId: install.installId,
              folders: install.folders
           }))
         : [];
   });
   const destinations = createContentLinkDestinations(candidates, sharedStates, sharedFolderIds);

   const loadStatus =
      targetStatus === 'error' || installQueries.some((query) => query.isError) || sharedQueries.some((query) => query.isError)
         ? 'error'
         : targetStatus === 'loading' || installQueries.some((query) => query.isPending) || sharedQueries.some((query) => query.isPending)
           ? 'loading'
           : 'ready';

   return { destinations, loadStatus };
}

export function useContentLinkDownload<Source, Issue>(capability: TargetCapability, options: ContentLinkDownloadOptions<Source>) {
   const settings = useSettings();
   const [state, setState] = useState<ContentLinkState<Source, Issue>>({ status: 'idle' });
   const [selectedKey, setSelectedKey] = useState<string | null>(null);
   const [remember, setRemember] = useState(false);
   const source = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.source : null;
   const defaultInstall = settings.snapshot?.app.linkHandling.downloadInstall ?? null;
   const { destinations, loadStatus: destinationsLoadStatus } = useContentLinkDestinations(
      (target) => target.capabilities.includes(capability) && (!source || !options.supportsTarget || options.supportsTarget(source, target)),
      source ? options.sharedFolderIds(source) : []
   );
   const defaultDestination = defaultInstall ? findContentLinkDestination(destinations, defaultInstall.targetId, defaultInstall.installId) : null;
   const selectedDestination = destinations.find((destination) => destination.key === selectedKey) ?? defaultDestination ?? destinations[0] ?? null;
   const defaultSelected = defaultDestination !== null && selectedDestination?.key === defaultDestination.key;
   const operationTargetId = state.status === 'running' ? state.targetId : (selectedDestination?.targetId ?? localTargetId);
   const { operations, cancelOperation } = useOperations(operationTargetId);
   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const accept = useCallback((source: Source) => {
      setRemember(false);
      setSelectedKey(null);
      setState({ status: 'ready', source });
   }, []);
   const reject = useCallback((issue: Issue, detail?: string) => {
      setRemember(false);
      const rejected: ContentLinkState<Source, Issue> = { status: 'rejected', issue };
      if (detail) rejected.detail = detail;
      setState(rejected);
   }, []);
   const fail = useCallback((error: IpcError) => {
      setRemember(false);
      setState({ status: 'failed', error });
   }, []);

   const start = useCallback(
      async (automatic: boolean) => {
         if (state.status !== 'ready' || !selectedDestination) return;

         const source = state.source;
         setState({ status: 'starting', source, automatic });

         const started = await inlineTargetIpcResult(
            () => options.start(source, selectedDestination.targetId, selectedDestination.installId),
            options.startFailure
         );
         setState(
            started.ok
               ? {
                    status: 'running',
                    source,
                    targetId: selectedDestination.targetId,
                    operationId: started.value.id,
                    automatic
                 }
               : { status: 'failed', error: started.error }
         );
      },
      [options.start, options.startFailure, selectedDestination, state]
   );

   const confirm = useCallback(async () => {
      if (remember && selectedDestination) {
         void settings.updateApp({
            linkHandling: {
               downloadInstall: {
                  targetId: selectedDestination.targetId,
                  installId: selectedDestination.installId
               }
            }
         });
      }

      await start(false);
   }, [remember, selectedDestination, settings, start]);

   useEffect(() => {
      if (settings.loadStatus !== 'ready' || state.status !== 'ready' || destinationsLoadStatus !== 'ready' || !defaultSelected) return;

      void start(true);
   }, [defaultSelected, destinationsLoadStatus, settings.loadStatus, start, state.status]);

   useEffect(() => {
      if (state.status !== 'running' || !state.automatic || !operation || !isOperationFinished(operation)) return;

      if (operation.status === 'completed') {
         toast.success(options.successMessage);
         setState({ status: 'idle' });
      } else {
         setState({ ...state, automatic: false });
      }
   }, [operation, options.successMessage, state]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);
   const dismiss = useCallback(() => setState({ status: 'idle' }), []);
   const waitingForAutomaticStart =
      state.status === 'ready' &&
      (settings.loadStatus === 'loading' || destinationsLoadStatus === 'loading' || (destinationsLoadStatus === 'ready' && defaultSelected));
   const automaticDownload = (state.status === 'starting' || state.status === 'running') && state.automatic;

   return {
      state,
      operation,
      destinations,
      selectedDestinationKey: selectedDestination?.key ?? null,
      selectDestination: setSelectedKey,
      accept,
      reject,
      fail,
      cancel,
      dismiss,
      dialogHidden: waitingForAutomaticStart || automaticDownload,
      remember,
      setRemember,
      confirm
   };
}
