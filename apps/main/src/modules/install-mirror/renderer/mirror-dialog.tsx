import { useCallback, useState } from 'react';

import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { createProblem } from '@/lib/errors';
import { mirrorResultSchema, type MirrorPreview, type MirrorRequest } from '@/modules/install-mirror/contract';
import { OperationProgress } from '@/modules/operations/renderer/operation-progress';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { localTargetId } from '@/modules/targets/contract';
import { useFormatters } from '@/renderer/i18n/formatters';
import { unwrapTarget } from '@/renderer/ipc-result';

type MirrorReady = { kind: 'mirror'; request: MirrorRequest; preview: MirrorPreview };

export type InstallMirror = ReturnType<typeof useInstallMirror>;

export function useInstallMirror() {
   const flow = useOperationFlow<MirrorReady, { code: string; message: string }>(localTargetId);
   const { preview, start } = flow;

   const open = useCallback(
      (request: MirrorRequest) =>
         void preview(
            'mirror',
            async () => {
               const previewed = unwrapTarget(await window.encore.installMirror.preview({ targetId: localTargetId, ...request }));
               return previewed.ok
                  ? { status: 'ready', kind: 'mirror', request, preview: previewed.value }
                  : { status: 'invalid', kind: 'mirror', problem: previewed.error };
            },
            createProblem('mirror.source-unavailable')
         ),
      [preview]
   );

   const confirm = useCallback(
      (ready: MirrorReady) =>
         void start(
            ready,
            () =>
               window.encore.installMirror.start({
                  targetId: localTargetId,
                  ...ready.request,
                  planKey: ready.preview.planKey
               }),
            createProblem('mirror.source-unavailable')
         ),
      [start]
   );

   return { flow, open, confirm };
}

