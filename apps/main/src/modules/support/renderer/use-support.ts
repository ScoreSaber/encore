import { useCallback, useEffect, useRef, useState } from 'react';

import { queryOptions, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
   SupportDiagnosticsBundle,
   SupportExportResult,
   SupportLinkId,
   SupportLogExcerpt,
   SupportLogSelection
} from '@/modules/support/contract';
import { supportIpc } from '@/modules/support/ipc';
import type { TargetId } from '@/modules/targets/contract';
import { abortable } from '@/renderer/query/utils';
import { ipcQueryKey } from '@/renderer/query/utils';

type SupportNotice = { code: 'blocked' | 'cancelled' | 'failed' | 'saved'; detail?: string };
type SupportRequest = { targetId: TargetId };
type SelectedLogState = SupportLogExcerpt | { status: 'closed' | 'loading' | 'error' };
type SupportDiagnosticsState =
   | { status: 'closed' }
   | { status: 'building' }
   | { status: 'failed' }
   | { status: 'exporting'; bundle: SupportDiagnosticsBundle }
   | { status: 'ready'; bundle: SupportDiagnosticsBundle };

function supportLogsQueryOptions(request: SupportRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(supportIpc.getLogs, request.targetId),
      queryFn: ({ signal }) => abortable(signal, () => window.encore.support.getLogs(request))
   });
}

function supportLogQueryOptions(request: SupportRequest & { selection: SupportLogSelection | null }) {
   const selection = request.selection;

   return queryOptions({
      queryKey: ipcQueryKey(
         supportIpc.readLog,
         request.targetId,
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
   const [selection, setSelection] = useState<SupportLogSelection | null>(null);
   const [logActionStatus, setLogActionStatus] = useState<'idle' | 'copying' | 'saving' | 'opening'>('idle');
   const [notice, setNotice] = useState<SupportNotice | null>(null);
   const [diagnostics, setDiagnostics] = useState<SupportDiagnosticsState>({ status: 'closed' });
   const diagnosticsRequest = useRef(0);
   const logs = useQuery(supportLogsQueryOptions(request));
   const selectedLogQuery = useQuery(supportLogQueryOptions({ targetId, selection }));

   useEffect(() => {
      setSelection(null);
      setLogActionStatus('idle');
      setNotice(null);
      diagnosticsRequest.current += 1;
      setDiagnostics({ status: 'closed' });
   }, [targetId]);

   const snapshot = logs.data ?? null;
   const loadStatus = logs.isError ? 'error' : logs.isPending ? 'loading' : 'ready';
   let selectedLog: SelectedLogState = { status: 'closed' };
   if (selection) {
      if (selectedLogQuery.isError) selectedLog = { status: 'error' };
      else if (selectedLogQuery.isSuccess) selectedLog = selectedLogQuery.data;
      else selectedLog = { status: 'loading' };
   }

   const reload = useCallback(
      () => void queryClient.invalidateQueries({ queryKey: supportLogsQueryOptions({ targetId }).queryKey }),
      [queryClient, targetId]
   );

   const openLink = useCallback(
      async (id: SupportLinkId) => {
         const result = await api.openLink({ id }).catch(() => null);

         if (result?.status === 'opened') {
            setNotice(null);
         } else {
            const notice: SupportNotice = { code: 'blocked' };
            if (result?.reason) notice.detail = result.reason;
            setNotice(notice);
         }
      },
      [api]
   );

   const exportSelectedLog = useCallback(
      async (destination: 'clipboard' | 'file') => {
         if (!selection || logActionStatus !== 'idle') return;

         setLogActionStatus(destination === 'clipboard' ? 'copying' : 'saving');
         const result = await (destination === 'clipboard' ? api.copyLog({ ...selection, targetId }) : api.saveLog({ ...selection, targetId })).catch(
            () => null
         );
         const next: SupportNotice | null = result ? exportNotice(result) : { code: 'failed' };

         setNotice(next);
         setLogActionStatus('idle');
         if (result?.status === 'copied' || result?.status === 'saved') setSelection(null);
      },
      [api, logActionStatus, selection, targetId]
   );

   const openSelectedLog = useCallback(async () => {
      if (!selection || logActionStatus !== 'idle') return;

      setLogActionStatus('opening');
      const result = await api.openLog({ ...selection, targetId }).catch(() => null);
      setLogActionStatus('idle');

      if (result?.status === 'opened') {
         setSelection(null);
         return;
      }

      const notice: SupportNotice = { code: 'failed' };
      if (result?.message) notice.detail = result.message;
      setNotice(notice);
   }, [api, logActionStatus, selection, targetId]);

   const selectLog = useCallback((next: SupportLogSelection) => {
      setNotice(null);
      setSelection(next);
   }, []);

   const closeLog = useCallback(() => {
      if (logActionStatus === 'idle') setSelection(null);
   }, [logActionStatus]);

   const buildDiagnostics = useCallback(async () => {
      const requestId = ++diagnosticsRequest.current;
      setNotice(null);
      setDiagnostics({ status: 'building' });

      const bundle = await api.previewDiagnostics({ targetId }).catch(() => null);
      if (requestId !== diagnosticsRequest.current) return;

      setDiagnostics(bundle ? { status: 'ready', bundle } : { status: 'failed' });
   }, [api, targetId]);

   const exportDiagnostics = useCallback(
      async (destination: 'clipboard' | 'file') => {
         if (diagnostics.status !== 'ready') return;

         setDiagnostics({ status: 'exporting', bundle: diagnostics.bundle });

         const result = await api
            .exportDiagnostics({ destination, fileName: diagnostics.bundle.fileName, text: diagnostics.bundle.text })
            .catch(() => null);
         const next: SupportNotice | null = result ? exportNotice(result) : { code: 'failed' };

         setNotice(next);
         setDiagnostics(
            result?.status === 'cancelled' || result?.status === 'failed' || !result
               ? { status: 'ready', bundle: diagnostics.bundle }
               : { status: 'closed' }
         );
      },
      [api, diagnostics]
   );

   const closeDiagnostics = useCallback(() => {
      diagnosticsRequest.current += 1;
      setDiagnostics({ status: 'closed' });
   }, []);

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
   if (result.status === 'failed') return { code: 'failed', detail: result.message };
   if (result.status === 'copied') return null;

   return { code: result.status };
}
