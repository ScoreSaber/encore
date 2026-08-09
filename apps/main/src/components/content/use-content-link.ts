import { useCallback, useState } from 'react';

import { useQueries } from '@tanstack/react-query';

import type { IpcError, IpcResult } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import type { InstallId, InstallSummary } from '@/modules/installs/contract';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import type { OperationId, OperationSnapshot } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import { localTargetId, type Target, type TargetCapability, type TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { inlineTargetIpcResult } from '@/renderer/ipc-result';

export type ContentLinkInstall = InstallSummary & {
   key: string;
   targetId: TargetId;
   targetName: string;
};

export type ContentLinkState<Source, Issue> =
   | { status: 'idle' }
   | { status: 'rejected'; issue: Issue; detail?: string }
   | { status: 'ready' | 'starting'; source: Source }
   | { status: 'running'; source: Source; targetId: TargetId; operationId: OperationId }
   | { status: 'failed'; error: IpcError };

export function useContentLink<Source, Issue>(capability: TargetCapability, supportsTarget?: (source: Source, target: Target) => boolean) {
   const { targets } = useTargets();
   const [state, setState] = useState<ContentLinkState<Source, Issue>>({ status: 'idle' });
   const source = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.source : null;
   const eligibleTargets = targets.filter(
      (target) =>
         target.status === 'ready' && target.capabilities.includes(capability) && (!source || !supportsTarget || supportsTarget(source, target))
   );
   const installQueries = useQueries({ queries: eligibleTargets.map((target) => installListQueryOptions(target.id)) });
   const installs = eligibleTargets.flatMap((target, index): ContentLinkInstall[] =>
      (installQueries[index]?.data?.installs ?? []).map((install) => ({
         ...install,
         key: `${target.id}\0${install.id}`,
         targetId: target.id,
         targetName: target.name
      }))
   );
   const [selectedKey, setSelectedKey] = useState<string | null>(null);
   const selectedInstall = installs.find((install) => install.key === selectedKey) ?? installs[0] ?? null;
   const operationTargetId = state.status === 'running' ? state.targetId : (selectedInstall?.targetId ?? localTargetId);
   const { operations, cancelOperation } = useOperations(operationTargetId);
   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const accept = useCallback((source: Source) => setState({ status: 'ready', source }), []);
   const reject = useCallback((issue: Issue, detail?: string) => setState({ status: 'rejected', issue, ...(detail ? { detail } : {}) }), []);

   const startTarget = useCallback(
      async (
         run: (source: Source, targetId: TargetId, installId: InstallId) => Promise<TargetCallResult<IpcResult<OperationSnapshot>>>,
         error: IpcError
      ) => {
         if (state.status !== 'ready' || !selectedInstall) return;

         const source = state.source;
         setState({ status: 'starting', source });

         const started = await inlineTargetIpcResult(() => run(source, selectedInstall.targetId, selectedInstall.id), error);
         setState(
            started.ok
               ? { status: 'running', source, targetId: selectedInstall.targetId, operationId: started.value.id }
               : { status: 'failed', error: started.error }
         );
      },
      [selectedInstall, state]
   );

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   return {
      state,
      operation,
      installs,
      selectedInstallKey: selectedInstall?.key ?? null,
      selectInstall: setSelectedKey,
      accept,
      reject,
      startTarget,
      cancel,
      dismiss
   };
}
