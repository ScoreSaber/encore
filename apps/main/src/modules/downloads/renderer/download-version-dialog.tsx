import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import { versionSupportsStore, type DownloadIssue, type DownloadVersion } from '@/modules/downloads/contract';
import type { VersionDownloader } from '@/modules/downloads/renderer/use-version-download';
import { InstallRootField } from '@/modules/installs/renderer/install-root-field';
import type { OperationSnapshot } from '@/modules/operations/contract';
import { isOperationFinished } from '@/modules/operations/renderer/operation-progress';
import { storeKinds, type StoreKind } from '@/modules/stores/contract';
import { StoreIcon } from '@/modules/stores/renderer/store-icon';
import { localTargetId } from '@/modules/targets/contract';
import { useFormatters } from '@/renderer/i18n/formatters';
import type { MessageKey } from '@/renderer/i18n/keys';

const issueKeys: Record<DownloadIssue, MessageKey<'downloads.issues'>> = {
   'binary-unavailable': 'binaryUnavailable',
   'catalog-unavailable': 'catalogUnavailable',
   'depot-not-empty': 'depotNotEmpty',
   'inspect-failed': 'inspectFailed',
   'steam-missing': 'steamMissing',
   'steam-signed-out': 'steamSignedOut',
   'unknown-version': 'unknownVersion',
   'unsupported-platform': 'unsupportedPlatform',
   'unsupported-target': 'unsupportedTarget'
};

const totalSteps = 3;

