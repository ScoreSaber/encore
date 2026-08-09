import { useCallback, useEffect, useRef, useState } from 'react';

import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { IpcError } from '@/ipc/core';
import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { causeFailure } from '@/lib/errors';
import type { InstallActionRequest } from '@/modules/installs/contract';
import { launchApi as launchContract } from '@/modules/launch/api';
import {
   createDefaultLaunchOptions,
   formatLaunchArgs,
   parseLaunchArgs,
   type LaunchFlag,
   type LaunchOptions,
   type LaunchPlatform,
   type TargetLaunchPreview,
   type TargetReadyLaunchPreview,
   type TargetUnavailableLaunchPreview
} from '@/modules/launch/contract';
import type { OperationId } from '@/modules/operations/contract';
import { isOperationFinished } from '@/modules/operations/renderer/operation-progress';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import { localTargetId, type TargetId } from '@/modules/targets/contract';
import { ipcQueryKey } from '@/renderer/query/utils';

const previewDelayMs = 250;
const launchIpc = createTargetIpcDescriptor(launchContract);

function launchStateQueryOptions(targetId: TargetId) {
   return queryOptions({
      queryKey: ipcQueryKey(launchIpc.getState, targetId),
      queryFn: async () => {
         const response = await window.encore.launch.getState({ targetId });
         return response.status === 'ok' && response.value ? { ...response.value, targetId: response.targetId } : null;
      }
   });
}

function launchOptionsQueryOptions(request: InstallActionRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(launchIpc.getOptions, request.targetId, request.installId),
      queryFn: async () => {
         const response = await window.encore.launch.getOptions(request);
         return response.status === 'ok' ? response.value : null;
      },
      staleTime: Infinity
   });
}

type InstallLaunchState =
   | { status: 'checking' }
   | { status: 'unavailable'; preview: TargetUnavailableLaunchPreview }
   | { status: 'ready' | 'starting'; preview: TargetReadyLaunchPreview }
   | { status: 'running'; preview: TargetReadyLaunchPreview; operationId: OperationId }
   | { status: 'failed'; error: IpcError };

export type InstallLaunch = ReturnType<typeof useInstallLaunch>;

type LaunchOptionsDraft = {
   requestKey: string;
   options: LaunchOptions;
   argsInput: string;
};

