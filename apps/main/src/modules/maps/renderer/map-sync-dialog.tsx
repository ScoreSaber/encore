import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';
import { ArrowLeftRight, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';

import { QuestIcon } from '@/components/headset-icons';
import { WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/components/utils';

import { causeMessage } from '@/lib/errors';
import { InstallColorSwatch } from '@/modules/installs/renderer/install-identity';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import type { MapSyncSide } from '@/modules/maps/contract';
import { isOperationTerminalStatus, type OperationId, type OperationSnapshot } from '@/modules/operations/contract';
import { OperationProgress } from '@/modules/operations/renderer/operation-progress';
import { useOperations, useTrackedOperation } from '@/modules/operations/renderer/use-operations';
import { localTargetId, type Target, type TargetId } from '@/modules/targets/contract';
import { useTargetName, useTargets } from '@/modules/targets/renderer/use-targets';
import { useFormatters } from '@/renderer/i18n/formatters';
import { unwrapIpc, unwrapTarget } from '@/renderer/ipc-result';
import { readStorageValue, writeStorageValue } from '@/renderer/storage';

type Hop = { label: string; network: boolean; wifi: boolean; host: string | null };

type SyncDialogState =
   | { status: 'selecting'; chosen: MapSyncSide | null; startError: string | null }
   | { status: 'starting'; chosen: MapSyncSide }
   | {
        status: 'running';
        chosen: MapSyncSide;
        targetId: TargetId;
        operationId: OperationId;
        initial: OperationSnapshot;
        startedAt: number;
     };

const pairingKey = (side: MapSyncSide) => `encore.map-sync.${side.targetId}\0${side.installId}`;

function rememberedPair(side: MapSyncSide): MapSyncSide | null {
   const [targetId, installId] = (readStorageValue(pairingKey(side)).unwrapOr(null) ?? '').split('\0');
   if (!targetId || !installId) return null;
   if (targetId === side.targetId && installId === side.installId) return null;
   return { targetId, installId };
}

export function MapSyncDialog({ current, onOpenChange }: { current: MapSyncSide; onOpenChange: (open: boolean) => void }) {
   const t = useTranslations('maps.sync');
   const common = useTranslations('common');
   const { targets } = useTargets();
   const [state, setState] = useState<SyncDialogState>(() => ({ status: 'selecting', chosen: rememberedPair(current), startError: null }));
   const chosen = state.chosen;
   const candidates = targets.filter((target) => target.status === 'ready' && target.capabilities.includes('manage-maps'));
   const preview = useQuery({
      queryKey: ['maps', 'sync-preview', current, chosen],
      queryFn: async () =>
         chosen ? unwrapTarget(await window.encore.mapSync.preview({ targetId: localTargetId, first: current, second: chosen })) : null,
      enabled: state.status === 'selecting' && chosen !== null
   });
   const { operations, cancelOperation } = useOperations(state.status === 'running' ? state.targetId : localTargetId);
   const locale = useLocale();
   const hops = chosen
      ? [current, chosen].flatMap((side) =>
           routeHop(
              targets.find((target) => target.id === side.targetId),
              t
           )
        )
      : [];
   const route = hops.length > 0 ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(hops.map((hop) => hop.label)) : null;
   const slow = hops.length === 2 && hops.every((hop) => hop.network);
   const sameHost = slow && hops[0]?.host !== null && hops[0]?.host === hops[1]?.host ? hops[0]?.host : null;
   const { operation: liveOperation, missing } = useTrackedOperation(
      operations,
      state.status === 'running' ? state.operationId : null,
      state.status === 'running' ? state.startedAt : 0
   );
   const operation = state.status === 'running' ? (liveOperation ?? (missing ? null : state.initial)) : null;

   const running =
      state.status === 'starting' || (state.status === 'running' && !missing && operation !== null && !isOperationTerminalStatus(operation.status));
   const previewed = preview.data;
   const counts = previewed && !previewed.problem ? previewed : null;
   const previewProblem = preview.isError ? preview.error.message || t('failed') : (previewed?.problem ?? null);
   const runsOn = targets.find((target) => target.id === previewed?.runsOn);

   const beginSync = async () => {
      if (state.status !== 'selecting' || !state.chosen) return;

      const second = state.chosen;
      setState({ status: 'starting', chosen: second });

      const started = await Result.tryPromise({
         try: async () => unwrapIpc(unwrapTarget(await window.encore.mapSync.start({ targetId: localTargetId, first: current, second }))),
         catch: causeMessage
      });
      if (Result.isError(started)) {
         setState({ status: 'selecting', chosen: second, startError: started.error });
         return;
      }

      void writeStorageValue(pairingKey(current), `${second.targetId}\0${second.installId}`);
      setState({
         status: 'running',
         chosen: second,
         targetId: started.value.targetId,
         operationId: started.value.operation.id,
         initial: started.value.operation,
         startedAt: Date.now()
      });
   };

   return (
      <Dialog open onOpenChange={(open) => (running ? undefined : onOpenChange(open))}>
         <DialogContent className="sm:max-w-md">
            <DialogHeader>
               <DialogTitle>
                  {t('title')}
                  {runsOn ? (
                     <span className="text-muted-foreground font-normal"> · {t('on', { host: runsOn.name })}</span>
                  ) : route ? (
                     <span className="text-muted-foreground font-normal"> · {t('over', { route })}</span>
                  ) : null}
               </DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {state.status === 'running' ? (
               operation ? (
                  <SyncOutcome operation={operation} />
               ) : (
                  <p className="text-destructive text-sm">{t('failed')}</p>
               )
            ) : candidates.length === 0 ? (
               <p className="text-muted-foreground text-sm">{t('noOther')}</p>
            ) : (
               <div className="flex flex-col gap-3">
                  <ul className="divide-border flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border">
                     {candidates.map((target) => (
                        <TargetInstalls
                           key={target.id}
                           target={target}
                           current={current}
                           chosen={chosen}
                           disabled={state.status === 'starting'}
                           onChoose={(side) =>
                              setState((currentState) =>
                                 currentState.status === 'selecting' ? { status: 'selecting', chosen: side, startError: null } : currentState
                              )
                           }
                        />
                     ))}
                  </ul>
                  {chosen ? (
                     <p className="text-muted-foreground flex items-center gap-2 text-sm">
                        <ArrowLeftRight className="size-4 shrink-0" />
                        {counts
                           ? counts.toFirst + counts.toSecond === 0
                              ? t('inSync')
                              : t('counts', { send: counts.toSecond, receive: counts.toFirst })
                           : (previewProblem ?? t('checking'))}
                     </p>
                  ) : null}
                  {state.status === 'selecting' && state.startError ? <p className="text-destructive text-xs">{state.startError}</p> : null}
               </div>
            )}

            {slow && !runsOn && state.status !== 'running' ? (
               <WarningLine className="text-status-warning text-xs">
                  {t('slow')} {sameHost ? t('slowSameHost', { host: sameHost }) : hops.some((hop) => hop.wifi) ? t('slowWifi') : null}
               </WarningLine>
            ) : null}

            <DialogFooter>
               {state.status === 'running' && running && operation ? (
                  <Button
                     type="button"
                     variant="outline"
                     size="sm"
                     disabled={!operation.cancelable}
                     onClick={() => void cancelOperation(operation.id)}
                  >
                     {common('cancel')}
                  </Button>
               ) : (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={() => onOpenChange(false)}>
                     {common('close')}
                  </Button>
               )}
               {state.status === 'running' ? null : (
                  <Button
                     type="button"
                     size="sm"
                     disabled={state.status !== 'selecting' || !chosen || !counts || counts.toFirst + counts.toSecond === 0}
                     onClick={() => void beginSync()}
                  >
                     <ArrowLeftRight data-icon="inline-start" />
                     {t('action')}
                  </Button>
               )}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function TargetInstalls({
   target,
   current,
   chosen,
   disabled,
   onChoose
}: {
   target: Target;
   current: MapSyncSide;
   chosen: MapSyncSide | null;
   disabled: boolean;
   onChoose: (side: MapSyncSide) => void;
}) {
   const installs = useInstalls(target.id);
   const name = useTargetName()(target);

   return (installs.snapshot?.installs ?? [])
      .filter((install) => install.status === 'ready' && (target.id !== current.targetId || install.id !== current.installId))
      .map((install) => {
         const selected = chosen?.targetId === target.id && chosen.installId === install.id;
         return (
            <li key={install.id}>
               <button
                  type="button"
                  disabled={disabled}
                  className={cn(
                     'hover:bg-muted/60 flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm disabled:cursor-default disabled:opacity-50',
                     selected && 'bg-muted/60'
                  )}
                  onClick={() => onChoose({ targetId: target.id, installId: install.id })}
               >
                  {target.kind === 'quest' ? (
                     <QuestIcon className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                     <InstallColorSwatch color={install.color} />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                     <span className="text-foreground font-medium">{install.name}</span>
                     <span className="text-muted-foreground"> · {name}</span>
                  </span>
                  {selected ? <Check className="text-primary size-4 shrink-0" /> : null}
               </button>
            </li>
         );
      });
}

function routeHop(target: Target | undefined, t: ReturnType<typeof useTranslations<'maps.sync'>>): Hop[] {
   if (!target || target.kind === 'local') return [];
   if (target.kind === 'remote') return [{ label: target.name, network: true, wifi: false, host: target.name }];
   if (target.connection === 'remote') return [{ label: target.via ?? target.name, network: true, wifi: false, host: target.via ?? null }];
   if (target.connection === 'wifi') return [{ label: t('route.wifi'), network: true, wifi: true, host: null }];
   return [{ label: t('route.usb'), network: false, wifi: false, host: null }];
}

function SyncOutcome({ operation }: { operation: OperationSnapshot }) {
   const t = useTranslations('maps.sync');
   const format = useFormatters();
   const percent = operation.progress?.percent ?? 0;

   if (operation.status === 'completed') return <p className="text-sm">{t('done')}</p>;
   if (operation.status === 'failed') return <p className="text-destructive text-sm">{operation.error?.message ?? t('failed')}</p>;
   if (operation.status === 'cancelled') return <p className="text-muted-foreground text-sm">{t('cancelled')}</p>;

   const done = operation.progress?.current ?? 0;
   const total = operation.progress?.total ?? 0;
   const elapsedSeconds = (Date.parse(operation.updatedAt) - Date.parse(operation.createdAt)) / 1000;
   const speed = elapsedSeconds >= 2 && done > 0 ? done / elapsedSeconds : null;
   const secondsLeft = speed ? Math.max(0, Math.round((total - done) / speed)) : null;

   return (
      <div className="flex flex-col gap-1.5">
         <OperationProgress percent={percent} label={operation.message ?? t('preparing')} />
         <p className="text-muted-foreground flex justify-between gap-3 text-xs tabular-nums">
            <span>{t('progress', { done: format.bytes(done), total: format.bytes(total) })}</span>
            {speed !== null && secondsLeft !== null ? (
               <span>
                  {t('speed', { speed: format.bytes(speed) })} ·{' '}
                  {secondsLeft < 60 ? t('secondsLeft', { count: secondsLeft }) : t('minutesLeft', { count: Math.ceil(secondsLeft / 60) })}
               </span>
            ) : null}
         </p>
      </div>
   );
}
