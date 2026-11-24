import { useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Cable, CircleArrowUp, Monitor, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import semver from 'semver';
import { useTranslations } from 'use-intl';

import { ConfirmDialog } from '@/components/dialog/confirm-dialog';
import { ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import { appInfoQueryOptions } from '@/modules/app/renderer/app-queries';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { RemoteSetupDialog } from '@/modules/receiver/renderer/remote-setup-dialog';
import { ThisComputerSection } from '@/modules/receiver/renderer/this-computer-section';
import { useReceiver } from '@/modules/receiver/renderer/use-receiver';
import type { ReceiverSettings } from '@/modules/settings/contract';
import { SettingsSection } from '@/modules/settings/renderer/settings-layout';
import type { Target, TargetId } from '@/modules/targets/contract';
import type { TargetsLoadStatus } from '@/modules/targets/renderer/use-targets';
import { useUpdate } from '@/modules/updates/renderer/use-update';

export function RemoteSection({
   receiverSettings,
   startAdding,
   disabled,
   canShareThisComputer,
   remoteTargets,
   targetsStatus,
   onReloadTargets,
   onRemotePaired
}: {
   receiverSettings: ReceiverSettings;
   startAdding: boolean;
   disabled: boolean;
   canShareThisComputer: boolean;
   remoteTargets: Target[];
   targetsStatus: TargetsLoadStatus;
   onReloadTargets: () => void;
   onRemotePaired: (targetId: TargetId) => void;
}) {
   const t = useTranslations('settings.remote');
   const receiver = useReceiver();
   const [addOpen, setAddOpen] = useState(startAdding);
   const controlsDisabled = disabled || receiver.busy;

   return (
      <>
         {receiver.error && !addOpen ? (
            <Alert variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('errorTitle')}</AlertTitle>
               <AlertDescription>{receiver.error}</AlertDescription>
            </Alert>
         ) : null}

         {canShareThisComputer ? <ThisComputerSection receiver={receiver} receiverSettings={receiverSettings} disabled={controlsDisabled} /> : null}

         <SettingsSection
            title={t('remotes.title')}
            headerAction={
               <Button type="button" variant="ghost" size="xs" disabled={controlsDisabled} onClick={() => setAddOpen(true)}>
                  <Plus />
                  {t('remotes.add')}
               </Button>
            }
         >
            {targetsStatus === 'loading' ? <LoadingPanel className="min-h-20" /> : null}
            {targetsStatus === 'error' ? <ErrorPanel className="px-4 py-3" message={t('remotes.loadError')} onRetry={onReloadTargets} /> : null}
            {targetsStatus === 'ready' && remoteTargets.length === 0 ? (
               <Empty className="min-h-52">
                  <EmptyHeader>
                     <EmptyMedia variant="icon">
                        <Cable />
                     </EmptyMedia>
                     <EmptyTitle>{t('remotes.emptyTitle')}</EmptyTitle>
                     <EmptyDescription>{t('remotes.emptyDescription')}</EmptyDescription>
                  </EmptyHeader>
               </Empty>
            ) : null}
            {remoteTargets.map((target) => (
               <RemoteTargetRow key={target.id} target={target} disabled={controlsDisabled} onForget={() => receiver.forgetRemote(target.id)} />
            ))}
         </SettingsSection>

         <RemoteSetupDialog open={addOpen} receiver={receiver} onOpenChange={setAddOpen} onRemotePaired={onRemotePaired} />
      </>
   );
}

type RemoteUpdatePhase = { status: 'idle' } | { status: 'requested'; fromVersion: string } | { status: 'active'; fromVersion: string };

function RemoteTargetRow({ target, disabled, onForget }: { target: Target; disabled: boolean; onForget: () => void }) {
   const t = useTranslations('settings.remote.remotes');
   const targetLabels = useTranslations('targets');
   const common = useTranslations('common');
   const [forgetOpen, setForgetOpen] = useState(false);
   const [updateOpen, setUpdateOpen] = useState(false);
   const [updatePhase, setUpdatePhase] = useState<RemoteUpdatePhase>({ status: 'idle' });
   const localVersion = useQuery(appInfoQueryOptions).data?.version ?? null;
   const updatable = target.status === 'ready' && target.capabilities.includes('update-app');
   const update = useUpdate(target.id, updatable);
   const remote = target.capabilities.includes('update-app') ? update.state : null;
   const behind =
      remote !== null && localVersion !== null && semver.valid(remote.currentVersion) !== null && semver.lt(remote.currentVersion, localVersion);
   const failure = remote?.errorContext && remote.message ? remote.message : null;
   const remoteInProgress = remote?.status === 'checking' || remote?.status === 'downloading' || remote?.status === 'downloaded';

   useEffect(() => {
      if (updatePhase.status === 'idle') return;
      if (failure || (remote && remote.currentVersion !== updatePhase.fromVersion)) {
         setUpdatePhase({ status: 'idle' });
         return;
      }
      if (updatePhase.status === 'requested' && (remoteInProgress || target.status !== 'ready')) {
         setUpdatePhase({ status: 'active', fromVersion: updatePhase.fromVersion });
         return;
      }
      if (updatePhase.status === 'active' && target.status === 'ready' && remote && !remoteInProgress) {
         setUpdatePhase({ status: 'idle' });
      }
   }, [failure, remote, remoteInProgress, target.status, updatePhase]);

   const updating =
      updatePhase.status !== 'idle' &&
      remote !== null &&
      updatePhase.fromVersion === remote.currentVersion &&
      !failure &&
      (updatePhase.status === 'requested' || target.status !== 'ready' || remoteInProgress);
   const progress =
      remote?.status === 'downloading'
         ? t('update.downloading', { percent: remote.downloadPercent ?? 0 })
         : !updating
           ? null
           : updatePhase.status === 'requested' || remote?.status === 'checking'
             ? t('update.checking')
             : t('update.restarting');
   const offerUpdate =
      updatable &&
      remote !== null &&
      progress === null &&
      (remote.status === 'available' || remote.status === 'downloaded' || (behind && remote.status !== 'disabled'));
   const subtitle = [
      target.address,
      targetLabels(`status.${target.status}`),
      target.status === 'ready' ? null : target.message,
      remote ? t('version', { version: remote.currentVersion }) : null
   ]
      .filter(Boolean)
      .join(' · ');

   return (
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 sm:px-4">
         <Monitor className="text-muted-foreground size-4" />
         <div className="min-w-0">
            <p className="truncate text-sm font-medium">{target.name}</p>
            <p className={cn('text-muted-foreground truncate text-xs', target.status === 'incompatible' && 'text-destructive')} title={subtitle}>
               {subtitle}
            </p>
            {progress ? (
               <p className="mt-1 flex items-center gap-2 text-xs font-medium" role="status">
                  <span aria-hidden="true" className="bg-foreground size-1.5 shrink-0 rounded-full" />
                  {progress}
               </p>
            ) : failure ? (
               <p className="text-destructive mt-1 flex min-w-0 items-center gap-2 text-xs" role="alert">
                  <span aria-hidden="true" className="bg-destructive size-1.5 shrink-0 rounded-full" />
                  <span className="truncate">{failure}</span>
               </p>
            ) : behind && remote && !remote.selfUpdates ? (
               <p className="text-muted-foreground mt-1 text-xs">{t('update.manual')}</p>
            ) : null}
         </div>
         <div className="flex shrink-0 items-center gap-1">
            {offerUpdate && remote?.selfUpdates ? (
               <Tooltip>
                  <TooltipTrigger asChild>
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('update.action', { version: remote.availableVersion ?? localVersion ?? '' })}
                        disabled={disabled}
                        onClick={() => setUpdateOpen(true)}
                     >
                        <CircleArrowUp />
                     </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('update.action', { version: remote.availableVersion ?? localVersion ?? '' })}</TooltipContent>
               </Tooltip>
            ) : null}
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={common('more')} disabled={disabled}>
                     <MoreHorizontal />
                  </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => setForgetOpen(true)}>
                     <Trash2 />
                     {t('forgetAction')}
                  </DropdownMenuItem>
               </DropdownMenuContent>
            </DropdownMenu>
         </div>

         <ConfirmDialog
            open={updateOpen}
            title={t('update.confirmTitle', { name: target.name })}
            description={t('update.confirmDescription')}
            confirmLabel={t('update.confirm')}
            confirmVariant="default"
            onOpenChange={setUpdateOpen}
            onConfirm={() => {
               setUpdateOpen(false);
               if (remote) setUpdatePhase({ status: 'requested', fromVersion: remote.currentVersion });
               update.run('update');
            }}
         />

         <ConfirmDialog
            open={forgetOpen}
            title={t('forgetConfirm.title')}
            description={t('forgetConfirm.description')}
            confirmLabel={t('forgetConfirm.confirm')}
            busy={disabled}
            onOpenChange={setForgetOpen}
            onConfirm={() => {
               setForgetOpen(false);
               onForget();
            }}
         >
            <PreviewRow label={t('forgetConfirm.name')} value={target.name} />
            {target.address ? <PreviewRow label={t('forgetConfirm.address')} value={target.address} /> : null}
         </ConfirmDialog>
      </div>
   );
}
