import { useMemo, useRef, useState } from 'react';

import { useQueries } from '@tanstack/react-query';
import { ArrowUp, Download, FolderInput, ListChecks, MoreHorizontal, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { matchesQuery } from '@/components/collection/selection';
import { RefreshButton } from '@/components/refresh-button';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MasterDetail, MasterDetailList, MasterDetailPane } from '@/components/ui/master-detail';

import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import type { TargetModRequest } from '@/modules/mods/api';
import { knownModCategories, type ReadyModsSnapshot } from '@/modules/mods/contract';
import { groupMods, orderModGroups } from '@/modules/mods/renderer/grouping';
import { ManageModSourcesDialog } from '@/modules/mods/renderer/manage-mod-sources-dialog';
import { ModActionDialog } from '@/modules/mods/renderer/mod-action-dialog';
import { ModDetailPanel } from '@/modules/mods/renderer/mod-detail-panel';
import { ExternalFiles, ModGroupSection } from '@/modules/mods/renderer/mod-group-section';
import { SelectInstallModsDialog, type ModSourceInstall } from '@/modules/mods/renderer/select-install-mods-dialog';
import { useInstallMods, type InstallMods } from '@/modules/mods/renderer/use-install-mods';
import { QuestPatchBanner } from '@/modules/quest/renderer/quest-patch-banner';
import { createDefaultModGroupSettings } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import type { TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

const defaultModGroupSettings = createDefaultModGroupSettings();

export function InstallModsTab({ request, active }: { request: TargetModRequest; active: boolean }) {
   const mods = useInstallMods(request);
   const installs = useInstalls(request.targetId);
   const { targets } = useTargets();
   const target = targets.find((candidate) => candidate.id === request.targetId);
   const quest = target?.kind === 'quest';
   const sourceTargets = targets.filter(
      (candidate) => candidate.status === 'ready' && candidate.capabilities.includes('manage-mods') && (candidate.kind === 'quest') === quest
   );
   const sourceQueries = useQueries({ queries: sourceTargets.map((candidate) => installListQueryOptions(candidate.id)) });
   const otherInstalls = sourceTargets.flatMap((candidate, index) =>
      (sourceQueries[index]?.data?.installs ?? [])
         .filter((install) => candidate.id !== request.targetId || install.id !== request.installId)
         .map((install) => ({ targetId: candidate.id, targetName: candidate.name, install }))
   );
   const patchRecoveryAvailable =
      (target?.capabilities.includes('patch-game') ?? false) &&
      (installs.snapshot?.installs.some((install) => install.id === request.installId && install.status === 'incomplete') ?? false);

   return (
      <>
         {active ? (
            <InstallModsPanel mods={mods} targetId={request.targetId} otherInstalls={otherInstalls} patchRecoveryAvailable={patchRecoveryAvailable} />
         ) : null}
         <ModActionDialog request={request} mods={mods} />
      </>
   );
}

function InstallModsPanel({
   mods,
   targetId,
   otherInstalls,
   patchRecoveryAvailable
}: {
   mods: InstallMods;
   targetId: TargetId;
   otherInstalls: ModSourceInstall[];
   patchRecoveryAvailable: boolean;
}) {
   const t = useTranslations('mods');
   const common = useTranslations('common');
   const { snapshot, status } = mods;

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
         {patchRecoveryAvailable ? <QuestPatchBanner targetId={targetId} onPatched={mods.reload} /> : null}
         {status === 'loading' && !snapshot ? (
            <LoadingPanel />
         ) : status === 'error' || !snapshot ? (
            <ErrorPanel message={t('loadError')} onRetry={mods.reload} />
         ) : snapshot.status === 'unavailable' ? (
            <EmptyPanel title={t('unavailable.title')} description={t(`issues.${snapshot.issue}`, { platform: mods.platform })}>
               {snapshot.detail ? <p className="text-xs break-all">{snapshot.detail}</p> : null}
               <RefreshButton label={common('retry')} onClick={mods.refresh} />
            </EmptyPanel>
         ) : (
            <ReadyMods
               mods={mods}
               targetId={targetId}
               snapshot={snapshot}
               otherInstalls={otherInstalls}
               patchRecoveryAvailable={patchRecoveryAvailable}
            />
         )}
      </div>
   );
}

