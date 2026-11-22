import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
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
import { useOperationFlow, type OperationFlowDismissOutcome, type OperationFlowState } from '@/modules/operations/renderer/use-operation-flow';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapTarget } from '@/renderer/ipc-result';
import { queryStatus, useSnapshotMutation } from '@/renderer/query/api-query';

type ModActionReady =
   | { kind: 'install'; preview: ReadyModInstallPreview }
   | { kind: 'uninstall'; preview: ReadyModUninstallPreview }
   | { kind: 'changes'; preview: ReadyModChangesPreview; installModIds: string[]; removeModIds: string[] }
   | { kind: 'import'; preview: ReadyModImportPreview };

const previewFailure = createProblem('mods.preview-failed');
const startFailure = createProblem('mods.start-failed');

export type InstallMods = ReturnType<typeof useInstallMods>;

export function useInstallMods(request: TargetModRequest) {
   const modsApi = window.encore.mods;
   const queryClient = useQueryClient();
   const { queryKey } = modListQueryOptions(request);
   const mods = useQuery(modListQueryOptions(request));
   const { targets } = useTargets();
   const platform = targets.find((target) => target.id === request.targetId)?.kind === 'quest' ? 'quest' : 'pc';
   const refreshMods = useSnapshotMutation(queryKey, async () => unwrapTarget(await modsApi.refreshMods(request)));
   const [edits, setEdits] = useState<{ scope: string; added: ReadonlySet<string>; removed: ReadonlySet<string> } | null>(null);
   const [linkBlocked, setLinkBlocked] = useState<{ scope: string; blocked: boolean }>({ scope: '', blocked: false });
   const refreshedRequest = useRef<string | null>(null);
   const reload = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);

   const onDismiss = useCallback(
      (state: OperationFlowState<ModActionReady, ModActionProblem>, outcome: OperationFlowDismissOutcome) => {
         if ((state.status === 'ready' || state.status === 'repreviewing') && state.kind === 'import' && state.preview.uploadId) {
            void modsApi.discardImportUpload({ ...request, uploadId: state.preview.uploadId });
         }
         if (state.status === 'running') {
            if (outcome.completed) setEdits(null);
            void reload();
         }
      },
      [modsApi, reload, request]
   );
   const flow = useOperationFlow<ModActionReady, ModActionProblem>(request.targetId, onDismiss);
   const { choose, preview, settle, start } = flow;

   const snapshot = mods.data ?? null;
   const refreshKey = `${request.targetId}\0${request.installId}`;

   const installedIds = useMemo(
      () => (snapshot?.status === 'ready' ? snapshot.mods.filter((mod) => mod.state !== 'available').map((mod) => mod.modId) : []),
      [snapshot]
   );
   const catalogModIds = useMemo(() => new Set(snapshot?.status === 'ready' ? snapshot.mods.map((mod) => mod.modId) : []), [snapshot]);
   const activeEdits = edits?.scope === refreshKey ? edits : null;
   const selected = useMemo(() => {
      if (!activeEdits) return installedIds;

      const next = new Set(installedIds);
      for (const id of activeEdits.removed) next.delete(id);
      for (const id of activeEdits.added) {
         if (catalogModIds.has(id)) next.add(id);
      }
      return [...next];
   }, [activeEdits, catalogModIds, installedIds]);

   const refreshOnVisit = useEffectEvent(() => {
      if (!snapshot || refreshedRequest.current === refreshKey || refreshMods.isPending) return;

      refreshedRequest.current = refreshKey;
      const updatedAt = snapshot.status === 'ready' ? Date.parse(snapshot.updatedAt) : 0;
      if (snapshot.status === 'ready' && snapshot.source === 'remote' && Date.now() - updatedAt < 30_000) return;

      const targetKey = queryKey;
      const targetRequest = request;
      void Result.tryPromise({ try: async () => unwrapTarget(await modsApi.refreshMods(targetRequest)), catch: (cause) => cause }).then(
         (refreshed) => {
            if (Result.isOk(refreshed)) queryClient.setQueryData(targetKey, refreshed.value);
         }
      );
   });
   const loaded = snapshot !== null;

   useEffect(() => {
      if (loaded) refreshOnVisit();
   }, [loaded, refreshKey]);

   const installedSet = useMemo(() => new Set(installedIds), [installedIds]);

   const toggle = useCallback(
      (modId: string) =>
         setEdits((current) => {
            const added = new Set(current?.scope === refreshKey ? current.added : []);
            const removed = new Set(current?.scope === refreshKey ? current.removed : []);
            const isSelected = (installedSet.has(modId) && !removed.has(modId)) || added.has(modId);

            if (isSelected) {
               added.delete(modId);
               if (installedSet.has(modId)) removed.add(modId);
            } else {
               removed.delete(modId);
               if (!installedSet.has(modId)) added.add(modId);
            }

            return added.size === 0 && removed.size === 0 ? null : { scope: refreshKey, added, removed };
         }),
      [installedSet, refreshKey]
   );

   const select = useCallback(
      (modIds: string[]) =>
         setEdits((current) => {
            const added = new Set(current?.scope === refreshKey ? current.added : []);
            const removed = new Set(current?.scope === refreshKey ? current.removed : []);

            for (const modId of modIds) {
               removed.delete(modId);
               if (!installedSet.has(modId)) added.add(modId);
            }

            return added.size === 0 && removed.size === 0 ? null : { scope: refreshKey, added, removed };
         }),
      [installedSet, refreshKey]
   );

   const resetSelection = useCallback(() => setEdits(null), []);

   const openLink = useCallback(
      (url: string) => {
         const scope = refreshKey;
         void window.encore.app.openLink({ url }).then(
            (result) => setLinkBlocked({ scope, blocked: result.status === 'blocked' }),
            () => setLinkBlocked({ scope, blocked: true })
         );
      },
      [refreshKey]
   );

   const previewInstall = useCallback(
      (modIds: string[]) =>
         preview(
            'install',
            async () => {
               const previewed = unwrapTarget(await modsApi.previewInstall({ ...request, modIds }));
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'install', preview: previewed }
                  : { status: 'invalid', kind: 'install', problem: previewed };
            },
            previewFailure
         ),
      [modsApi, preview, request]
   );

   const previewUninstall = useCallback(
      (scope: ModUninstallScope, modIds: string[], externalIds: string[] = []) =>
         preview(
            'uninstall',
            async () => {
               const previewed = unwrapTarget(await modsApi.previewUninstall({ ...request, scope, modIds, externalIds }));
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'uninstall', preview: previewed }
                  : { status: 'invalid', kind: 'uninstall', problem: previewed };
            },
            previewFailure
         ),
      [modsApi, preview, request]
   );

   const previewChanges = useCallback(
      (installModIds: string[], removeModIds: string[]) =>
         preview(
            'changes',
            async () => {
               const previewed = unwrapTarget(await modsApi.previewChanges({ ...request, installModIds, removeModIds }));
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'changes', preview: previewed, installModIds, removeModIds }
                  : { status: 'invalid', kind: 'changes', problem: previewed };
            },
            previewFailure
         ),
      [modsApi, preview, request]
   );

   const chooseImport = useCallback(
      () =>
         choose(
            'import',
            async () => {
               const chosen = await modsApi.chooseImportSource(request);
               return chosen.status === 'cancelled' ? null : chosen;
            },
            (chosen) => {
               if (chosen.status === 'unsupported') {
                  settle({ status: 'invalid', kind: 'import', problem: { status: 'invalid', ...request, issue: 'unsupported-target' } });
                  return;
               }

               settle(
                  chosen.preview.status === 'ok'
                     ? { status: 'ready', kind: 'import', preview: chosen.preview }
                     : { status: 'invalid', kind: 'import', problem: chosen.preview }
               );
            },
            createProblem('mods.import.preview-failed'),
            (superseded) => {
               if (superseded.status === 'selected' && superseded.preview.status === 'ok' && superseded.preview.uploadId) {
                  void modsApi.discardImportUpload({ ...request, uploadId: superseded.preview.uploadId });
               }
            }
         ),
      [choose, modsApi, request, settle]
   );

   const confirm = useCallback(
      (ready: ModActionReady) => {
         const run = () => {
            if (ready.kind === 'import')
               return modsApi.import({ ...request, sourcePath: ready.preview.sourcePath, uploadId: ready.preview.uploadId });
            if (ready.kind === 'changes')
               return modsApi.applyChanges({ ...request, installModIds: ready.installModIds, removeModIds: ready.removeModIds });
            if (ready.kind === 'install') return modsApi.installMods({ ...request, modIds: ready.preview.mods.map((mod) => mod.modId) });

            return modsApi.uninstallMods({
               ...request,
               scope: ready.preview.scope,
               modIds: ready.preview.mods.map((mod) => mod.modId),
               externalIds: ready.preview.external.map((file) => file.id)
            });
         };

         void start(ready, run, startFailure);
      },
      [modsApi, request, start]
   );

   return {
      snapshot,
      platform,
      status: refreshMods.isPending ? 'loading' : queryStatus(mods),
      selected,
      flow,
      linkBlocked: linkBlocked.scope === refreshKey && linkBlocked.blocked,
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
      confirm
   };
}
