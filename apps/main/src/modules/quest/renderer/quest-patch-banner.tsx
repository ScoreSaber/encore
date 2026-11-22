import { useEffect, useEffectEvent, useRef } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Save, Wrench } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/utils';

import { createProblem } from '@/lib/errors';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { isOperationTerminalStatus, type OperationSnapshot } from '@/modules/operations/contract';
import { OperationProgress } from '@/modules/operations/renderer/operation-progress';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import { questInstallId } from '@/modules/quest/contract';
import { questStateQueryOptions } from '@/modules/quest/renderer/quest-queries';
import type { TargetId } from '@/modules/targets/contract';

export function useQuestPatch(targetId: TargetId, onPatched: () => void) {
   const { operations } = useOperations(targetId);
   const flow = useOperationFlow<{ kind: 'patch' }>(targetId);
   const operation =
      flow.state.status === 'starting' ? null : (flow.operation ?? operations.findLast((candidate) => candidate.kind === 'patch') ?? null);
   const patching = flow.state.status === 'starting' || (operation !== null && !isOperationTerminalStatus(operation.status));
   const error = flow.state.status === 'failed' ? flow.state.error : operation?.status === 'failed' ? (operation.error ?? null) : null;
   const failed = flow.state.status === 'failed' || operation?.status === 'failed';
   const activePatchId = useRef<string | null>(null);
   const notifiedPatchId = useRef<string | null>(null);

   const patched = useEffectEvent(onPatched);

   useEffect(() => {
      activePatchId.current = null;
      notifiedPatchId.current = null;
   }, [targetId]);

   useEffect(() => {
      if (!operation) return;
      if (!isOperationTerminalStatus(operation.status)) {
         activePatchId.current = operation.id;
         return;
      }
      if (operation.status !== 'completed') return;
      const startedOrObservedHere = flow.operation?.id === operation.id || activePatchId.current === operation.id;
      if (startedOrObservedHere && notifiedPatchId.current !== operation.id) {
         notifiedPatchId.current = operation.id;
         patched();
      }
   }, [flow.operation?.id, operation]);

   const start = () => void flow.start({ kind: 'patch' }, () => window.encore.quest.patch({ targetId }), createProblem('quest.patch.start-failed'));

   return { operation, patching, failed, error, start };
}

export function QuestPatchProgress({ operation }: { operation: OperationSnapshot | null }) {
   const t = useTranslations('mods.quest');

   return (
      <OperationProgress
         percent={Math.min(Math.max(operation?.progress?.percent ?? 0, 0), 100)}
         label={t('patching', { label: operation?.progress?.label ?? '' })}
      />
   );
}

export function QuestPatchBanner({ targetId, onPatched }: { targetId: TargetId; onPatched: () => void }) {
   const t = useTranslations('mods.quest');
   const installs = useInstalls(targetId);
   const uninstalled = installs.snapshot?.installs.some((install) => install.id === questInstallId && install.version === null) ?? false;
   const state = useQuery(questStateQueryOptions(targetId));
   const { operation, patching, failed, error, start } = useQuestPatch(targetId, onPatched);

   if (state.data?.modded && !patching) return null;

   return (
      <div className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3">
         {patching ? (
            <QuestPatchProgress operation={operation} />
         ) : (
            <div className="flex flex-wrap items-center gap-3">
               <span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                  <Wrench className="size-4" />
               </span>
               <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-foreground text-sm font-medium">{t(uninstalled ? 'uninstalled' : 'unpatched')}</p>
                  <p className={cn('text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}>
                     {t(failed ? 'patchFailed' : uninstalled ? 'reinstallWarning' : 'patchWarning')}
                  </p>
               </div>
               <Button type="button" size="sm" onClick={start}>
                  {t(failed ? 'patchRetry' : 'patchAction')}
               </Button>
            </div>
         )}
         {error?.message && !patching ? <p className="text-muted-foreground text-xs break-all">{error.message}</p> : null}
         {state.data?.savedPlayerData && !uninstalled ? (
            <p className="text-muted-foreground flex gap-2 border-t pt-3 text-xs">
               <Save className="size-3.5 shrink-0" />
               <span className="min-w-0">{t('savedPlayerData')}</span>
            </p>
         ) : null}
      </div>
   );
}
