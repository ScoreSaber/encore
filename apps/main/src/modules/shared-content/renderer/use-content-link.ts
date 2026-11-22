import { useEffect, useEffectEvent, useState } from 'react';

import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { IpcResult } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import type { Problem } from '@/lib/errors';
import type { InstallId } from '@/modules/installs/contract';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import { isOperationTerminalStatus, type OperationId, type OperationSnapshot } from '@/modules/operations/contract';
import { operationListQueryOptions } from '@/modules/operations/renderer/queries';
import { missingOperationGraceMs } from '@/modules/operations/renderer/use-operations';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import type { SharedFolderId } from '@/modules/shared-content/contract';
import { createContentLinkDestinations, findContentLinkDestination } from '@/modules/shared-content/renderer/content-link-destinations';
import { sharedContentOverviewQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import type { Target, TargetCapability, TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { inlineIpcResult } from '@/renderer/ipc-result';
import { usePendingLinkEvent } from '@/renderer/use-pending-link-event';

export type ContentLinkPreset<Event, Source, Invalid> = {
   client: { onLinkOpened: (listener: () => void) => () => void; takePendingLink: () => Promise<Event | null> };
   capability: TargetCapability;
   read: (event: Event) => { source: Source } | { problem: Invalid };
   sharedFolderIds: (source: Source) => readonly SharedFolderId[];
   supportsTarget?: (source: Source, target: Target) => boolean;
   start: (
      source: Source,
      targetId: TargetId,
      installId: InstallId
   ) => Promise<IpcResult<{ id: OperationId }> | TargetCallResult<IpcResult<{ id: OperationId }>>>;
   failures: { start: Problem; pending: Problem };
};

export function useContentLinkDestinations(supportsTarget: (target: Target) => boolean, sharedFolderIds: readonly SharedFolderId[]) {
   const { status: targetStatus, targets } = useTargets();
   const eligibleTargets = targets.filter((target) => target.status === 'ready' && supportsTarget(target));
   const installQueries = useQueries({ queries: eligibleTargets.map((target) => installListQueryOptions(target.id)) });
   const candidates = eligibleTargets.flatMap((target, index) =>
      (installQueries[index]?.data?.installs ?? []).map((install) => ({
         installId: install.id,
         name: install.name,
         targetId: target.id,
         targetName: target.name
      }))
   );
   const sharedTargets = sharedFolderIds.length === 0 ? [] : eligibleTargets.filter((target) => target.capabilities.includes('share-content'));
   const sharedQueries = useQueries({ queries: sharedTargets.map((target) => sharedContentOverviewQueryOptions(target.id)) });
   const sharedStates = sharedTargets.flatMap((target, index) =>
      (sharedQueries[index]?.data?.installs ?? []).map((install) => ({ targetId: target.id, installId: install.installId, folders: install.folders }))
   );
   const queries = [...installQueries, ...sharedQueries];
   const loadStatus =
      targetStatus === 'error' || queries.some((query) => query.isError)
         ? 'error'
         : targetStatus === 'loading' || queries.some((query) => query.isPending)
           ? 'loading'
           : 'ready';

   return { destinations: createContentLinkDestinations(candidates, sharedStates, sharedFolderIds), loadStatus };
}

type LinkDestination = ReturnType<typeof useContentLinkDestinations>['destinations'][number];
type LinkRun = { destination: LinkDestination; started: IpcResult<{ id: OperationId }> | null; missing: boolean };
export type ContentLinkProgress = LinkRun & { operation: OperationSnapshot | null };
type LinkState<Source, Invalid> =
   | { status: 'idle' }
   | { status: 'invalid'; problem: Invalid }
   | { status: 'failed'; error: Problem }
   | { status: 'ready'; source: Source; chosenKeys: ReadonlySet<string> | null; remember: boolean }
   | { status: 'running'; source: Source; automatic: boolean; invocation: symbol; runs: LinkRun[] };

export function useContentLink<Event, Source, Invalid extends { detail?: string }>(
   preset: ContentLinkPreset<Event, Source, Invalid>,
   successMessage: string
) {
   const settings = useSettings();
   const { updateApp } = settings;
   const [state, setState] = useState<LinkState<Source, Invalid>>({ status: 'idle' });
   const source = state.status === 'ready' || state.status === 'running' ? state.source : null;
   const remembered = settings.snapshot?.app.linkHandling.downloadInstalls ?? [];
   const { destinations, loadStatus } = useContentLinkDestinations(
      (target) => target.capabilities.includes(preset.capability) && (!source || !preset.supportsTarget || preset.supportsTarget(source, target)),
      source ? preset.sharedFolderIds(source) : []
   );
   const rememberedMatches = remembered.map((install) => findContentLinkDestination(destinations, install.targetId, install.installId));
   const rememberedByKey = new Map<string, LinkDestination>();
   for (const destination of rememberedMatches) {
      if (destination) rememberedByKey.set(destination.key, destination);
   }
   const rememberedFound = [...rememberedByKey.values()];
   const defaultKeys = new Set((rememberedFound.length > 0 ? rememberedFound : destinations.slice(0, 1)).map((destination) => destination.key));
   const selectedKeys = state.status === 'ready' && state.chosenKeys !== null ? state.chosenKeys : defaultKeys;
   const selected = destinations.filter((destination) => selectedKeys.has(destination.key));
   const startsByItself = remembered.length > 0 && rememberedMatches.every((destination) => destination !== null) && rememberedFound.length > 0;
   const remember = state.status === 'ready' ? state.remember : false;

   const runs = state.status === 'running' ? state.runs : [];
   const runTargetIds = [...new Set(runs.map((run) => run.destination.targetId))];
   const operationQueries = useQueries({
      queries: runTargetIds.map((targetId) => operationListQueryOptions(targetId))
   });
   const operationsByTarget = new Map<TargetId, (typeof operationQueries)[number]>();
   for (const [index, targetId] of runTargetIds.entries()) {
      const query = operationQueries[index];
      if (query) operationsByTarget.set(targetId, query);
   }
   const operations = operationQueries.flatMap((query) => query.data ?? []);
   const progress = runs.map((run): ContentLinkProgress => {
      const operationId = run.started?.ok ? run.started.value.id : null;
      return { ...run, operation: operations.find((operation) => operation.id === operationId) ?? null };
   });
   const finished =
      progress.length > 0 &&
      progress.every(
         (run) =>
            (run.started !== null && !run.started.ok) || run.missing || (run.operation !== null && isOperationTerminalStatus(run.operation.status))
      );
   const busy = state.status === 'running' && !finished;
   const canCancel = progress.some((run) => run.operation !== null && !isOperationTerminalStatus(run.operation.status) && run.operation.cancelable);
   const allCompleted = finished && progress.every((run) => !run.missing && run.operation?.status === 'completed');
   const automatic = state.status === 'running' && state.automatic;

   usePendingLinkEvent(
      preset.client,
      (event) => {
         const opened = preset.read(event);
         setState(
            'problem' in opened
               ? { status: 'invalid', problem: opened.problem }
               : { status: 'ready', source: opened.source, chosenKeys: null, remember: false }
         );
      },
      (error) => setState({ status: 'failed', error }),
      preset.failures.pending
   );

   const begin = (next: Source, targets: LinkDestination[], automaticStart: boolean) => {
      if (targets.length === 0) return;

      const invocation = Symbol('content link');
      setState({
         status: 'running',
         source: next,
         automatic: automaticStart,
         invocation,
         runs: targets.map((destination) => ({ destination, started: null, missing: false }))
      });
      for (const destination of targets) {
         void inlineIpcResult(() => preset.start(next, destination.targetId, destination.installId), preset.failures.start).then((started) =>
            setState((current) =>
               current.status === 'running' && current.invocation === invocation
                  ? { ...current, runs: current.runs.map((run) => (run.destination.key === destination.key ? { ...run, started } : run)) }
                  : current
            )
         );
      }
   };
   const beginRemembered = useEffectEvent((next: Source) => begin(next, rememberedFound, true));

   const ready = state.status === 'ready' ? state : null;
   const waitingForDefault =
      ready !== null && (settings.loadStatus === 'loading' || loadStatus === 'loading' || (loadStatus === 'ready' && startsByItself));

   useEffect(() => {
      if (ready && settings.loadStatus === 'ready' && loadStatus === 'ready' && startsByItself) beginRemembered(ready.source);
   }, [loadStatus, ready, settings.loadStatus, startsByItself]);

   const runningInvocation = state.status === 'running' ? state.invocation : null;
   const unfoundKeysKey = progress
      .filter((run) => {
         if (!run.started?.ok || run.missing || run.operation !== null) return false;
         const query = operationsByTarget.get(run.destination.targetId);
         return query !== undefined && !query.isPending;
      })
      .map((run) => run.destination.key)
      .join('\0');

   useEffect(() => {
      if (!runningInvocation || !unfoundKeysKey) return;

      const missingKeys = new Set(unfoundKeysKey.split('\0'));
      const timer = setTimeout(() => {
         setState((current) =>
            current.status === 'running' && current.invocation === runningInvocation
               ? { ...current, runs: current.runs.map((run) => (missingKeys.has(run.destination.key) ? { ...run, missing: true } : run)) }
               : current
         );
      }, missingOperationGraceMs);

      return () => clearTimeout(timer);
   }, [runningInvocation, unfoundKeysKey]);

   useEffect(() => {
      if (!automatic || !allCompleted) return;

      toast.success(successMessage);
      setState({ status: 'idle' });
   }, [allCompleted, automatic, successMessage]);

   const confirm = () => {
      if (!ready) return;
      if (ready.remember) {
         void updateApp({
            linkHandling: { downloadInstalls: selected.map((destination) => ({ targetId: destination.targetId, installId: destination.installId })) }
         });
      }

      begin(ready.source, selected, false);
   };

   const toggleDestination = (key: string, checked: boolean) => {
      setState((current) => {
         if (current.status !== 'ready') return current;

         const next = new Set(current.chosenKeys ?? defaultKeys);
         if (checked) next.add(key);
         else next.delete(key);
         return { ...current, chosenKeys: next };
      });
   };

   const cancel = () => {
      for (const run of progress) {
         if (run.operation && !isOperationTerminalStatus(run.operation.status) && run.operation.cancelable) {
            void window.encore.operations.cancel({ targetId: run.destination.targetId, id: run.operation.id });
         }
      }
   };

   return {
      state,
      progress,
      busy,
      canCancel,
      finished,
      allCompleted,
      destinations,
      selectedKeys,
      toggleDestination,
      hidden: waitingForDefault || (automatic && (busy || allCompleted)),
      remember,
      setRemember: (next: boolean) => setState((current) => (current.status === 'ready' ? { ...current, remember: next } : current)),
      confirm,
      cancel,
      dismiss: () => setState({ status: 'idle' })
   };
}

export type ContentLink<Source, Invalid extends { detail?: string }> = ReturnType<typeof useContentLink<unknown, Source, Invalid>>;
