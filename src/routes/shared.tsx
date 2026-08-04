import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

import { PageBody } from '@/app/renderer/shell/page-body';
import { BSManagerCleanupDialog } from '@/modules/bsmanager/renderer/bsmanager-cleanup-dialog';
import { useBSManagerAdoption } from '@/modules/bsmanager/renderer/use-bsmanager-adoption';
import { useBSManagerCleanup } from '@/modules/bsmanager/renderer/use-bsmanager-cleanup';
import { SharedConnectDialog } from '@/modules/shared-content/renderer/shared-connect-dialog';
import { sharedContentOverviewQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import { SharedInstallList } from '@/modules/shared-content/renderer/shared-install-list';
import { SharedRootsPanel } from '@/modules/shared-content/renderer/shared-roots-panel';
import { useSharedConnect } from '@/modules/shared-content/renderer/use-shared-connect';
import { useSharedRoots } from '@/modules/shared-content/renderer/use-shared-roots';
import { localTargetId } from '@/modules/targets/contract';
import { TargetPicker } from '@/modules/targets/renderer/target-picker';
import { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';

export const Route = createFileRoute('/shared')({
   component: SharedRoute
});

function SharedRoute() {
   const t = useTranslations('sharedContent.page');
   const shared = useTranslations('sharedContent');
   const common = useTranslations('common');
   const cleanupLabels = useTranslations('bsmanager.cleanup');
   const targetLabels = useTranslations('targets');
   const targetList = useSelectedTarget();
   const targets = targetList.targets.filter((target) => target.capabilities.includes('share-content'));
   const targetId = targets.some((target) => target.id === targetList.targetId) ? targetList.targetId : (targets[0]?.id ?? targetList.targetId);
   const overviewQuery = useQuery(sharedContentOverviewQueryOptions(targetId));
   const overviewStatus =
      overviewQuery.isError || overviewQuery.data?.status === 'unavailable' ? 'error' : overviewQuery.isPending ? 'loading' : 'ready';
   const roots = useSharedRoots(targetId);
   const connect = useSharedConnect(targetId);
   const adoption = useBSManagerAdoption(targetId);
   const cleanup = useBSManagerCleanup(targetId);
   const [pickedRootPath, setPickedRootPath] = useState<string | null>(null);

   const selectedTarget = targetList.targets.find((target) => target.id === targetId) ?? null;
   const supportsSharing = !selectedTarget || selectedTarget.capabilities.includes('share-content');
   const canManage = supportsSharing;
   const isLocal = targetId === localTargetId;
   const snapshot = overviewQuery.data?.status === 'ok' ? overviewQuery.data.value : null;
   const unsupported = overviewQuery.data?.status === 'unsupported' || snapshot?.status === 'unsupported';
   const rootList = snapshot?.roots ?? [];
   const selectedRootPath =
      (pickedRootPath && rootList.some((root) => root.path === pickedRootPath) ? pickedRootPath : null) ?? snapshot?.sharedRootPath ?? null;
   const linkSupport = snapshot?.linkSupport ?? null;
   const bsmanagerSharedPath = adoption.detection?.status === 'detected' ? adoption.detection.sharedContentPath : null;
   const supportHint =
      linkSupport && !linkSupport.supported ? shared('support.unavailable', { detail: linkSupport.detail ?? shared('support.unknownReason') }) : null;

   return (
      <PageBody className="gap-5">
         <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
               <div className="flex items-center gap-1.5">
                  <h1 className="text-2xl font-semibold">{t('title')}</h1>
                  <SharedContentHelp />
                  {cleanup.available ? (
                     <Button type="button" variant="outline" size="sm" onClick={cleanup.open}>
                        {cleanupLabels('button')}
                     </Button>
                  ) : null}
               </div>
               {supportHint && !isLocal ? <p className="text-muted-foreground mt-1 text-xs">{supportHint}</p> : null}
               {!canManage && overviewStatus === 'ready' && !unsupported ? (
                  <p className="text-muted-foreground mt-1 text-xs">{t('readOnly')}</p>
               ) : null}
            </div>
            <ButtonGroup className="shrink-0" aria-label={t('title')}>
               <TargetPicker
                  id="shared-target"
                  className="w-44"
                  label={targetLabels('picker')}
                  targets={targets}
                  status={targetList.status}
                  value={targetId}
                  onChange={targetList.selectTarget}
               />
               <RefreshButton label={common('rescan')} busy={overviewStatus === 'loading'} onClick={() => void overviewQuery.refetch()} />
            </ButtonGroup>
         </div>

         {overviewStatus === 'loading' ? <LoadingPanel rows={2} /> : null}
         {overviewStatus === 'error' ? <ErrorPanel message={shared('loadError')} onRetry={() => void overviewQuery.refetch()} /> : null}
         {unsupported ? <EmptyPanel description={shared('unsupportedTarget')} /> : null}

         {snapshot && !unsupported && overviewStatus === 'ready' ? (
            <>
               {snapshot.problems.map((problem) => (
                  <WarningLine key={`${problem.code}-${problem.folderId ?? 'root'}`} className="text-sm">
                     {problem.message}
                  </WarningLine>
               ))}

               <SharedRootsPanel
                  roots={rootList}
                  manager={roots}
                  selectedRootPath={selectedRootPath}
                  onSelectRoot={setPickedRootPath}
                  canManage={canManage}
                  isLocal={isLocal}
                  bsmanagerSharedPath={bsmanagerSharedPath}
               />

               {selectedRootPath ? (
                  <SharedInstallList
                     targetId={targetId}
                     installs={snapshot.installs}
                     selectedRootPath={selectedRootPath}
                     connect={connect}
                     canManage={canManage}
                     isLocal={isLocal}
                     // support is probed against the active root only, other roots are checked by the preview
                     linkable={selectedRootPath !== snapshot.sharedRootPath || linkSupport?.supported === true}
                  />
               ) : null}
            </>
         ) : null}

         <SharedConnectDialog connect={connect} />
         <BSManagerCleanupDialog cleanup={cleanup} onChanged={() => void overviewQuery.refetch()} />
      </PageBody>
   );
}

function SharedContentHelp() {
   const t = useTranslations('sharedContent.page.help');

   return (
      <Dialog>
         <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground size-7 rounded-full" aria-label={t('label')}>
               <CircleHelp />
            </Button>
         </DialogTrigger>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('summary')}</DialogDescription>
            </DialogHeader>
            <div className="text-muted-foreground flex flex-col gap-3 text-sm leading-relaxed">
               <p>{t('library')}</p>
               <p>{t('connect')}</p>
               <p>{t('disconnect')}</p>
            </div>
         </DialogContent>
      </Dialog>
   );
}
