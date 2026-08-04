import { useCallback, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { IpcError } from '@/app/ipc/core';
import { inlineIpcResult } from '@/app/renderer/ipc-result';
import type { OperationSnapshot } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

type CleanupState =
   | { status: 'idle' }
   | { status: 'confirming' }
   | { status: 'starting' }
   | { status: 'running'; initialOperation: OperationSnapshot }
   | { status: 'failed'; error: IpcError };

export type BSManagerCleanup = ReturnType<typeof useBSManagerCleanup>;

export function useBSManagerCleanup(targetId: TargetId) {
   const bsmanager = window.encore.bsmanager;
   const { operations, cancelOperation } = useOperations(targetId);
   const [state, setState] = useState<CleanupState>({ status: 'idle' });
   const planned = useQuery({
      queryKey: ['bsmanager', 'cleanup-plan', targetId],
      queryFn: () => bsmanager.planBSManagerAdoption({ targetId }),
      enabled: targetId === localTargetId
   });
   const plan = planned.data && planned.data.status === 'ok' ? planned.data : null;
   const affectedVersions = plan?.versions.filter((version) => version.folders.some((folder) => folder.state === 'foreign')) ?? [];
   const available = affectedVersions.some((version) => version.status === 'adopted');
   const operation =
      state.status === 'running' ? (operations.find((candidate) => candidate.id === state.initialOperation.id) ?? state.initialOperation) : null;

   const open = useCallback(() => {
      setState({ status: 'confirming' });
   }, []);

   const start = useCallback(async () => {
      if (state.status !== 'confirming' || !plan) return;

      setState({ status: 'starting' });
      const started = await inlineIpcResult(() => bsmanager.cleanupBSManagerSharedContent({ targetId, rootPath: plan.rootPath }), {
         code: 'bsmanager.cleanup-failed',
         message: 'the BSManager links could not be cleaned up'
      });
      setState(started.ok ? { status: 'running', initialOperation: started.value } : { status: 'failed', error: started.error });
   }, [bsmanager, plan, state.status, targetId]);

   const cancel = useCallback(() => {
      if (operation?.status === 'running') void cancelOperation(operation.id);
   }, [cancelOperation, operation]);

   const dismiss = useCallback(() => {
      setState({ status: 'idle' });
      void planned.refetch();
   }, [planned]);

   return { state, plan, affectedVersions, available, operation, open, start, cancel, dismiss };
}
