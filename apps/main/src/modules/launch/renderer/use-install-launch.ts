import { useCallback, useEffect, useMemo, useState } from 'react';

import { queryOptions, useQuery } from '@tanstack/react-query';

import type { IpcError } from '@/ipc/core';
import { createTargetIpcDescriptor } from '@/ipc/target-api';
import type { InstallActionRequest } from '@/modules/installs/contract';
import { launchApi as launchContract } from '@/modules/launch/api';
import {
   formatLaunchArgs,
   parseLaunchArgs,
   type LaunchFlag,
   type LaunchOptions,
   type LaunchPlatform,
   type LaunchRecord,
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

type InstallLaunchState =
   | { status: 'checking' }
   | { status: 'unavailable'; preview: TargetUnavailableLaunchPreview }
   | { status: 'ready' | 'starting'; preview: TargetReadyLaunchPreview }
   | { status: 'running'; preview: TargetReadyLaunchPreview; operationId: OperationId }
   | { status: 'failed'; error: IpcError };

export type InstallLaunch = ReturnType<typeof useInstallLaunch>;

export function useInstallLaunch(request: InstallActionRequest) {
   const launchApi = window.encore.launch;
   const { operations, cancelOperation } = useOperations(request.targetId);
   const [flags, setFlags] = useState<LaunchFlag[]>([]);
   const [argsInput, setArgsInput] = useState('');
   const [runAsAdmin, setRunAsAdmin] = useState(false);
   const [closeEncore, setCloseEncore] = useState(false);
   const launchState = useQuery(launchStateQueryOptions(request.targetId));
   const [activeRequest, setActiveRequest] = useState(request);
   const [state, setState] = useState<InstallLaunchState>({
      status: 'checking'
   });
   const [failure, setFailure] = useState<string | null>(null);
   const [previewNonce, setPreviewNonce] = useState(0);

   if (activeRequest.targetId !== request.targetId || activeRequest.installId !== request.installId) {
      setActiveRequest(request);
      setFlags([]);
      setArgsInput('');
      setRunAsAdmin(false);
      setCloseEncore(false);
      setState({ status: 'checking' });
      setFailure(null);
   }

   const options = useMemo<LaunchOptions>(
      () => ({ flags, args: parseLaunchArgs(argsInput), runAsAdmin, closeEncore }),
      [argsInput, closeEncore, flags, runAsAdmin]
   );

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const platform: LaunchPlatform = launchState.data?.platform ?? 'other';
   const record = launchState.data?.lastLaunch ?? null;
   const lastLaunch: LaunchRecord | null = record?.installId === request.installId ? record : null;

   useEffect(() => {
      if (!lastLaunch) return;

      setFlags(lastLaunch.options.flags);
      setArgsInput(formatLaunchArgs(lastLaunch.options.args));
      setRunAsAdmin(lastLaunch.options.runAsAdmin);
      setCloseEncore(lastLaunch.options.closeEncore);
   }, [lastLaunch]);

   useEffect(() => {
      if (state.status !== 'running' || !operation || !isOperationFinished(operation)) return;

      setFailure(operation.status === 'failed' ? (operation.error?.message ?? null) : null);
      setState({ status: 'ready', preview: state.preview });
   }, [operation, state]);

   useEffect(() => {
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
   }, [launchApi, options, request, previewNonce]);

   const recheck = useCallback(() => setPreviewNonce((current) => current + 1), []);

   const toggleFlag = useCallback((flag: LaunchFlag, enabled: boolean) => {
      setFlags((current) => (enabled ? [...current, flag] : current.filter((candidate) => candidate !== flag)));
   }, []);

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
      flags,
      argsInput,
      runAsAdmin,
      closeEncore,
      failure,
      setArgsInput,
      setRunAsAdmin,
      setCloseEncore,
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