function ReadyMods({
   mods,
   targetId,
   snapshot,
   otherInstalls,
   patchRecoveryAvailable
}: {
   mods: InstallMods;
   targetId: TargetId;
   snapshot: ReadyModsSnapshot;
   otherInstalls: ModSourceInstall[];
   patchRecoveryAvailable: boolean;
}) {
   const t = useTranslations('mods');
   const common = useTranslations('common');
   const settings = useSettings();
   const [query, setQuery] = useState('');
   const [sourcesOpen, setSourcesOpen] = useState(false);
   const [installSelectionOpen, setInstallSelectionOpen] = useState(false);
   const [activeItemId, setActiveItemId] = useState<string | null>(null);
   const [externalOpen, setExternalOpen] = useState(true);
   const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
   const sourcesChanged = useRef(false);
   const groupSettings = settings.snapshot?.app.modGroups ?? defaultModGroupSettings;
   const categoryLabels = useMemo(() => new Map<string, string>(knownModCategories.map((category) => [category, t(`category.${category}`)])), [t]);
   const busy = mods.flow.state.status !== 'idle' || mods.status === 'loading';
   const ticked = new Set(mods.selected);
   const toInstall = snapshot.mods.filter((mod) => mod.state === 'available' && ticked.has(mod.modId)).map((mod) => mod.modId);
   const toUpdate = snapshot.mods.filter((mod) => mod.state === 'update-available' && ticked.has(mod.modId)).map((mod) => mod.modId);
   const toRemove = snapshot.mods.filter((mod) => mod.state !== 'available' && !ticked.has(mod.modId)).map((mod) => mod.modId);
   const applyingChanges = toInstall.length > 0 && toRemove.length > 0;
   const nothingInstalled = snapshot.mods.every((mod) => mod.state === 'available') && snapshot.external.length === 0;
   const filterText = query.trim().toLowerCase();
   const visible = snapshot.mods.filter((mod) =>
      matchesQuery(filterText, [mod.name, mod.summary, mod.author, mod.sourceName, categoryLabels.get(mod.category) ?? mod.category])
   );
   const visibleExternal = snapshot.external.filter((file) => matchesQuery(filterText, [file.name, file.path, t('external.category')]));
   const baseGroups = useMemo(
      () => groupMods(snapshot.mods, (category) => categoryLabels.get(category) ?? category),
      [snapshot.mods, categoryLabels]
   );
   const orderedGroups = orderModGroups(baseGroups, groupSettings.order);
   const visibleModIds = new Set(visible.map((mod) => mod.modId));
   const groups = orderedGroups
      .map((group) => ({ ...group, mods: group.mods.filter((mod) => visibleModIds.has(mod.modId)) }))
      .filter((group) => group.mods.length > 0);
   const filtering = filterText.length > 0;
   const visibleIds = groups
      .filter((group) => filtering || !groupSettings.collapsed.includes(group.id))
      .flatMap((group) => group.mods.map((mod) => mod.modId));
   if (filtering || externalOpen) visibleIds.push(...visibleExternal.map((file) => `external:${file.id}`));
   const activeMod = snapshot.mods.find((mod) => mod.modId === activeItemId) ?? null;
   const activeExternal = snapshot.external.find((file) => `external:${file.id}` === activeItemId) ?? null;
   const resolvedActiveItemId = activeMod ? activeMod.modId : activeExternal ? `external:${activeExternal.id}` : null;

   function setGroupOpen(groupId: string, open: boolean) {
      const collapsed = new Set(groupSettings.collapsed);
      if (open) collapsed.delete(groupId);
      else collapsed.add(groupId);
      void settings.updateApp({ modGroups: { ...groupSettings, collapsed: [...collapsed] } });
   }

   function moveGroup(groupId: string, targetId: string) {
      if (groupId === targetId) return;

      const visibleOrder = orderedGroups.map((group) => group.id);
      const from = visibleOrder.indexOf(groupId);
      const target = visibleOrder.indexOf(targetId);
      if (from === -1 || target === -1) return;

      visibleOrder.splice(from, 1);
      visibleOrder.splice(target, 0, groupId);
      const rememberedOnly = groupSettings.order.filter((id) => !visibleOrder.includes(id));
      void settings.updateApp({ modGroups: { ...groupSettings, order: [...visibleOrder, ...rememberedOnly] } });
   }

   function moveGroupBy(groupId: string, offset: number) {
      const index = orderedGroups.findIndex((group) => group.id === groupId);
      const target = orderedGroups[index + offset];
      if (target) moveGroup(groupId, target.id);
   }

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
         <CollectionToolbar
            filter={{ value: query, label: common('search'), onChange: setQuery }}
            rescan={{ label: common('refresh'), busy: mods.status === 'loading', disabled: busy, onClick: mods.refresh }}
            menu={
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button type="button" variant="ghost" size="icon-sm" aria-label={t('moreActions')} disabled={busy}>
                        <MoreHorizontal />
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     <DropdownMenuItem onSelect={() => void mods.chooseImport()}>
                        <FolderInput />
                        {t('import.action')}
                     </DropdownMenuItem>
                     <DropdownMenuItem
                        onSelect={() => {
                           sourcesChanged.current = false;
                           setSourcesOpen(true);
                        }}
                     >
                        <Settings2 />
                        {t('sources.manage.action')}
                     </DropdownMenuItem>
                     {otherInstalls.length > 0 ? (
                        <DropdownMenuItem onSelect={() => setInstallSelectionOpen(true)}>
                           <ListChecks />
                           {t('selectFromInstall.action')}
                        </DropdownMenuItem>
                     ) : null}
                     <DropdownMenuSeparator />
                     <DropdownMenuItem variant="destructive" disabled={nothingInstalled} onSelect={() => void mods.previewUninstall('all', [])}>
                        <Trash2 />
                        {t('uninstall.allAction')}
                     </DropdownMenuItem>
                  </DropdownMenuContent>
               </DropdownMenu>
            }
         >
            {toUpdate.length + toRemove.length + toInstall.length > 0 ? (
               <>
                  <div className="flex flex-wrap gap-2">
                     {toUpdate.length > 0 ? (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mods.previewInstall(toUpdate)}>
                           <ArrowUp data-icon="inline-start" />
                           {t('install.updateAction', { count: toUpdate.length })}
                        </Button>
                     ) : null}
                     {applyingChanges ? (
                        <Button type="button" size="sm" disabled={busy} onClick={() => void mods.previewChanges(toInstall, toRemove)}>
                           <ListChecks data-icon="inline-start" />
                           {t('changes.action')}
                        </Button>
                     ) : null}
                     {!applyingChanges && toRemove.length > 0 ? (
                        <Button
                           type="button"
                           variant="outline"
                           size="sm"
                           disabled={busy}
                           onClick={() => void mods.previewUninstall('selection', toRemove)}
                        >
                           <Trash2 data-icon="inline-start" />
                           {t('uninstall.action', { count: toRemove.length })}
                        </Button>
                     ) : null}
                     {!applyingChanges && toInstall.length > 0 ? (
                        <Button type="button" size="sm" disabled={busy} onClick={() => void mods.previewInstall(toInstall)}>
                           <Download data-icon="inline-start" />
                           {t('install.action', { count: toInstall.length })}
                        </Button>
                     ) : null}
                  </div>
                  {toInstall.length + toRemove.length > 0 ? (
                     <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={mods.resetSelection}>
                        <RotateCcw data-icon="inline-start" />
                        {t('pending.reset')}
                     </Button>
                  ) : null}
               </>
            ) : null}
         </CollectionToolbar>

         {otherInstalls.length > 0 ? (
            <SelectInstallModsDialog
               open={installSelectionOpen}
               sources={otherInstalls}
               currentMods={snapshot.mods}
               onOpenChange={setInstallSelectionOpen}
               onSelect={mods.select}
            />
         ) : null}

         <ManageModSourcesDialog
            open={sourcesOpen}
            onOpenChange={(open) => {
               setSourcesOpen(open);
               if (!open && sourcesChanged.current) {
                  sourcesChanged.current = false;
                  mods.refresh();
               }
            }}
            onChanged={() => {
               sourcesChanged.current = true;
            }}
         />

         {!snapshot.bsipaInstalled && !patchRecoveryAvailable ? (
            snapshot.platform === 'quest' ? (
               <QuestPatchBanner targetId={targetId} onPatched={mods.reload} />
            ) : (
               <WarningLine>{t('bsipaMissing')}</WarningLine>
            )
         ) : null}

         {snapshot.mods.length + snapshot.external.length === 0 ? (
            <EmptyPanel
               title={t('empty.title')}
               description={t('empty.description', { version: snapshot.gameVersion.replace(/_\d+$/, ''), platform: mods.platform })}
            />
         ) : (
            <MasterDetail>
               <MasterDetailList itemIds={visibleIds} selectedId={resolvedActiveItemId} onSelect={setActiveItemId} aria-label={t('title')}>
                  {groups.length === 0 && visibleExternal.length === 0 ? <p className="text-muted-foreground px-3 py-6">{t('filterEmpty')}</p> : null}
                  {groups.map((group) => (
                     <ModGroupSection
                        key={group.id}
                        group={group}
                        open={filtering || !groupSettings.collapsed.includes(group.id)}
                        canCollapse={!filtering}
                        canReorder={!filtering && orderedGroups.length > 1}
                        dragging={draggedGroupId === group.id}
                        ticked={ticked}
                        activeModId={resolvedActiveItemId}
                        disabled={busy}
                        onOpenChange={(open) => setGroupOpen(group.id, open)}
                        onDragStart={() => setDraggedGroupId(group.id)}
                        onDragEnd={() => setDraggedGroupId(null)}
                        onDrop={() => {
                           if (draggedGroupId) moveGroup(draggedGroupId, group.id);
                           setDraggedGroupId(null);
                        }}
                        onMove={(offset) => moveGroupBy(group.id, offset)}
                        onToggle={(modId) => mods.toggle(modId)}
                        onSelect={setActiveItemId}
                     />
                  ))}

                  {visibleExternal.length > 0 ? (
                     <ExternalFiles
                        files={visibleExternal}
                        open={filtering || externalOpen}
                        canCollapse={!filtering}
                        activeItemId={resolvedActiveItemId}
                        onOpenChange={setExternalOpen}
                        onSelect={setActiveItemId}
                     />
                  ) : null}
               </MasterDetailList>

               <MasterDetailPane>
                  <ModDetailPanel mods={mods} mod={activeMod} external={activeExternal} />
               </MasterDetailPane>
            </MasterDetail>
         )}
      </div>
   );
}