export function MirrorDialog({ mirror }: { mirror: InstallMirror }) {
   const t = useTranslations('installs.mirror');
   const common = useTranslations('common');
   const format = useFormatters();
   const [consent, setConsent] = useState<{ planKey: string; accepted: boolean } | null>(null);
   const { flow } = mirror;
   const { state, operation, missing, cancelable } = flow;
   const preview = 'preview' in state ? state.preview : null;
   const understood = preview !== null && consent?.planKey === preview.planKey && consent.accepted;
   const needsConsent = preview !== null && (!preview.resync || preview.removals.length > 0);
   const settings = useSettings();
   const combined = settings.snapshot?.app.combineInstalls ?? false;
   const navigate = useNavigate();
   const result = mirrorResultSchema.safeParse(operation?.result);
   const installId = result.success ? (result.data.installIds[0] ?? null) : null;
   const single = preview?.installs.length === 1 ? preview.installs[0] : null;
   const versions = preview?.installs.map((install) => install.version).join(', ') ?? '';

   const close = () => {
      setConsent(null);
      flow.dismiss();
   };

   return (
      <Dialog open={state.status !== 'idle'} onOpenChange={(open) => (open || flow.busy ? undefined : close())}>
         <DialogContent className="sm:max-w-lg">
            <DialogHeader>
               <DialogTitle>
                  {preview
                     ? preview.resync
                        ? t('syncTitle', { device: preview.sourceDevice })
                        : single
                          ? t('title', { device: preview.sourceDevice, version: single.version })
                          : t('titleMany', { device: preview.sourceDevice, count: preview.installs.length })
                     : t('checking')}
               </DialogTitle>
               {preview ? (
                  <DialogDescription variant="muted">
                     {single
                        ? t(preview.resync ? 'syncDescription' : 'description', { name: single.name, device: preview.sourceDevice })
                        : t(preview.resync ? 'syncDescriptionMany' : 'descriptionMany', { versions, device: preview.sourceDevice })}
                  </DialogDescription>
               ) : null}
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}
               {state.status === 'invalid' ? <p>{state.problem.message}</p> : null}
               {state.status === 'failed' ? <p className="text-destructive">{state.error.message}</p> : null}

               {state.status === 'ready' && preview ? (
                  <>
                     {preview.resync ? (
                        <p className="text-muted-foreground">{t('syncDetail')}</p>
                     ) : (
                        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
                           <li>{single ? t('copies', { version: single.version }) : t('copiesMany', { versions })}</li>
                           <li>{t('shared')}</li>
                           <li>{t('appData')}</li>
                           <li>{t('later', { device: preview.sourceDevice })}</li>
                        </ul>
                     )}
                     {preview.removals.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                           <p className="font-medium">{t('removes')}</p>
                           <ul className="divide-border border-destructive/40 max-h-48 divide-y overflow-y-auto rounded-lg border">
                              {preview.removals.map((removal) => (
                                 <li key={removal.installId} className="flex flex-col px-3 py-2">
                                    <span>{removal.name}</span>
                                    <span className="text-muted-foreground text-xs break-all">
                                       {removal.store ? t('storeRemoval') : removal.path}
                                    </span>
                                 </li>
                              ))}
                           </ul>
                        </div>
                     ) : null}
                     {needsConsent ? (
                        <label className="flex items-start gap-2">
                           <Checkbox
                              checked={understood}
                              onCheckedChange={(checked) => setConsent({ planKey: preview.planKey, accepted: checked === true })}
                           />
                           <span>{t(preview.removals.length > 0 ? 'understandRemovals' : 'understand', { device: preview.sourceDevice })}</span>
                        </label>
                     ) : null}
                  </>
               ) : null}

               {state.status === 'starting' || (state.status === 'running' && !operation && !missing) ? (
                  <OperationProgress percent={0} label={t('preparing')} />
               ) : null}

               {missing ? <p className="text-muted-foreground">{common('operation.missing')}</p> : null}

               {operation?.status === 'running' ? (
                  <OperationProgress
                     percent={operation.progress?.percent ?? 0}
                     label={
                        operation.progress?.phase === 'downloading'
                           ? t('progress', {
                                done: format.bytes(operation.progress.current ?? 0),
                                total: format.bytes(operation.progress.total ?? 0),
                                speed: format.bytes(operation.progress.perSecond ?? 0)
                             })
                           : t(
                                `phase.${operation.progress?.phase === 'linking' || operation.progress?.phase === 'removing' ? operation.progress.phase : 'scanning'}`
                             )
                     }
                  />
               ) : null}

               {operation?.status === 'completed' && preview ? (
                  <div className="flex flex-col items-center gap-3 py-2 text-center">
                     <CheckCircle2 className="text-status-success size-14" strokeWidth={1.5} />
                     <p>{t(preview.resync ? 'synced' : 'done', { device: preview.sourceDevice })}</p>
                     {preview.removals.some((removal) => removal.store) ? <p className="text-muted-foreground text-sm">{t('steamAsks')}</p> : null}
                     {result.success && result.data.protonRequested ? <p className="text-muted-foreground text-sm">{t('proton')}</p> : null}
                     {!combined ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void settings.updateApp({ combineInstalls: true })}>
                           {t('combine', { device: preview.sourceDevice })}
                        </Button>
                     ) : null}
                  </div>
               ) : null}
               {operation?.status === 'failed' ? <p className="text-destructive">{operation.error?.message}</p> : null}
               {operation?.status === 'cancelled' ? <p className="text-muted-foreground">{t('cancelled')}</p> : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={close}>
                        {common('cancel')}
                     </Button>
                     <Button
                        type="button"
                        variant={needsConsent ? 'destructive' : 'default'}
                        size="sm"
                        disabled={needsConsent && !understood}
                        onClick={() => mirror.confirm(state)}
                     >
                        {state.preview.resync ? <RefreshCw data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                        {t(state.preview.resync ? 'syncConfirm' : 'confirm')}
                     </Button>
                  </>
               ) : operation?.status === 'completed' && installId && !preview?.resync ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={close}>
                        {common('close')}
                     </Button>
                     <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                           close();
                           void navigate({ to: '/installs/$installId', params: { installId }, search: { targetId: localTargetId } });
                        }}
                     >
                        {t('open')}
                     </Button>
                  </>
               ) : flow.busy ? (
                  <Button type="button" variant="outline" size="sm" disabled={!cancelable} onClick={flow.cancel}>
                     {common('cancel')}
                  </Button>
               ) : (
                  <Button type="button" size="sm" onClick={close}>
                     {common('close')}
                  </Button>
               )}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
