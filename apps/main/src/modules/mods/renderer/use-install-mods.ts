import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { IpcError } from '@/ipc/core';
import type { TargetModRequest } from '@/modules/mods/api';
import type {
   ModActionProblem,
   ModUninstallScope,
   ReadyModChangesPreview,
   ReadyModImportPreview,
   ReadyModInstallPreview,
   ReadyModUninstallPreview
} from '@/modules/mods/contract';
import { modListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import type { OperationId } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import { inlineIpcResult, inlineTargetIpcResult } from '@/renderer/ipc-result';
import { useSnapshotMutation } from '@/renderer/query/use-snapshot-mutation';

type ReadyAction =
   | { kind: 'install'; preview: ReadyModInstallPreview }
   | { kind: 'uninstall'; preview: ReadyModUninstallPreview }
   | { kind: 'changes'; preview: ReadyModChangesPreview; installModIds: string[]; removeModIds: string[] }
   | { kind: 'import'; preview: ReadyModImportPreview };

type ModActionKind = ReadyAction['kind'];

type ModActionState =
   | { status: 'idle' }
   | { status: 'previewing'; kind: ModActionKind }
   | { status: 'invalid'; kind: ModActionKind; problem: ModActionProblem }
   | ({ status: 'ready' | 'starting' } & ReadyAction)
   | ({ status: 'running'; operationId: OperationId } & ReadyAction)
   | { status: 'failed'; kind: ModActionKind; error: IpcError };

export type InstallMods = ReturnType<typeof useInstallMods>;

export function useInstallMods(request: TargetModRequest) {
   const modsApi = window.encore.mods;
   const queryClient = useQueryClient();
   const { operations, cancelOperation } = useOperations(request.targetId);
   const queryKey = modListQueryOptions(request).queryKey;
   const mods = useQuery(modListQueryOptions(request));
   const refreshMods = useSnapshotMutation({ queryKey, run: () => modsApi.refreshMods(request) });
   const [selection, setSelection] = useState<{ key: string; ids: string[] } | null>(null);
   const [state, setState] = useState<ModActionState>({ status: 'idle' });
   const [linkBlocked, setLinkBlocked] = useState(false);
   const refreshedRequest = useRef<string | null>(null);

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;
   const snapshot = mods.data?.status === 'ok' ? mods.data.value : null;
   const refreshKey = `${request.targetId}\0${request.installId}`;

   const installedIds = useMemo(
      () => (snapshot?.status === 'ready' ? snapshot.mods.filter((mod) => mod.state !== 'available').map((mod) => mod.modId) : []),
      [snapshot]
   );
   const selectionKey = JSON.stringify([request.targetId, request.installId, [...installedIds].sort()]);
   const selected = selection?.key === selectionKey ? selection.ids : installedIds;

   if (selection && selection.key !== selectionKey) setSelection(null);

   useEffect(() => {
      if (!snapshot || refreshedRequest.current === refreshKey) return;

      refreshedRequest.current = refreshKey;
      const updatedAt = snapshot.status === 'ready' ? Date.parse(snapshot.updatedAt) : 0;
      if (snapshot.status === 'ready' && snapshot.source === 'remote' && Date.now() - updatedAt < 30_000) return;

      void Result.tryPromise({ try: () => modsApi.refreshMods(request), catch: (cause) => cause }).then((refreshed) => {
         if (Result.isOk(refreshed)) queryClient.setQueryData(queryKey, refreshed.value);
      });
   }, [modsApi, queryClient, queryKey, refreshKey, request, snapshot]);

   const reload = useCallback(() => void queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);

   const toggle = useCallback(
      (modId: string) => {
         setSelection((current) => {
            const ids = current?.key === selectionKey ? current.ids : installedIds;
            return {
               key: selectionKey,
               ids: ids.includes(modId) ? ids.filter((candidate) => candidate !== modId) : [...ids, modId]
            };
         });
      },
      [installedIds, selectionKey]
   );

   const resetSelection = useCallback(() => setSelection(null), []);

   const select = useCallback(
      (modIds: string[]) => {
         setSelection((current) => {
            const ids = current?.key === selectionKey ? current.ids : installedIds;
            return { key: selectionKey, ids: [...new Set([...ids, ...modIds])] };
         });
      },
      [installedIds, selectionKey]
   );

   const openLink = useCallback((url: string) => {
      void window.encore.app.openLink({ url }).then(
         (result) => setLinkBlocked(result.status === 'blocked'),
         () => setLinkBlocked(true)
      );
   }, []);

   const previewInstall = useCallback(
      async (modIds: string[]) => {
         setState({ status: 'previewing', kind: 'install' });

         const response = await modsApi.previewInstall({ ...request, modIds }).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({ status: 'failed', kind: 'install', error: { code: 'mods.preview-failed', message: 'the mods could not be read' } });
            return;
         }

         const previewed = response.value;
         setState(
            previewed.status === 'ok'
               ? { status: 'ready', kind: 'install', preview: previewed }
               : { status: 'invalid', kind: 'install', problem: previewed }
         );
      },
      [modsApi, request]
   );

   const previewUninstall = useCallback(
      async (scope: ModUninstallScope, modIds: string[]) => {
         setState({ status: 'previewing', kind: 'uninstall' });

         const response = await modsApi.previewUninstall({ ...request, scope, modIds }).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({ status: 'failed', kind: 'uninstall', error: { code: 'mods.preview-failed', message: 'the mods could not be read' } });
            return;
         }

         const previewed = response.value;
         setState(
            previewed.status === 'ok'
               ? { status: 'ready', kind: 'uninstall', preview: previewed }
               : { status: 'invalid', kind: 'uninstall', problem: previewed }
         );
      },
      [modsApi, request]
   );

   const previewChanges = useCallback(
      async (installModIds: string[], removeModIds: string[]) => {
         setState({ status: 'previewing', kind: 'changes' });

         const response = await Result.tryPromise({
            try: () => modsApi.previewChanges({ ...request, installModIds, removeModIds }),
            catch: (cause) => cause
         });
         if (Result.isError(response) || response.value.status !== 'ok') {
            setState({ status: 'failed', kind: 'changes', error: { code: 'mods.preview-failed', message: 'the mods could not be read' } });
            return;
         }

         const previewed = response.value.value;
         setState(
            previewed.status === 'ok'
               ? { status: 'ready', kind: 'changes', preview: previewed, installModIds, removeModIds }
               : { status: 'invalid', kind: 'changes', problem: previewed }
         );
      },
      [modsApi, request]
   );

   const chooseImport = useCallback(async () => {
      setState({ status: 'previewing', kind: 'import' });

      const chosen = await modsApi.chooseImportSource(request).catch(() => null);
      if (!chosen) {
         setState({ status: 'failed', kind: 'import', error: { code: 'mods.import.preview-failed', message: 'the file could not be read' } });
         return;
      }

      if (chosen.status === 'cancelled') {
         setState({ status: 'idle' });
         return;
      }

      if (chosen.status === 'unsupported') {
         setState({ status: 'invalid', kind: 'import', problem: { status: 'invalid', ...request, issue: 'unsupported-target' } });
         return;
      }

      setState(
         chosen.preview.status === 'ok'
            ? { status: 'ready', kind: 'import', preview: chosen.preview }
            : { status: 'invalid', kind: 'import', problem: chosen.preview }
      );
   }, [modsApi, request]);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const pending: ModActionState = { ...state, status: 'starting' };
      setState(pending);

      const fallback = {
         code: 'mods.start-failed',
         message: 'the action could not be started'
      };
      const started =
         state.kind === 'import'
            ? await inlineIpcResult(
                 () => modsApi.import({ ...request, sourcePath: state.preview.sourcePath, uploadId: state.preview.uploadId }),
                 fallback
              )
            : state.kind === 'changes'
              ? await inlineTargetIpcResult(
                   () =>
                      modsApi.applyChanges({
                         ...request,
                         installModIds: state.installModIds,
                         removeModIds: state.removeModIds
                      }),
                   fallback
                )
              : await inlineTargetIpcResult(
                   () =>
                      state.kind === 'install'
                         ? modsApi.installMods({ ...request, modIds: state.preview.mods.map((mod) => mod.modId) })
                         : modsApi.uninstallMods({ ...request, scope: state.preview.scope, modIds: state.preview.mods.map((mod) => mod.modId) }),
                   fallback
                );

      setState(
         started.ok ? { ...pending, status: 'running', operationId: started.value.id } : { status: 'failed', kind: state.kind, error: started.error }
      );
   }, [modsApi, request, state]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => {
      const rescan = state.status === 'running';
      if (state.status === 'ready' && state.kind === 'import' && state.preview.uploadId) {
         void modsApi.discardImportUpload({ ...request, uploadId: state.preview.uploadId });
      }
      setState({ status: 'idle' });

      if (rescan) reload();
   }, [modsApi, reload, request, state]);

   const status = mods.isError ? 'error' : mods.isPending || refreshMods.isPending ? 'loading' : 'ready';

   return {
      snapshot,
      status,
      selected,
      state,
      operation,
      linkBlocked,
      reload,
      refresh: () => refreshMods.mutate(),
      toggle,
      select,
      resetSelection,
      openLink,
      previewInstall,
      previewUninstall,
      previewChanges,
      chooseImport,
      confirm,
      cancel,
      dismiss
   };
}