export function DownloadVersionDialog({ downloader, targetName }: { downloader: VersionDownloader; targetName: string }) {
   const t = useTranslations('downloads');
   const common = useTranslations('common');
   const { state, operation } = downloader;
   const running = state.status === 'starting' || (state.status === 'running' && !isOperationFinished(operation));
   const canChangeRoot = downloader.targetId === localTargetId;
   const choosingStore = state.status === 'loading' || state.status === 'catalog-unavailable' || state.status === 'choosing-store';
   const currentStep = choosingStore ? 1 : state.status === 'picking' ? 2 : 3;

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || running) return;

            downloader.dismiss();
         }}
      >
         <DialogContent className="sm:max-w-md">
            <DialogHeader>
               <DialogTitle className="flex flex-wrap items-baseline gap-x-2">
                  <span>{t('title')}</span>
                  <span className="text-muted-foreground text-sm font-normal">
                     <span aria-hidden="true">·</span> {t('step', { current: currentStep, total: totalSteps })}
                  </span>
               </DialogTitle>
               <DialogDescription className={choosingStore ? 'text-muted-foreground not-sr-only text-sm leading-relaxed' : undefined}>
                  {t('description')}
               </DialogDescription>
            </DialogHeader>

            <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
               {state.status === 'loading' ? <p className="text-muted-foreground">{t('catalog.loading')}</p> : null}

               {state.status === 'catalog-unavailable' ? (
                  <>
                     <p>{t('catalog.unavailable')}</p>
                     {state.catalog?.problem ? <p className="text-muted-foreground text-xs break-all">{state.catalog.problem.message}</p> : null}
                  </>
               ) : null}

               {state.status === 'choosing-store' ? (
                  <div className="flex items-center justify-center gap-3 py-2">
                     {storeKinds.map((store) => (
                        <StoreButton key={store} store={store} onSelect={() => downloader.chooseStore(store)} />
                     ))}
                  </div>
               ) : null}

               {state.status === 'picking' ? (
                  <>
                     <div>
                        <p className="font-medium">{t(`stores.${state.store}.name`)}</p>
                        {state.store === 'steam' ? (
                           <p className="text-muted-foreground mt-1 text-xs">{t('stores.steam.requirements', { name: targetName })}</p>
                        ) : null}
                     </div>
                     <ScrollArea className="bg-muted/20 h-72 rounded-lg border">
                        <VersionList versions={state.catalog.versions} store={state.store} onSelect={(version) => void downloader.select(version)} />
                     </ScrollArea>
                  </>
               ) : null}

               {state.status === 'checking' ? <p className="text-muted-foreground">{t('checking', { version: state.version })}</p> : null}

               {state.status === 'unavailable' ? <p>{t(`issues.${issueKeys[state.preview.issue]}`, { name: targetName })}</p> : null}
               {state.status === 'unavailable' && state.preview.detail ? (
                  <p className="text-muted-foreground text-xs break-all">{state.preview.detail}</p>
               ) : null}
               {state.status === 'unavailable' && state.preview.issue === 'depot-not-empty' && canChangeRoot ? (
                  <InstallRootField disabled={false} onChange={downloader.recheck} />
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t('result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'starting' || (state.status === 'running' && !operation) ? <DownloadProgress label={t('preparing')} /> : null}

               {state.status === 'running' && operation ? <OperationResult operation={operation} /> : null}
            </div>

            <DialogFooter>
               {state.status === 'choosing-store' ? (
                  <>
                     <Button type="button" size="sm" onClick={downloader.dismiss}>
                        {common('close')}
                     </Button>
                     <RefreshButton label={t('catalog.refresh')} onClick={() => void downloader.refresh()} />
                  </>
               ) : null}

               {state.status === 'picking' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {common('back')}
                     </Button>
                     <Button type="button" size="sm" onClick={downloader.dismiss}>
                        {common('close')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'unavailable' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {t('chooseAnother')}
                     </Button>
                     <RefreshButton
                        label={common('retry')}
                        variant="default"
                        disabled={!state.preview.version}
                        onClick={() => void downloader.recheck()}
                     />
                  </>
               ) : null}

               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.back}>
                        {common('back')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => void downloader.confirm()}>
                        {t(`stores.${state.preview.store}.confirm`)}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={downloader.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'catalog-unavailable' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={downloader.dismiss}>
                        {common('close')}
                     </Button>
                     <RefreshButton label={common('retry')} variant="default" onClick={() => void downloader.refresh()} />
                  </>
               ) : null}

               {state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={downloader.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function StoreButton({ store, onSelect }: { store: StoreKind; onSelect: () => void }) {
   const t = useTranslations('downloads');

   return (
      <Button
         type="button"
         variant="ghost"
         size="icon"
         aria-label={t(`stores.${store}.name`)}
         className="border-border/70 bg-background/78 text-muted-foreground hover:bg-accent/70 hover:text-foreground size-16 cursor-pointer rounded-md border backdrop-blur-xl transition-[background-color,color,scale] active:scale-[0.96]"
         onClick={onSelect}
      >
         <StoreIcon store={store} className="size-7" aria-hidden />
      </Button>
   );
}

function VersionList({ versions, store, onSelect }: { versions: DownloadVersion[]; store: StoreKind; onSelect: (version: string) => void }) {
   const supported = versions.filter((version) => versionSupportsStore(version, store));
   const recommended = supported.find((version) => version.recommended);

   return (
      <div className="flex flex-col p-1">
         {recommended ? (
            <>
               <VersionRow version={recommended} onSelect={() => onSelect(recommended.version)} />
               <Separator className="my-1" />
            </>
         ) : null}
         {supported.map((version) => (
            <VersionRow key={version.version} version={version} onSelect={() => onSelect(version.version)} />
         ))}
      </div>
   );
}

function VersionRow({ version, onSelect }: { version: DownloadVersion; onSelect: () => void }) {
   const t = useTranslations('downloads');

   return (
      <button
         type="button"
         className="hover:bg-muted focus-visible:bg-muted flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left outline-none"
         onClick={onSelect}
      >
         <span className="min-w-0 truncate font-medium">{version.version}</span>
         {version.recommended ? <Badge variant="secondary">{t('recommended')}</Badge> : null}
      </button>
   );
}

function OperationResult({ operation }: { operation: OperationSnapshot }) {
   const t = useTranslations('downloads');
   const format = useFormatters();

   if (operation.status === 'completed') {
      return (
         <p className="flex gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{t('result.completed')}</span>
         </p>
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

   return <DownloadProgress label={active ? t(phase, { size: format.bytes(progress?.current ?? 0) }) : t('preparing')} />;
}

function DownloadProgress({ label }: { label: string }) {
   return (
      <div className="flex flex-col gap-2">
         <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full w-1/3 animate-pulse" />
         </div>
         <p className="text-muted-foreground text-xs">{label}</p>
      </div>
   );
}
