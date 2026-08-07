import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { EmptyPanel, ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { PageBody } from '@/app/renderer/shell/page-body';
import { EditInstallDialog } from '@/modules/installs/renderer/edit-install-dialog';
import { InstallActionDialog } from '@/modules/installs/renderer/install-action-dialog';
import { InstallActionsMenu } from '@/modules/installs/renderer/install-actions-menu';
import { InstallTopBar } from '@/modules/installs/renderer/install-top-bar';
import { useInstallActions } from '@/modules/installs/renderer/use-install-actions';
import { useInstallDetail } from '@/modules/installs/renderer/use-install-detail';
import { useInstallEditor } from '@/modules/installs/renderer/use-install-editor';
import { useInstallLaunch } from '@/modules/launch/renderer/use-install-launch';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { useInstallShortcuts } from '@/modules/shortcuts/renderer/use-install-shortcuts';
import { localTargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

const tabBodyClassName = 'flex min-h-0 flex-1 flex-col overflow-hidden px-8 pt-4 pb-6';
type InstallTab = 'mods' | 'maps' | 'models' | 'playlists';

const InstallModsTab = lazy(() => import('@/modules/mods/renderer/install-mods-tab').then((module) => ({ default: module.InstallModsTab })));
const InstallMapsTab = lazy(() => import('@/modules/maps/renderer/install-maps-tab').then((module) => ({ default: module.InstallMapsTab })));
const InstallModelsTab = lazy(() => import('@/modules/models/renderer/install-models-tab').then((module) => ({ default: module.InstallModelsTab })));
const InstallPlaylistsTab = lazy(() =>
   import('@/modules/playlists/renderer/install-playlists-tab').then((module) => ({ default: module.InstallPlaylistsTab }))
);

const installDetailSearchSchema = z.object({
   targetId: z.string().min(1).catch(localTargetId)
});

export const Route = createFileRoute('/installs_/$installId')({
   validateSearch: installDetailSearchSchema,
   component: InstallDetailRoute
});

function InstallDetailRoute() {
   const { installId } = Route.useParams();
   const { targetId } = Route.useSearch();
   const t = useTranslations('installs');
   const common = useTranslations('common');
   const request = useMemo(() => ({ targetId, installId }), [targetId, installId]);
   const { detail, status, reload } = useInstallDetail(request);
   const { targets } = useTargets();
   const settings = useSettings();
   const editor = useInstallEditor(request);
   const actions = useInstallActions(request);
   const launch = useInstallLaunch(request);
   const shortcuts = useInstallShortcuts(request, launch.options);
   const [activeTab, setActiveTab] = useState<InstallTab>('mods');
   const [loadedTabs, setLoadedTabs] = useState<Set<InstallTab>>(() => new Set(['mods']));
   const [folderFailed, setFolderFailed] = useState(false);
   const navigate = useNavigate();
   const pendingSelection = useRef<string | null>(null);
   const target = targets.find((candidate) => candidate.id === targetId) ?? null;
   const supportsManagement = target?.capabilities.includes('manage-installs') ?? false;

   useEffect(() => {
      const selection = settings.snapshot?.app.selection;
      const selectionKey = `${targetId}:${installId}`;
      if (!selection) return;
      if (selection.targetId === targetId && selection.installIds[targetId] === installId) {
         pendingSelection.current = null;
         return;
      }
      if (pendingSelection.current === selectionKey) return;

      pendingSelection.current = selectionKey;
      void settings.updateApp({
         selection: {
            targetId,
            installIds: { [targetId]: installId }
         }
      });
   }, [settings, targetId, installId]);

   // the selection sync above already points settings at this target, so /shared opens on it
   const manageSharedContent = () => void navigate({ to: '/shared' });

   const openFolder = async () => {
      const opened = await actions.openFolder().catch(() => null);
      setFolderFailed(opened?.status !== 'opened');
   };

   const selectTab = (value: string) => {
      const tab = value as InstallTab;
      setActiveTab(tab);
      setLoadedTabs((current) => (current.has(tab) ? current : new Set([...current, tab])));
   };

   if (actions.removed) return <Navigate to="/" replace />;

   if (!detail) {
      return (
         <PageBody className="gap-5">
            {status === 'loading' ? <LoadingPanel rows={2} /> : null}

            {status === 'error' ? <ErrorPanel message={t('detail.loadError')} onRetry={reload} /> : null}

            {status === 'missing' ? <EmptyPanel title={t('detail.missing.title')} description={t('detail.missing.description')} /> : null}
         </PageBody>
      );
   }

   return (
      <>
         <Tabs value={activeTab} onValueChange={selectTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <InstallTopBar
               detail={detail}
               launch={launch}
               onEdit={supportsManagement ? () => editor.open(detail) : undefined}
               actions={
                  <InstallActionsMenu
                     detail={detail}
                     targetId={targetId}
                     supportsManagement={supportsManagement}
                     editor={editor}
                     actions={actions}
                     shortcuts={shortcuts}
                     onOpenFolder={() => void openFolder()}
                     onManageSharedContent={manageSharedContent}
                  />
               }
               tabs={
                  <TabsList variant="line">
                     <TabsTrigger value="mods">{t('detail.tabs.mods')}</TabsTrigger>
                     <TabsTrigger value="maps">{t('detail.tabs.maps')}</TabsTrigger>
                     <TabsTrigger value="models">{t('detail.tabs.models')}</TabsTrigger>
                     <TabsTrigger value="playlists">{t('detail.tabs.playlists')}</TabsTrigger>
                  </TabsList>
               }
            />

            {folderFailed ? <p className="text-muted-foreground px-8 pt-3 text-sm">{common('openFolder.failed')}</p> : null}

            <TabsContent forceMount value="mods" className={`${tabBodyClassName} data-[state=inactive]:hidden`}>
               {loadedTabs.has('mods') ? (
                  <Suspense fallback={<LoadingPanel />}>
                     <InstallModsTab request={request} active={activeTab === 'mods'} />
                  </Suspense>
               ) : null}
            </TabsContent>

            <TabsContent forceMount value="maps" className={`${tabBodyClassName} data-[state=inactive]:hidden`}>
               {loadedTabs.has('maps') ? (
                  <Suspense fallback={<LoadingPanel />}>
                     <InstallMapsTab request={request} active={activeTab === 'maps'} onManageSharedContent={manageSharedContent} />
                  </Suspense>
               ) : null}
            </TabsContent>

            <TabsContent forceMount value="models" className={`${tabBodyClassName} data-[state=inactive]:hidden`}>
               {loadedTabs.has('models') ? (
                  <Suspense fallback={<LoadingPanel />}>
                     <InstallModelsTab request={request} active={activeTab === 'models'} onManageSharedContent={manageSharedContent} />
                  </Suspense>
               ) : null}
            </TabsContent>

            <TabsContent forceMount value="playlists" className={`${tabBodyClassName} data-[state=inactive]:hidden`}>
               {loadedTabs.has('playlists') ? (
                  <Suspense fallback={<LoadingPanel />}>
                     <InstallPlaylistsTab request={request} active={activeTab === 'playlists'} onManageSharedContent={manageSharedContent} />
                  </Suspense>
               ) : null}
            </TabsContent>
         </Tabs>

         <EditInstallDialog editor={editor} />
         <InstallActionDialog request={request} actions={actions} />
      </>
   );
}
