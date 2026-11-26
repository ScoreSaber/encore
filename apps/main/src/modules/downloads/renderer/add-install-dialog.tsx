import { CheckCircle2, FolderOpen, Monitor, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { AppLink } from '@/components/app-link';
import { QuestIcon } from '@/components/headset-icons';
import { RefreshButton } from '@/components/refresh-button';
import { WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/components/utils';

import type { DownloadVersion } from '@/modules/downloads/contract';
import type { VersionDownloader } from '@/modules/downloads/renderer/use-version-download';
import { InstallRootField } from '@/modules/installs/renderer/install-root-field';
import type { InstallImporter } from '@/modules/installs/renderer/use-install-import';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import type { OperationSnapshot } from '@/modules/operations/contract';
import { OperationProgress, PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { StoreKind } from '@/modules/stores/contract';
import { StoreIcon } from '@/modules/stores/renderer/store-icon';
import { localTargetId, runsOnSteamFrame, type Target } from '@/modules/targets/contract';
import { useTargetName, useTargets } from '@/modules/targets/renderer/use-targets';
import { useFormatters } from '@/renderer/i18n/formatters';

export function AddInstallDialog({
   downloader,
   importer,
   onQuest
}: {
   downloader: VersionDownloader;
   importer: InstallImporter;
   onQuest: () => void;
}) {
   const t = useTranslations('downloads');
   const common = useTranslations('common');
   const targetName = useTargetName();
   const { targets } = useTargets();
   const { flow, step, catalog } = downloader;
   const { state, operation, missing, busy, finished, cancelable } = flow;
   const target = targets.find((candidate) => candidate.id === downloader.targetId);
   const name = target ? targetName(target) : downloader.targetId;
   const canImport = target?.capabilities.includes('import-install') ?? false;
   const localInstalls = useInstalls(localTargetId);
   const nothingSetUp =
      targets.every((candidate) => candidate.kind === 'local') &&
      localInstalls.loadStatus !== 'loading' &&
      (localInstalls.snapshot?.installs.length ?? 0) === 0;
   const offerRemote = nothingSetUp || window.encore.runtime === 'mobile';
   const phase =
      state.status !== 'idle'
         ? state.status
         : step.status === 'closed' || step.status === 'where'
           ? step.status
           : step.status === 'stores'
             ? downloader.catalogStatus === 'loading'
                ? 'stores-loading'
                : downloader.catalogStatus === 'unavailable' && !canImport
                  ? 'catalog-unavailable'
                  : 'stores'
             : downloader.catalogStatus === 'loading'
               ? 'loading'
               : downloader.catalogStatus === 'unavailable'
                 ? 'catalog-unavailable'
                 : 'versions';
   const canChangeRoot = downloader.targetId === localTargetId;
   const offset = downloader.askedWhere ? 1 : 0;
   const currentStep =
      phase === 'where'
         ? 1
         : phase === 'stores' || phase === 'stores-loading'
           ? 1 + offset
           : phase === 'loading' || phase === 'versions' || phase === 'catalog-unavailable'
             ? (step.status === 'stores' ? 1 : 2) + offset
             : 3 + offset;

   const addFolder = (targetId: string) => {
      downloader.dismiss();
      void importer.choose(targetId);
   };

   return (
      <Dialog
         open={phase !== 'closed'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || busy) return;

            downloader.dismiss();
         }}
      >
         <DialogContent className="sm:max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
            <DialogHeader>
               <DialogTitle className="flex flex-wrap items-baseline gap-x-2">
                  <span>{t('title')}</span>
                  <span className="text-muted-foreground text-sm font-normal">
                     <span aria-hidden="true">·</span> {t('step', { current: currentStep, total: 3 + offset })}
                  </span>
               </DialogTitle>
               <DialogDescription variant={phase === 'where' || phase === 'stores' || phase === 'stores-loading' ? 'muted' : 'hidden'}>
                  {phase === 'where' ? t('where.description') : t(canImport ? 'descriptionWithFolder' : 'description', { name })}
               </DialogDescription>
            </DialogHeader>

            <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
               {phase === 'where' ? (
                  <WhereStep
                     targets={targets}
                     onChoose={(destination) => {
                        if (destination.capabilities.includes('download-install')) downloader.chooseTarget(destination.id);
                        else addFolder(destination.id);
                     }}
                     onQuest={() => {
                        downloader.dismiss();
                        onQuest();
                     }}
                  />
               ) : null}

               {phase === 'stores-loading' ? <p className="text-muted-foreground">{t('catalog.loading')}</p> : null}

               {phase === 'stores' ? (
                  <div className="flex flex-col gap-3">
                     {downloader.catalogStatus === 'unavailable' ? <p className="text-muted-foreground text-xs">{t('catalog.unavailable')}</p> : null}
                     <div className="flex flex-wrap gap-3">
                        {(catalog?.stores ?? []).map((store) => (
                           <ChoiceTile
                              key={store}
                              icon={<StoreIcon store={store} className="size-7" aria-hidden />}
                              label={t(`stores.${store}.name`)}
                              onClick={() => downloader.chooseStore(store)}
                           />
                        ))}
                        {canImport ? (
                           <ChoiceTile
                              icon={<FolderOpen className="text-muted-foreground size-7" />}
                              label={t('folder')}
                              onClick={() => addFolder(downloader.targetId)}
                           />
                        ) : null}
                     </div>
                  </div>
               ) : null}

               {phase === 'loading' ? <p className="text-muted-foreground">{t('catalog.loading')}</p> : null}

               {phase === 'catalog-unavailable' ? (
                  <>
                     <p>{t('catalog.unavailable')}</p>
                     {catalog?.problem ? <p className="text-muted-foreground text-xs break-all">{catalog.problem.message}</p> : null}
                  </>
               ) : null}

               {phase === 'versions' && step.status === 'versions' && catalog ? (
                  <>
                     <div>
                        <p className="font-medium">{t(`stores.${step.store}.name`)}</p>
                        {step.store === 'steam' ? (
                           <p className="text-muted-foreground mt-1 text-xs">{t('stores.steam.requirements', { name })}</p>
                        ) : null}
                     </div>
                     <ScrollArea className="bg-muted/20 h-72 rounded-lg border">
                        <VersionList
                           versions={catalog.versions}
                           store={step.store}
                           frame={target?.hardware === 'steam-frame'}
                           onSelect={downloader.select}
                        />
                     </ScrollArea>
                  </>
               ) : null}

               {state.status === 'previewing' && step.status === 'versions' ? (
                  <p className="text-muted-foreground">{t('checking', { version: step.version ?? '' })}</p>
               ) : null}

               {state.status === 'ready' ? (
                  <div className="flex flex-col gap-3">
                     <dl className="flex flex-col gap-2">
                        <PreviewRow label={t('preview.version')} value={state.preview.version} />
                        <PreviewRow label={t('preview.store')} value={t(`stores.${state.preview.store}.name`)} />
                        <PreviewRow label={t('preview.destination')} value={state.preview.destinationPath} />
                     </dl>
                     {state.preview.warnings.map((warning) => (
                        <WarningLine key={warning}>{t(`preview.warnings.${warning}`)}</WarningLine>
                     ))}
                  </div>
               ) : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{t(`issues.${state.problem.issue}`, { name })}</p>
                     {state.problem.detail ? <p className="text-muted-foreground text-xs break-all">{state.problem.detail}</p> : null}
                     {state.problem.issue === 'depot-not-empty' && canChangeRoot ? (
                        <InstallRootField className="px-0 sm:px-0" disabled={false} onChange={downloader.recheck} />
                     ) : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t('result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'starting' || (state.status === 'running' && !operation && !missing) ? (
                  <OperationProgress percent={0} label={t('preparing')} />
               ) : null}

               {missing ? <p className="text-muted-foreground">{common('operation.missing')}</p> : null}

               {operation ? <OperationResult operation={operation} /> : null}
            </div>

            <DialogFooter className={cn(phase === 'where' && offerRemote && 'sm:justify-between')}>
               {phase === 'where' && offerRemote ? (
                  <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                     <AppLink to="/settings/remote" onClick={downloader.dismiss}>
                        <Wifi data-icon="inline-start" />
                        {t('where.connectRemote')}
                     </AppLink>
                  </Button>
               ) : null}

               {phase === 'where' || ((phase === 'stores' || phase === 'stores-loading') && !downloader.askedWhere) ? (
                  <Button type="button" size="sm" onClick={downloader.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}

               {(phase === 'stores' || phase === 'stores-loading') && downloader.askedWhere ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {common('back')}
                     </Button>
                     <Button type="button" size="sm" onClick={downloader.dismiss}>
                        {common('close')}
                     </Button>
                  </>
               ) : null}

               {phase === 'versions' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {common('back')}
                     </Button>
                     <RefreshButton label={t('catalog.refresh')} onClick={downloader.refresh} />
                  </>
               ) : null}

               {state.status === 'invalid' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {t('chooseAnother')}
                     </Button>
                     <RefreshButton label={common('retry')} variant="default" onClick={downloader.recheck} />
                  </>
               ) : null}

               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {common('back')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => downloader.confirm(state)}>
                        {t(`stores.${state.preview.store}.confirm`)}
                     </Button>
                  </>
               ) : null}

               {busy ? (
                  <Button type="button" variant="outline" size="sm" disabled={!cancelable} onClick={flow.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {phase === 'catalog-unavailable' ? (
                  <>
                     {step.status === 'versions' || downloader.askedWhere ? (
                        <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                           {common('back')}
                        </Button>
                     ) : (
                        <Button type="button" variant="outline" size="sm" onClick={downloader.dismiss}>
                           {common('close')}
                        </Button>
                     )}
                     <RefreshButton label={common('retry')} variant="default" onClick={downloader.refresh} />
                  </>
               ) : null}

               {state.status === 'failed' || finished || missing ? (
                  <Button type="button" size="sm" onClick={downloader.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function WhereStep({ targets, onChoose, onQuest }: { targets: Target[]; onChoose: (target: Target) => void; onQuest: () => void }) {
   const t = useTranslations('downloads.where');
   const targetName = useTargetName();
   const destinations = targets.filter(
      (target) =>
         target.kind !== 'quest' &&
         target.status === 'ready' &&
         (target.capabilities.includes('download-install') || target.capabilities.includes('import-install'))
   );

   return (
      <div className="flex flex-wrap gap-3">
         {destinations.map((target) => (
            <ChoiceTile
               key={target.id}
               icon={<Monitor className="text-muted-foreground size-7" />}
               label={targetName(target)}
               description={
                  target.kind === 'local'
                     ? t(target.hardware === 'steam-frame' ? 'localFrame' : window.encore.platform === 'darwin' ? 'localMac' : 'local')
                     : t('remote')
               }
               onClick={() => onChoose(target)}
            />
         ))}
         {window.encore.runtime === 'mobile' || runsOnSteamFrame(targets) ? null : (
            <ChoiceTile
               icon={<QuestIcon className="text-muted-foreground size-7" />}
               label={t('quest')}
               description={t('questDescription')}
               onClick={onQuest}
            />
         )}
      </div>
   );
}

function ChoiceTile({ icon, label, description, onClick }: { icon: React.ReactNode; label: string; description?: string; onClick: () => void }) {
   return (
      <button
         type="button"
         className="hover:bg-accent focus-visible:ring-ring flex min-w-28 flex-1 basis-0 flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center transition-colors outline-none focus-visible:ring-2"
         onClick={onClick}
      >
         {icon}
         <span className="w-full text-sm leading-tight font-medium text-balance break-words">{label}</span>
         {description ? <span className="text-muted-foreground -mt-1.5 w-full truncate text-xs">{description}</span> : null}
      </button>
   );
}

function VersionList({
   versions,
   store,
   frame,
   onSelect
}: {
   versions: DownloadVersion[];
   store: StoreKind;
   frame: boolean;
   onSelect: (version: string) => void;
}) {
   const supported = versions.filter((version) => store !== 'oculus' || version.oculusBinaryId !== null);
   const isRecommended = (version: DownloadVersion) => (frame ? version.recommendedOnFrame : version.recommended);
   const recommended = supported.find(isRecommended);

   return (
      <div className="flex flex-col p-1">
         {recommended ? (
            <>
               <VersionRow version={recommended} recommended onSelect={() => onSelect(recommended.version)} />
               <Separator className="my-1" />
            </>
         ) : null}
         {supported.map((version) => (
            <VersionRow key={version.version} version={version} recommended={isRecommended(version)} onSelect={() => onSelect(version.version)} />
         ))}
      </div>
   );
}

function VersionRow({ version, recommended, onSelect }: { version: DownloadVersion; recommended: boolean; onSelect: () => void }) {
   const t = useTranslations('downloads');

   return (
      <button
         type="button"
         className="hover:bg-muted focus-visible:bg-muted flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left outline-none"
         onClick={onSelect}
      >
         <span className="min-w-0 truncate font-medium">{version.version}</span>
         {recommended ? <Badge variant="secondary">{t('recommended')}</Badge> : null}
      </button>
   );
}

const protonRequestedSchema = z.object({ protonRequested: z.literal(true) });

function OperationResult({ operation }: { operation: OperationSnapshot }) {
   const t = useTranslations('downloads');
   const format = useFormatters();

   if (operation.status === 'completed') {
      return (
         <div className="flex flex-col gap-1.5 text-sm">
            <p className="flex gap-2">
               <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
               <span className="min-w-0 break-words">{t('result.completed')}</span>
            </p>
            {protonRequestedSchema.safeParse(operation.result).success ? <p className="text-muted-foreground">{t('result.proton')}</p> : null}
         </div>
      );
   }

   if (operation.status === 'cancelled') return <p>{t('result.cancelled')}</p>;

   if (operation.status === 'failed') {
      return (
         <>
            <p>{t('result.failed')}</p>
            <p className="text-muted-foreground text-xs break-all">{operation.error?.message}</p>
         </>
      );
   }

   const progress = operation.progress;
   const phase = progress?.phase;
   const active = phase === 'authenticating' || phase === 'copying' || phase === 'downloading';
   const label = active ? t(phase, { size: format.bytes(progress?.current ?? 0) }) : t('preparing');
   const speed = progress?.perSecond === undefined ? null : t('speed', { speed: format.bytes(progress.perSecond) });

   if (phase === 'downloading' && progress?.percent === undefined) {
      return (
         <p className="text-muted-foreground flex justify-between gap-3 text-xs tabular-nums">
            <span>{label}</span>
            {speed ? <span>{speed}</span> : null}
         </p>
      );
   }

   return <OperationProgress percent={progress?.percent ?? 0} label={speed ? `${label} · ${speed}` : label} />;
}
