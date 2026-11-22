import { useCallback, useEffect, useRef, useState } from 'react';

import { queryOptions, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import { createLatestGuard } from '@/lib/state/machine';
import type {
   SupportDiagnosticsBundle,
   SupportExportResult,
   SupportLinkId,
   SupportLogExcerpt,
   SupportLogSelection
} from '@/modules/support/contract';
import type { TargetId } from '@/modules/targets/contract';
import { abortable, targetKey } from '@/renderer/query/api-query';

type SupportNotice = { code: 'blocked' | 'cancelled' | 'failed' | 'saved'; detail?: string };
type SupportRequest = { targetId: TargetId };
type SelectedLogState = SupportLogExcerpt | { status: 'closed' | 'loading' | 'error' };
type LogModalState =
   | { status: 'closed' }
   | { status: 'viewing'; selection: SupportLogSelection }
   | { status: 'copying' | 'saving' | 'opening'; selection: SupportLogSelection };
type SupportDiagnosticsState =
   | { status: 'closed' }
   | { status: 'building' }
   | { status: 'failed' }
   | { status: 'exporting'; bundle: SupportDiagnosticsBundle }
   | { status: 'ready'; bundle: SupportDiagnosticsBundle };

function supportLogsQueryOptions(request: SupportRequest) {
   return queryOptions({
      queryKey: targetKey('support', request.targetId, 'getLogs'),
      queryFn: ({ signal }) => abortable(signal, () => window.encore.support.getLogs(request))
   });
}

function supportLogQueryOptions(request: SupportRequest & { selection: SupportLogSelection | null }) {
   const selection = request.selection;

   return queryOptions({
      queryKey: targetKey(
         'support',
         request.targetId,
         'readLog',
         selection?.source ?? '',
         selection?.fileId ?? '',
         selection?.source === 'install' ? selection.installId : ''
      ),
      queryFn: selection
         ? ({ signal }) => abortable(signal, () => window.encore.support.readLog({ ...selection, targetId: request.targetId }))
         : skipToken
   });
}

export type Support = ReturnType<typeof useSupport>;

export function useSupport(request: SupportRequest) {
   const api = window.encore.support;
   const queryClient = useQueryClient();
   const { targetId } = request;
   const [logModal, setLogModal] = useState<LogModalState>({ status: 'closed' });
   const [notice, setNotice] = useState<SupportNotice | null>(null);
   const [diagnostics, setDiagnostics] = useState<SupportDiagnosticsState>({ status: 'closed' });
   const [shownTargetId, setShownTargetId] = useState(targetId);
   const logGuardRef = useRef<ReturnType<typeof createLatestGuard> | null>(null);
   const diagnosticsGuardRef = useRef<ReturnType<typeof createLatestGuard> | null>(null);
   const linkGuardRef = useRef<ReturnType<typeof createLatestGuard> | null>(null);

   if (shownTargetId !== targetId) {
      setShownTargetId(targetId);
      setLogModal({ status: 'closed' });
      setNotice(null);
      setDiagnostics({ status: 'closed' });
   }

   const getLogGuard = useCallback(() => {
      if (!logGuardRef.current) logGuardRef.current = createLatestGuard();
      return logGuardRef.current;
   }, []);

   const getDiagnosticsGuard = useCallback(() => {
      if (!diagnosticsGuardRef.current) diagnosticsGuardRef.current = createLatestGuard();
      return diagnosticsGuardRef.current;
   }, []);

   const getLinkGuard = useCallback(() => {
      if (!linkGuardRef.current) linkGuardRef.current = createLatestGuard();
      return linkGuardRef.current;
   }, []);

   useEffect(() => {
      const logGuard = getLogGuard();
      const diagnosticsGuard = getDiagnosticsGuard();
      const linkGuard = getLinkGuard();
      logGuard.invalidate();
      diagnosticsGuard.invalidate();
      linkGuard.invalidate();

      return () => {
         logGuard.invalidate();
         diagnosticsGuard.invalidate();
         linkGuard.invalidate();
      };
   }, [getDiagnosticsGuard, getLinkGuard, getLogGuard, targetId]);

   const selection = logModal.status === 'closed' ? null : logModal.selection;
   const logActionStatus: 'idle' | 'copying' | 'saving' | 'opening' =
      logModal.status === 'copying' || logModal.status === 'saving' || logModal.status === 'opening' ? logModal.status : 'idle';

   const logs = useQuery(supportLogsQueryOptions(request));
   const selectedLogQuery = useQuery(supportLogQueryOptions({ targetId, selection }));

   const snapshot = logs.data ?? null;
   const loadStatus = logs.isError ? 'error' : logs.isPending ? 'loading' : 'ready';
   let selectedLog: SelectedLogState = { status: 'closed' };
   if (selection) {
      if (selectedLogQuery.isError) selectedLog = { status: 'error' };
      else if (selectedLogQuery.isSuccess) selectedLog = selectedLogQuery.data;
      else selectedLog = { status: 'loading' };
   }

   const reload = useCallback(
      () => queryClient.invalidateQueries({ queryKey: supportLogsQueryOptions({ targetId }).queryKey }),
      [queryClient, targetId]
   );

   const openLink = useCallback(
      async (id: SupportLinkId) => {
         const guard = getLinkGuard();
         const token = guard.next();
         const result = Result.unwrapOr(await Result.tryPromise(() => api.openLink({ id })), null);
         if (!guard.isCurrent(token)) return;

         if (result?.status === 'opened') {
            setNotice(null);
         } else {
            const next: SupportNotice = { code: 'blocked' };
            if (result?.reason) next.detail = result.reason;
            setNotice(next);
         }
      },
      [api, getLinkGuard]
   );

   const exportSelectedLog = useCallback(
      async (destination: 'clipboard' | 'file') => {
         if (logModal.status !== 'viewing') return;

         const activeSelection = logModal.selection;
         const guard = getLogGuard();
         const token = guard.next();
         setLogModal({ status: destination === 'clipboard' ? 'copying' : 'saving', selection: activeSelection });
         const result = Result.unwrapOr(
            await Result.tryPromise(() =>
               destination === 'clipboard' ? api.copyLog({ ...activeSelection, targetId }) : api.saveLog({ ...activeSelection, targetId })
            ),
            null
         );
         if (!guard.isCurrent(token)) return;

         const next: SupportNotice | null = result ? exportNotice(result) : { code: 'failed' };
         setNotice(next);
         setLogModal(
            result?.status === 'copied' || result?.status === 'saved' ? { status: 'closed' } : { status: 'viewing', selection: activeSelection }
         );
      },
      [api, getLogGuard, logModal, targetId]
   );

   const openSelectedLog = useCallback(async () => {
      if (logModal.status !== 'viewing') return;

      const activeSelection = logModal.selection;
      const guard = getLogGuard();
      const token = guard.next();
      setLogModal({ status: 'opening', selection: activeSelection });
      const result = Result.unwrapOr(await Result.tryPromise(() => api.openLog({ ...activeSelection, targetId })), null);
      if (!guard.isCurrent(token)) return;

      if (result?.status === 'opened') {
         setLogModal({ status: 'closed' });
         return;
      }

      setLogModal({ status: 'viewing', selection: activeSelection });
      const next: SupportNotice = { code: 'failed' };
      if (result?.detail) next.detail = result.detail;
      setNotice(next);
   }, [api, getLogGuard, logModal, targetId]);

   const selectLog = useCallback(
      (next: SupportLogSelection) => {
         getLogGuard().invalidate();
         setNotice(null);
         setLogModal({ status: 'viewing', selection: next });
      },
      [getLogGuard]
   );

   const closeLog = useCallback(() => {
      if (logModal.status === 'viewing') {
         getLogGuard().invalidate();
         setLogModal({ status: 'closed' });
      }
   }, [getLogGuard, logModal.status]);

   const buildDiagnostics = useCallback(async () => {
      const guard = getDiagnosticsGuard();
      const token = guard.next();
      setNotice(null);
      setDiagnostics({ status: 'building' });

      const bundle = Result.unwrapOr(await Result.tryPromise(() => api.previewDiagnostics({ targetId })), null);
      if (!guard.isCurrent(token)) return;

      setDiagnostics((current) => (current.status !== 'building' ? current : bundle ? { status: 'ready', bundle } : { status: 'failed' }));
   }, [api, getDiagnosticsGuard, targetId]);

   const exportDiagnostics = useCallback(
      async (destination: 'clipboard' | 'file') => {
         if (diagnostics.status !== 'ready') return;

         const bundle = diagnostics.bundle;
         const guard = getDiagnosticsGuard();
         const token = guard.next();
         setDiagnostics({ status: 'exporting', bundle });

         const result = Result.unwrapOr(
            await Result.tryPromise(() => api.exportDiagnostics({ destination, fileName: bundle.fileName, text: bundle.text })),
            null
         );
         if (!guard.isCurrent(token)) return;

         const next: SupportNotice | null = result ? exportNotice(result) : { code: 'failed' };
         setNotice(next);
         setDiagnostics(
            result?.status === 'cancelled' || result?.status === 'failed' || !result ? { status: 'ready', bundle } : { status: 'closed' }
         );
      },
      [api, diagnostics, getDiagnosticsGuard]
   );

   const closeDiagnostics = useCallback(() => {
      if (diagnostics.status === 'exporting') return;

      getDiagnosticsGuard().invalidate();
      setDiagnostics({ status: 'closed' });
   }, [diagnostics.status, getDiagnosticsGuard]);

   return {
      snapshot,
      loadStatus,
      selection,
      selectedLog,
      logActionStatus,
      notice,
      diagnostics,
      reload,
      selectLog,
      closeLog,
      openLink,
      copySelectedLog: () => exportSelectedLog('clipboard'),
      saveSelectedLog: () => exportSelectedLog('file'),
      openSelectedLog,
      buildDiagnostics,
      exportDiagnostics,
      closeDiagnostics
   };
}

function exportNotice(result: SupportExportResult): SupportNotice | null {
   if (result.status === 'saved') return { code: 'saved', detail: result.path };
   if (result.status === 'failed') return { code: 'failed', detail: result.detail };
   if (result.status === 'copied') return null;

   return { code: result.status };
}