export function useInstallLaunch(request: InstallActionRequest) {
   const launchApi = window.encore.launch;
   const queryClient = useQueryClient();
   const { operations, cancelOperation } = useOperations(request.targetId);
   const launchState = useQuery(launchStateQueryOptions(request.targetId));
   const optionsQueryDefinition = launchOptionsQueryOptions(request);
   const optionsQuery = useQuery(optionsQueryDefinition);
   const optionsQueryKey = optionsQueryDefinition.queryKey;
   const requestKey = `${request.targetId}\0${request.installId}`;
   const [draft, setDraft] = useState<LaunchOptionsDraft | null>(null);
   const optionsWriteQueue = useRef(Promise.resolve());
   const latestOptionsWrite = useRef(0);
   const [activeRequest, setActiveRequest] = useState(request);
   const [state, setState] = useState<InstallLaunchState>({
      status: 'checking'
   });
   const [failure, setFailure] = useState<string | null>(null);
   const [optionsFailure, setOptionsFailure] = useState<{ requestKey: string; message: string } | null>(null);
   const [previewNonce, setPreviewNonce] = useState(0);

   if (activeRequest.targetId !== request.targetId || activeRequest.installId !== request.installId) {
      setActiveRequest(request);
      setState({ status: 'checking' });
      setFailure(null);
      setOptionsFailure(null);
   }

   const record = launchState.data?.lastLaunch ?? null;
   const legacyOptions = record?.installId === request.installId ? record.options : null;
   const storedOptions = optionsQuery.data ?? legacyOptions ?? createDefaultLaunchOptions();
   const activeDraft = draft?.requestKey === requestKey ? draft : null;
   const options = activeDraft?.options ?? storedOptions;
   const flags = options.flags;
   const argsInput = activeDraft?.argsInput ?? formatLaunchArgs(options.args);
   const runAsAdmin = options.runAsAdmin;
   const closeEncore = options.closeEncore;
   const optionsReady = !optionsQuery.isPending;

   const persistOptions = useCallback(
      (next: LaunchOptions) => {
         const write = ++latestOptionsWrite.current;
         setOptionsFailure(null);
         optionsWriteQueue.current = optionsWriteQueue.current.then(async () => {
            const response = await Result.tryPromise({
               try: () => launchApi.updateOptions({ ...request, options: next }),
               catch: (cause): IpcError => ({
                  code: 'launch.options.write-failed',
                  message: causeFailure('failed to save launch settings', cause)
               })
            });

            if (Result.isError(response)) {
               if (write === latestOptionsWrite.current) setOptionsFailure({ requestKey, message: response.error.message });
               return;
            }

            const result = response.value.status === 'ok' ? response.value.value : null;
            if (!result?.ok) {
               if (write === latestOptionsWrite.current) {
                  setOptionsFailure({ requestKey, message: result?.error.message ?? 'the target did not save the launch settings' });
               }
               return;
            }

            queryClient.setQueryData(optionsQueryKey, result.value);
            if (write === latestOptionsWrite.current) setOptionsFailure(null);
         });
      },
      [launchApi, optionsQueryKey, queryClient, request, requestKey]
   );

   const updateOptions = useCallback(
      (next: LaunchOptions, nextArgsInput = formatLaunchArgs(next.args)) => {
         setDraft({ requestKey, options: next, argsInput: nextArgsInput });
         persistOptions(next);
      },
      [persistOptions, requestKey]
   );

   const updateArgsInput = useCallback(
      (input: string) => updateOptions({ ...options, args: parseLaunchArgs(input) }, input),
      [options, updateOptions]
   );

   const updateRunAsAdmin = useCallback((enabled: boolean) => updateOptions({ ...options, runAsAdmin: enabled }), [options, updateOptions]);

   const updateCloseEncore = useCallback((enabled: boolean) => updateOptions({ ...options, closeEncore: enabled }), [options, updateOptions]);

   const toggleFlag = useCallback(
      (flag: LaunchFlag, enabled: boolean) => {
         const nextFlags = enabled ? [...new Set([...flags, flag])] : flags.filter((candidate) => candidate !== flag);
         updateOptions({ ...options, flags: nextFlags });
      },
      [flags, options, updateOptions]
   );

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const platform: LaunchPlatform = launchState.data?.platform ?? 'other';

   useEffect(() => {
      if (state.status !== 'running' || !operation || !isOperationFinished(operation)) return;

      setFailure(operation.status === 'failed' ? (operation.error?.message ?? null) : null);
      setState({ status: 'ready', preview: state.preview });
   }, [operation, state]);

   useEffect(() => {
      if (!optionsReady) return;

      let disposed = false;
      const timer = setTimeout(() => {
         void launchApi
            .preview({ ...request, options })
            .then((response) => {
               if (!disposed && response.status === 'ok') {
                  setState((current) => applyPreview(current, { ...response.value, targetId: response.targetId }));
               }
            })
            .catch(() => {
               if (!disposed)
                  setState({
                     status: 'failed',
                     error: {
                        code: 'launch.preview-failed',
                        message: 'the install could not be read'
                     }
                  });
            });
      }, previewDelayMs);

      return () => {
         disposed = true;
         clearTimeout(timer);
      };
   }, [launchApi, options, optionsReady, request, previewNonce]);

   const recheck = useCallback(() => setPreviewNonce((current) => current + 1), []);

   const launch = useCallback(async () => {
      if (state.status !== 'ready') return;

      const preview = state.preview;
      setFailure(null);
      setState({ status: 'starting', preview });

      const response = await launchApi.start({ ...request, options }).catch(() => null);
      const started = response?.status === 'ok' ? response.value : null;
      if (!started?.ok) setFailure(started?.error.message ?? 'Beat Saber could not be started');
      setState(started?.ok ? { status: 'running', preview, operationId: started.value.id } : { status: 'ready', preview });
   }, [launchApi, options, request, state]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   return {
      state,
      operation,
      platform,
      localTarget: request.targetId === localTargetId,
      options,
      optionsReady,
      flags,
      argsInput,
      runAsAdmin,
      closeEncore,
      failure,
      optionsFailure: optionsFailure?.requestKey === requestKey ? optionsFailure.message : null,
      setArgsInput: updateArgsInput,
      setRunAsAdmin: updateRunAsAdmin,
      setCloseEncore: updateCloseEncore,
      toggleFlag,
      recheck,
      launch,
      cancel
   };
}

function applyPreview(current: InstallLaunchState, preview: TargetLaunchPreview): InstallLaunchState {
   if (current.status === 'starting' || current.status === 'running') return current;
   if (preview.status === 'unavailable') return { status: 'unavailable', preview };

   return { status: 'ready', preview };
}
