import { useEffect, useMemo, useRef, useState } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { Result } from 'better-result';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { EmptyPanel, ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { MirrorDialog, useInstallMirror } from '@/modules/install-mirror/renderer/mirror-dialog';
import type { InstallId } from '@/modules/installs/contract';
import { EditInstallDialog } from '@/modules/installs/renderer/edit-install-dialog';
import { InstallActionDialog } from '@/modules/installs/renderer/install-action-dialog';
import { InstallActionsMenu } from '@/modules/installs/renderer/install-actions-menu';
import { InstallTopBar } from '@/modules/installs/renderer/install-top-bar';
import { installDetailQueryOptions } from '@/modules/installs/renderer/queries';
import { useInstallActions } from '@/modules/installs/renderer/use-install-actions';
import { useInstallDetail } from '@/modules/installs/renderer/use-install-detail';
import { useInstallEditor } from '@/modules/installs/renderer/use-install-editor';
import { useLaunchDestinations } from '@/modules/launch/renderer/launch-choice';
import { useInstallLaunch } from '@/modules/launch/renderer/use-install-launch';
import { InstallMapsTab } from '@/modules/maps/renderer/install-maps-panel';
import { InstallModelsTab } from '@/modules/models/renderer/install-models-panel';
import { InstallModsTab } from '@/modules/mods/renderer/install-mods-panel';
import { modListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import { InstallPlaylistsTab } from '@/modules/playlists/renderer/install-playlists-panel';
import { useHeadsetStatus } from '@/modules/quest/renderer/quest-headset-status';
import { QuestOffline } from '@/modules/quest/renderer/quest-offline';
import { QuestPatchBanner } from '@/modules/quest/renderer/quest-patch-banner';
import { questStateQueryOptions } from '@/modules/quest/renderer/quest-queries';
import { QuestUnmodDialog } from '@/modules/quest/renderer/quest-unmod-dialog';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { useInstallShortcuts } from '@/modules/shortcuts/renderer/use-install-shortcuts';
import { localTargetId, runsOnSteamFrame, type TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapIpc } from '@/renderer/ipc-result';
import { PageBody } from '@/renderer/shell/page-body';

const tabBodyClassName = 'flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-4 pb-6 sm:px-8';
const installTabSchema = z.enum(['mods', 'maps', 'models', 'playlists']);
type InstallTab = z.infer<typeof installTabSchema>;

const installTabs = { mods: InstallModsTab, maps: InstallMapsTab, models: InstallModelsTab, playlists: InstallPlaylistsTab };

const installDetailSearchSchema = z.object({
   targetId: z.string().min(1).catch(localTargetId)
});

export const Route = createFileRoute('/installs_/$installId')({
   validateSearch: installDetailSearchSchema,
   loaderDeps: ({ search }) => ({ targetId: search.targetId }),
   loader: async ({ cause, context, deps, params }) => {
      if (cause !== 'stay') return;

      await context.queryClient.prefetchQuery(installDetailQueryOptions({ targetId: deps.targetId, installId: params.installId }));
   },
   component: InstallDetailRoute
});

function InstallDetailRoute() {
   const { installId } = Route.useParams();
   const { targetId } = Route.useSearch();
   const offline = useTargets().targets.find((target) => target.id === targetId && target.kind === 'quest' && target.status !== 'ready');

   if (offline) return <QuestOffline target={offline} />;

   return <InstallDetail key={`${targetId}\0${installId}`} targetId={targetId} installId={installId} />;
}

function InstallDetail({ targetId, installId }: { targetId: TargetId; installId: InstallId }) {
   const t = useTranslations('installs');
   const common = useTranslations('common');
   const quest = useTranslations('quest');
   const request = useMemo(() => ({ targetId, installId }), [targetId, installId]);
   const { detail, status, reload } = useInstallDetail(request);
   const { targets } = useTargets();
   const headsetStatus = useHeadsetStatus();
   const settings = useSettings();
   const editor = useInstallEditor(request);
   const actions = useInstallActions(request);
   const launch = useInstallLaunch(request);
   const shortcuts = useInstallShortcuts(request, launch.options);
   const [activeTab, setActiveTab] = useState<InstallTab>('mods');
   const [loadedTabs, setLoadedTabs] = useState<Set<InstallTab>>(() => new Set(['mods']));
   const [folderFailed, setFolderFailed] = useState(false);
   const rememberAttempted = useRef(false);
   const target = targets.find((candidate) => candidate.id === targetId) ?? null;
   const supportsManagement = target?.capabilities.includes('manage-installs') ?? false;
   const questTarget = target?.capabilities.includes('patch-game') ?? false;
   const mods = useQuery({ ...modListQueryOptions(request), enabled: questTarget });
   const questState = useQuery({ ...questStateQueryOptions(targetId), enabled: questTarget });
   const unmod = useOperationFlow<{ kind: 'unmod' }>(targetId);
   const navigate = useNavigate();
   const forget = useMutation({
      mutationFn: async () => unwrapIpc(await window.encore.quest.forgetHeadset({ targetId })),
      onSuccess: () => void navigate({ to: '/' })
   });
   const canForget = window.encore.runtime === 'desktop' && target?.kind === 'quest' && target.connection !== 'remote';
   const unmodDialog = questTarget ? <QuestUnmodDialog flow={unmod} targetId={targetId} /> : null;
   const modded = questTarget && mods.data?.status === 'ready' && mods.data.bsipaInstalled;
   const mirror = useInstallMirror();
   const mirrors = settings.snapshot?.library.mirrors ?? [];
   const copyToFrame = runsOnSteamFrame(targets) && target?.kind === 'remote' && detail?.store === 'steam' && Boolean(detail.version);
   const destinations = useLaunchDestinations({
      launch,
      installId,
      version: detail?.version ?? null,
      onMirror: copyToFrame ? () => mirror.open({ sourceTargetId: targetId, sourceInstallIds: [installId] }) : undefined
   });
   const elsewhere = destinations?.elsewhere ?? null;
   const chosenTargetId = elsewhere?.target.id ?? targetId;
   const chosenInstallId = elsewhere?.installId ?? installId;
   const chosenRequest = useMemo(() => ({ targetId: chosenTargetId, installId: chosenInstallId }), [chosenTargetId, chosenInstallId]);
   const chosenLaunch = useInstallLaunch(chosenRequest);
   const activeLaunch = elsewhere ? chosenLaunch : launch;
   const contentTarget = elsewhere?.target ?? target;
   const dismissedHints = settings.snapshot?.app.dismissedHints ?? [];
   const copyHintKey = `frame-copy/${targetId}/${installId}`;
   const tabs = installTabSchema.options.filter((tab) => contentTarget?.capabilities.includes(`manage-${tab}`) ?? true);
   const resolvedTab = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? 'mods');

   const selection = settings.snapshot?.app.selection;
   const { updateApp } = settings;
   const remembered = selection?.targetId === targetId && selection.installIds[targetId] === installId;

   useEffect(() => {
      if (!selection || remembered || rememberAttempted.current) return;

      rememberAttempted.current = true;
      void updateApp({ selection: { targetId, installIds: { [targetId]: installId } } });
   }, [installId, remembered, selection, targetId, updateApp]);

   const openFolder = async () => {
      setFolderFailed(false);
      const opened = await Result.tryPromise(() => actions.openFolder());
      setFolderFailed(Result.isError(opened) || opened.value.status !== 'opened');
   };

   if (actions.removed) return <Navigate to="/" replace />;

   if (!detail) {
      return (
         <PageBody className="gap-5">
            {status === 'loading' ? <LoadingPanel /> : null}

            {status === 'error' || status === 'unsupported' ? <ErrorPanel message={t('detail.loadError')} onRetry={reload} /> : null}

            {status === 'missing' ? <EmptyPanel title={t('detail.missing.title')} description={t('detail.missing.description')} /> : null}
         </PageBody>
      );
   }

   if (detail.version === null && questTarget) {
      return (
         <PageBody className="gap-5">
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
            {detail.status === 'incomplete' ? (
               <QuestPatchBanner targetId={targetId} onPatched={reload} />
            ) : (
               <EmptyPanel title={quest('gameMissing.title')} description={quest('gameMissing.description')}>
                  {questState.data?.savedPlayerData ? <p className="text-xs">{quest('gameMissing.savedPlayerData')}</p> : null}
               </EmptyPanel>
            )}
            {unmodDialog}
         </PageBody>
      );
   }

   const mirrorRecord = targetId === localTargetId ? mirrors.find((record) => record.path === detail.path) : undefined;
   const mirrorSource = copyToFrame
      ? { request: { sourceTargetId: targetId, sourceInstallIds: [detail.id] }, label: t('mirror.toFrame'), toFrame: true }
      : mirrorRecord
        ? {
             request: { sourceTargetId: mirrorRecord.targetId, sourceInstallIds: [mirrorRecord.installId] },
             label: t('mirror.sync', { device: targets.find((candidate) => candidate.id === mirrorRecord.targetId)?.name ?? '' }),
             toFrame: false
          }
        : null;

   return (
      <>
         <Tabs
            value={resolvedTab}
            onValueChange={(value) => {
               const tab = installTabSchema.safeParse(value);
               if (!tab.success) return;

               setActiveTab(tab.data);
               setLoadedTabs((current) => (current.has(tab.data) ? current : new Set([...current, tab.data])));
            }}
            className="flex min-h-0 flex-1 flex-col gap-0"
         >
            <InstallTopBar
               detail={detail}
               quest={questTarget}
               launch={activeLaunch}
               destinations={destinations}
               onEdit={supportsManagement ? () => editor.open(detail) : undefined}
               copyHint={
                  copyToFrame && destinations?.menu.onMirror && !dismissedHints.includes(copyHintKey)
                     ? {
                          onCopy: () => mirror.open({ sourceTargetId: targetId, sourceInstallIds: [installId] }),
                          onDismiss: () => void settings.updateApp({ dismissedHints: [...dismissedHints, copyHintKey] })
                       }
                     : undefined
               }
               onSync={
                  mirrorSource && !mirrorSource.toFrame ? { label: mirrorSource.label, onSelect: () => mirror.open(mirrorSource.request) } : undefined
               }
               summary={target?.kind === 'quest' ? `${target.name} · ${headsetStatus(target)}` : undefined}
               actions={
                  <InstallActionsMenu
                     detail={detail}
                     targetId={targetId}
                     supportsManagement={supportsManagement}
                     editor={editor}
                     actions={actions}
                     shortcuts={shortcuts}
                     onOpenFolder={() => void openFolder()}
                     onUnmod={modded ? () => unmod.settle({ status: 'ready', kind: 'unmod' }) : undefined}
                     onForget={
                        canForget
                           ? () => {
                                if (!forget.isPending) forget.mutate();
                             }
                           : undefined
                     }
                     mirror={mirrorSource?.toFrame ? { label: mirrorSource.label, onSelect: () => mirror.open(mirrorSource.request) } : undefined}
                  />
               }
               tabs={
                  <TabsList variant="line">
                     {tabs.map((tab) => (
                        <TabsTrigger key={tab} value={tab}>
                           {t(`detail.tabs.${tab}`)}
                        </TabsTrigger>
                     ))}
                  </TabsList>
               }
            />

            {folderFailed ? <p className="text-muted-foreground px-8 pt-3 text-sm">{common('openFolder.failed')}</p> : null}

            {tabs.map((tab) => {
               const Tab = installTabs[tab];

               return (
                  <TabsContent key={tab} forceMount value={tab} className={`${tabBodyClassName} data-[state=inactive]:hidden`}>
                     {loadedTabs.has(tab) || resolvedTab === tab ? (
                        <Tab key={`${chosenTargetId}\0${chosenInstallId}`} request={chosenRequest} active={resolvedTab === tab} />
                     ) : null}
                  </TabsContent>
               );
            })}
         </Tabs>

         <EditInstallDialog editor={editor} />
         {editor.dialog}
         <InstallActionDialog request={request} actions={actions} />
         <MirrorDialog mirror={mirror} />
         {unmodDialog}
      </>
   );
}
