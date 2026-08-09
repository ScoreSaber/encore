import { useState } from 'react';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { FolderPlus, FolderSymlink, Home, Monitor, Pin, PinOff, Plus, RefreshCw, Settings, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import { appIpc } from '@/modules/app/ipc';
import { AlphaWarningDialog } from '@/modules/app/renderer/alpha-warning-dialog';
import { DownloadVersionDialog } from '@/modules/downloads/renderer/download-version-dialog';
import { useVersionDownload } from '@/modules/downloads/renderer/use-version-download';
import type { InstallSummary } from '@/modules/installs/contract';
import { ImportInstallDialog } from '@/modules/installs/renderer/import-install-dialog';
import { InstallColorSwatch, InstallPlatformIcon } from '@/modules/installs/renderer/install-identity';
import { useInstallImport } from '@/modules/installs/renderer/use-install-import';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { MapLinkDialog } from '@/modules/maps/renderer/map-link-dialog';
import { ModelLinkDialog } from '@/modules/models/renderer/model-link-dialog';
import { ModRepositoryLinkDialog } from '@/modules/mods/renderer/mod-repository-link-dialog';
import { useRepositorySync } from '@/modules/mods/renderer/use-repository-sync';
import { PlaylistLinkDialog } from '@/modules/playlists/renderer/playlist-link-dialog';
import { DeepLinkLaunchDialog } from '@/modules/shortcuts/renderer/deep-link-launch-dialog';
import { localTargetId, type Target, type TargetId } from '@/modules/targets/contract';
import { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';
import { useAppUpdate } from '@/modules/updates/renderer/use-app-update';
import { ipcQueryKey } from '@/renderer/query/utils';

const sidebarItemClassName =
   'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 cursor-default items-center justify-center gap-3 rounded-md px-0 text-sm font-medium transition-colors sm:justify-start sm:px-3';
const activeSidebarItemClassName = 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground';
const activeSidebarRowClassName =
   'has-[[data-status=active]]:bg-primary has-[[data-status=active]]:text-primary-foreground has-[[data-status=active]]:hover:bg-primary has-[[data-status=active]]:hover:text-primary-foreground';
const appInfoQuery = queryOptions({
   queryKey: ipcQueryKey(appIpc.getInfo),
   queryFn: () => window.encore.app.getInfo(),
   staleTime: Infinity
});

export function AppShell({ children }: { children: React.ReactNode }) {
   const t = useTranslations('nav');
   const app = useTranslations('app');
   const common = useTranslations('common');
   const installs = useTranslations('installs');
   const updates = useTranslations('updates');
   const appInfo = useQuery(appInfoQuery);
   const appUpdate = useAppUpdate();
   const targetList = useSelectedTarget();
   useRepositorySync();
   const usesCustomTitleBar = window.encore.platform === 'win32';
   const supportsLocalBeatSaber = window.encore.platform === 'win32' || window.encore.platform === 'linux';
   const showSharedContent = supportsLocalBeatSaber || targetList.targets.some((target) => target.capabilities.includes('share-content'));
   const selectedTarget = targetList.targets.find((target) => target.id === targetList.targetId);
   const downloadTarget = selectedTarget?.capabilities.includes('download-install')
      ? selectedTarget
      : targetList.targets.find((target) => target.capabilities.includes('download-install'));
   const importTarget = selectedTarget?.capabilities.includes('import-install')
      ? selectedTarget
      : targetList.targets.find((target) => target.capabilities.includes('import-install'));
   const downloader = useVersionDownload(downloadTarget?.id ?? localTargetId);
   const importer = useInstallImport(importTarget?.id ?? localTargetId);
   const showTargets = window.encore.platform !== 'darwin' || targetList.targets.some((target) => target.kind === 'remote');
   const pathname = useRouterState({
      select: (state) => state.location.pathname
   });
   const settingsIsActive = pathname === '/settings';

   return (
      <>
         <div
            className={cn(
               'bg-background text-foreground h-screen',
               usesCustomTitleBar
                  ? 'grid grid-cols-[4.5rem_minmax(0,1fr)] grid-rows-[2rem_minmax(0,1fr)] sm:grid-cols-[15rem_minmax(0,1fr)]'
                  : 'flex flex-col'
            )}
         >
            <div className={cn(usesCustomTitleBar && 'col-start-2 row-start-1 border-b-[0.5px]')}>
               <header className="window-title-bar bg-background h-8 shrink-0" />
            </div>
            <div
               className={cn(
                  usesCustomTitleBar
                     ? 'contents'
                     : 'grid min-h-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)] border-t-[0.5px] sm:grid-cols-[15rem_minmax(0,1fr)]'
               )}
            >
               <aside
                  className={cn(
                     'bg-card/70 relative col-start-1 flex min-h-0 flex-col border-r px-2 py-5 sm:px-4',
                     usesCustomTitleBar ? 'row-span-2 row-start-1' : 'h-full'
                  )}
               >
                  {usesCustomTitleBar ? <div aria-hidden="true" className="window-title-bar absolute inset-x-0 top-0 h-5" /> : null}
                  <div className={cn('flex items-center justify-center gap-3 sm:justify-start', usesCustomTitleBar && 'window-title-bar')}>
                     <svg aria-hidden="true" className="text-primary size-11 shrink-0" viewBox="0 0 512 512" fill="none">
                        <path
                           d="M196 211H411.8846V166L256 76L100.1154 166V346L256 436L411.8846 346V301H196"
                           stroke="currentColor"
                           strokeWidth="54"
                           strokeLinejoin="round"
                        />
                     </svg>
                     <div className="hidden min-w-0 sm:block">
                        <div className="truncate text-sm font-semibold">{app('name')}</div>
                        <div className="flex min-w-0 items-center gap-1.5">
                           <div className="text-muted-foreground min-w-0 truncate text-xs">{appInfo.data?.release.label ?? common('loading')}</div>
                           {appUpdate.update.status === 'downloaded' ? (
                              <Tooltip>
                                 <TooltipTrigger asChild>
                                    <Button
                                       type="button"
                                       size="icon-xs"
                                       variant="secondary"
                                       className="window-no-drag size-5 cursor-pointer rounded-full p-0"
                                       aria-label={updates('downloaded')}
                                       onClick={appUpdate.installUpdate}
                                    >
                                       <RefreshCw className="size-2.5" />
                                    </Button>
                                 </TooltipTrigger>
                                 <TooltipContent side="right">{updates('downloaded')}</TooltipContent>
                              </Tooltip>
                           ) : null}
                        </div>
                     </div>
                  </div>

                  <Separator className="my-5" />

                  <nav className="flex min-h-0 flex-1 flex-col" aria-label={t('label')}>
                     <div className="flex flex-col gap-1">
                        <SidebarLink to="/" isActive={pathname === '/'}>
                           <Home className="size-4 shrink-0" />
                           <span className="hidden truncate sm:block">{t('home')}</span>
                        </SidebarLink>
                        {showSharedContent ? (
                           <SidebarLink to="/shared" isActive={pathname === '/shared'}>
                              <FolderSymlink className="size-4 shrink-0" />
                              <span className="hidden truncate sm:block">{t('shared')}</span>
                           </SidebarLink>
                        ) : null}
                     </div>

                     {showTargets ? <Separator className="my-4" /> : null}

                     <div className="min-h-0 flex-1 overflow-y-auto">{showTargets ? <SidebarTargets targetList={targetList} /> : null}</div>

                     <div className="shrink-0">
                        <Separator className="mb-3" />
                        {downloadTarget ? (
                           <button
                              type="button"
                              className={cn(sidebarItemClassName, 'mb-1 w-full')}
                              disabled={downloader.state.status !== 'idle'}
                              onClick={() => void downloader.open()}
                           >
                              <Plus className="size-4 shrink-0" />
                              <span className="hidden truncate sm:block">{t('addVersion')}</span>
                           </button>
                        ) : null}
                        {importTarget ? (
                           <button
                              type="button"
                              className={cn(sidebarItemClassName, 'mb-1 w-full')}
                              disabled={importer.state.status !== 'idle'}
                              onClick={() => void importer.choose()}
                           >
                              <FolderPlus className="size-4 shrink-0" />
                              <span className="hidden truncate sm:block">{installs('import.action')}</span>
                           </button>
                        ) : null}
                        <SidebarLink to="/settings" isActive={settingsIsActive}>
                           <Settings className="size-4 shrink-0" />
                           <span className="hidden truncate sm:block">{t('settings')}</span>
                        </SidebarLink>
                     </div>
                  </nav>
               </aside>

               <main className={cn('col-start-2 flex min-w-0 flex-col overflow-hidden', usesCustomTitleBar && 'row-start-2')}>{children}</main>
            </div>
         </div>
         <DeepLinkLaunchDialog />
         <MapLinkDialog />
         <ModelLinkDialog />
         <ModRepositoryLinkDialog />
         <PlaylistLinkDialog />
         <AlphaWarningDialog />
         <ImportInstallDialog importer={importer} />
         <DownloadVersionDialog downloader={downloader} targetName={downloadTarget?.name ?? downloader.targetId} />
         <Toaster richColors closeButton />
      </>
   );
}

function SidebarTargets({ targetList }: { targetList: ReturnType<typeof useSelectedTarget> }) {
   const t = useTranslations('targets');
   const common = useTranslations('common');
   const { status, reload } = targetList;
   const targets = targetList.targets.filter((target) => window.encore.platform !== 'darwin' || target.kind === 'remote');

   if (status === 'loading') {
      return (
         <div className="flex flex-col gap-1">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
         </div>
      );
   }

   if (status === 'error') {
      return (
         <div className="flex flex-col items-stretch gap-2 sm:px-3">
            <span className="hidden text-xs sm:block">{t('loadError')}</span>
            <RefreshButton label={common('retry')} onClick={reload} />
         </div>
      );
   }

   if (targets.length === 0) {
      return <div className="text-muted-foreground hidden px-3 text-xs sm:block">{t('empty')}</div>;
   }

   return (
      <div className="flex flex-col gap-3">
         {targets.map((target) => (
            <SidebarTargetSection key={target.id} target={target} showName={targets.length > 1} />
         ))}
      </div>
   );
}

function SidebarTargetSection({ target, showName }: { target: Target; showName: boolean }) {
   const t = useTranslations('targets');
   const TargetIcon = target.kind === 'remote' ? Wifi : Monitor;
   const installs = useInstalls(target.id);

   if (target.status !== 'ready') {
      return (
         <div
            className="text-muted-foreground flex h-10 items-center justify-center gap-3 rounded-md px-0 text-sm font-medium sm:justify-start sm:px-3"
            aria-label={target.name}
         >
            <TargetIcon className="size-4 shrink-0" />
            <span className="hidden min-w-0 flex-1 truncate sm:block">{target.name}</span>
            <span className="hidden shrink-0 text-xs sm:block">{t(`status.${target.status}`)}</span>
         </div>
      );
   }

   if (installs.loadStatus === 'ready' && (installs.snapshot?.installs.length ?? 0) === 0) return null;

   return (
      <div className="flex flex-col gap-1">
         {showName ? (
            <div className="text-muted-foreground hidden items-center px-3 text-xs font-medium sm:flex" aria-label={target.name}>
               <span className="min-w-0 truncate">{target.name}</span>
            </div>
         ) : null}
         <SidebarInstalls targetId={target.id} installs={installs} canOrganise={target.capabilities.includes('manage-installs')} />
      </div>
   );
}

function SidebarInstalls({
   targetId,
   installs,
   canOrganise
}: {
   targetId: TargetId;
   installs: ReturnType<typeof useInstalls>;
   canOrganise: boolean;
}) {
   const t = useTranslations('targets');
   const common = useTranslations('common');
   const [draggedInstallId, setDraggedInstallId] = useState<string | null>(null);

   if (installs.loadStatus === 'loading') {
      return <Skeleton className="h-10 rounded-md" />;
   }

   if (installs.loadStatus === 'error') {
      return (
         <div className="flex flex-col items-stretch gap-2 sm:px-3">
            <span className="hidden text-xs sm:block">{t('loadError')}</span>
            <RefreshButton label={common('retry')} onClick={installs.reload} />
         </div>
      );
   }

   const pinned = (installs.snapshot?.installs ?? []).filter((install) => install.pinned);
   const ordered = [...pinned, ...(installs.snapshot?.installs ?? []).filter((install) => !install.pinned)];

   const moveInstall = (installId: string, targetInstallId: string) => {
      if (installId === targetInstallId) return;

      const from = ordered.findIndex((install) => install.id === installId);
      const target = ordered.findIndex((install) => install.id === targetInstallId);
      if (from === -1 || target === -1 || ordered[from]?.pinned !== ordered[target]?.pinned) return;

      const next = [...ordered];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(target, 0, moved);
      installs.reorder(next.map((install) => install.id));
   };

   const moveInstallBy = (installId: string, offset: number) => {
      const index = ordered.findIndex((install) => install.id === installId);
      const target = ordered[index + offset];
      if (target) moveInstall(installId, target.id);
   };

   return ordered.map((install) => (
      <SidebarInstallRow
         key={install.id}
         install={install}
         targetId={targetId}
         canOrganise={canOrganise}
         canReorder={canOrganise && (install.pinned ? pinned.length : ordered.length - pinned.length) > 1}
         disabled={installs.organising}
         dragging={draggedInstallId === install.id}
         onPin={() => installs.setPinned(install.id, !install.pinned)}
         onDragStart={() => setDraggedInstallId(install.id)}
         onDragEnd={() => setDraggedInstallId(null)}
         onDrop={() => {
            if (draggedInstallId) moveInstall(draggedInstallId, install.id);
            setDraggedInstallId(null);
         }}
         onMove={(offset) => moveInstallBy(install.id, offset)}
      />
   ));
}

function SidebarInstallRow({
   install,
   targetId,
   canOrganise,
   canReorder,
   disabled,
   dragging,
   onPin,
   onDragStart,
   onDragEnd,
   onDrop,
   onMove
}: {
   install: InstallSummary;
   targetId: TargetId;
   canOrganise: boolean;
   canReorder: boolean;
   disabled: boolean;
   dragging: boolean;
   onPin: () => void;
   onDragStart: () => void;
   onDragEnd: () => void;
   onDrop: () => void;
   onMove: (offset: number) => void;
}) {
   const t = useTranslations('installs.sidebar');

   return (
      <div
         draggable={canReorder && !disabled}
         className={cn(sidebarItemClassName, activeSidebarRowClassName, 'group/install relative w-full transition-opacity', dragging && 'opacity-50')}
         onDragStart={(event) => {
            if (!canReorder || disabled || (event.target instanceof Element && event.target.closest('button'))) {
               event.preventDefault();
               return;
            }

            event.dataTransfer.clearData();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', install.id);
            onDragStart();
         }}
         onDragEnd={onDragEnd}
         onDragOver={(event) => {
            if (canReorder) event.preventDefault();
         }}
         onDrop={(event) => {
            event.preventDefault();
            onDrop();
         }}
      >
         <Link
            to="/installs/$installId"
            params={{ installId: install.id }}
            search={{ targetId }}
            draggable={false}
            className={cn('flex h-full min-w-0 flex-1 cursor-default items-center justify-center gap-3 sm:justify-start', canOrganise && 'sm:pr-6')}
            aria-label={install.name}
            aria-description={canReorder ? t('reorderHint') : undefined}
            onKeyDown={(event) => {
               if (!canReorder || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
               event.preventDefault();
               onMove(event.key === 'ArrowUp' ? -1 : 1);
            }}
         >
            <InstallColorSwatch color={install.color} />
            <InstallPlatformIcon store={install.store} />
            <span className="hidden min-w-0 flex-1 truncate sm:block">{install.name}</span>
         </Link>

         {canOrganise ? (
            <Tooltip>
               <TooltipTrigger asChild>
                  <Button
                     type="button"
                     variant="ghost"
                     size="icon-xs"
                     disabled={disabled}
                     draggable={false}
                     className="absolute right-1 hidden shrink-0 cursor-pointer opacity-0 group-focus-within/install:opacity-100 group-hover/install:opacity-100 sm:flex"
                     aria-label={t(install.pinned ? 'unpin' : 'pin', { name: install.name })}
                     onClick={onPin}
                  >
                     {install.pinned ? <PinOff /> : <Pin />}
                  </Button>
               </TooltipTrigger>
               <TooltipContent side="right">{t(install.pinned ? 'unpin' : 'pin', { name: install.name })}</TooltipContent>
            </Tooltip>
         ) : null}
      </div>
   );
}

function SidebarLink({ isActive, className, ...props }: React.ComponentProps<typeof Link> & { isActive?: boolean }) {
   return (
      <Link
         aria-current={isActive ? 'page' : undefined}
         className={cn(sidebarItemClassName, isActive && activeSidebarItemClassName, className)}
         {...props}
      />
   );
}
