import { useMemo, useRef, useState } from 'react';

import { ArrowUp, ChevronRight, Download, FolderInput, GripVertical, ListChecks, MoreHorizontal, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { RefreshButton } from '@/components/refresh-button';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MasterDetail, MasterDetailList, MasterDetailPane, MasterDetailRow } from '@/components/ui/master-detail';
import { cn } from '@/components/utils';

import { matchesQuery } from '@/app/renderer/collection/view';
import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { InstallSummary } from '@/modules/installs/contract';
import { knownModCategories, type ExternalMod, type ModSummary, type ReadyModsSnapshot } from '@/modules/mods/contract';
import { groupMods, orderModGroups, type ModGroup } from '@/modules/mods/renderer/grouping';
import { ManageModSourcesDialog } from '@/modules/mods/renderer/manage-mod-sources-dialog';
import { ModDetailPanel } from '@/modules/mods/renderer/mod-detail-panel';
import { modIssueKeys } from '@/modules/mods/renderer/mod-issue-keys';
import { SelectInstallModsDialog } from '@/modules/mods/renderer/select-install-mods-dialog';
import type { InstallMods } from '@/modules/mods/renderer/use-install-mods';
import { createDefaultModGroupSettings, type ModGroupSettings } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import type { TargetId } from '@/modules/targets/contract';

const defaultModGroupSettings = createDefaultModGroupSettings();

export function InstallModsPanel({ mods, targetId, otherInstalls }: { mods: InstallMods; targetId: TargetId; otherInstalls: InstallSummary[] }) {
   const t = useTranslations('mods');
   const common = useTranslations('common');
   const { snapshot, status } = mods;

   if (status === 'loading' && !snapshot) return <LoadingPanel />;

   if (status === 'error' || !snapshot) return <ErrorPanel message={t('loadError')} onRetry={mods.reload} />;

   if (snapshot.status === 'unavailable') {
      return (
         <EmptyPanel title={t('unavailable.title')} description={t(`issues.${modIssueKeys[snapshot.issue]}`)}>
            {snapshot.detail ? <p className="text-xs break-all">{snapshot.detail}</p> : null}
            <RefreshButton label={common('retry')} onClick={mods.refresh} />
         </EmptyPanel>
      );
   }

   return <ReadyMods mods={mods} targetId={targetId} snapshot={snapshot} otherInstalls={otherInstalls} />;
}

function ReadyMods({
   mods,
   targetId,
   snapshot,
   otherInstalls
}: {
   mods: InstallMods;
   targetId: TargetId;
   snapshot: ReadyModsSnapshot;
   otherInstalls: InstallSummary[];
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
   const [pendingGroupSettings, setPendingGroupSettings] = useState<ModGroupSettings | null>(null);
   const groupSettingsWrite = useRef(0);
   const sourcesChanged = useRef(false);
   const storedGroupSettings = settings.snapshot?.app.modGroups ?? defaultModGroupSettings;
   const groupSettings = pendingGroupSettings ?? storedGroupSettings;
   const categoryLabels = useMemo(() => new Map<string, string>(knownModCategories.map((category) => [category, t(`category.${category}`)])), [t]);
   const busy = mods.state.status !== 'idle' || mods.status === 'loading';
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

   function saveGroupSettings(next: ModGroupSettings) {
      const write = ++groupSettingsWrite.current;
      setPendingGroupSettings(next);
      void settings.updateApp({ modGroups: next }).then((result) => {
         if (write !== groupSettingsWrite.current) return;
         setPendingGroupSettings(result.ok ? result.value.app.modGroups : storedGroupSettings);
      });
   }

   function setGroupOpen(groupId: string, open: boolean) {
      const collapsed = new Set(groupSettings.collapsed);
      if (open) collapsed.delete(groupId);
      else collapsed.add(groupId);
      saveGroupSettings({ ...groupSettings, collapsed: [...collapsed] });
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
      saveGroupSettings({ ...groupSettings, order: [...visibleOrder, ...rememberedOnly] });
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
                  <ButtonGroup aria-label={t('pending.hint')}>
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
                  </ButtonGroup>
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
               targetId={targetId}
               installs={otherInstalls}
               currentMods={snapshot.mods}
               onOpenChange={setInstallSelectionOpen}
               onSelect={mods.select}
            />
         ) : null}

         <ManageModSourcesDialog
            open={sourcesOpen}
            onOpenChange={(open) => {
               setSourcesOpen(open);
               if (!open && sourcesChanged.current) mods.refresh();
            }}
            onChanged={() => {
               sourcesChanged.current = true;
            }}
         />

         {!snapshot.bsipaInstalled ? <WarningLine>{t('bsipaMissing')}</WarningLine> : null}

         {snapshot.mods.length + snapshot.external.length === 0 ? (
            <EmptyPanel title={t('empty.title')} description={t('empty.description', { version: snapshot.gameVersion })} />
         ) : (
            <MasterDetail>
               <MasterDetailList itemIds={visibleIds} selectedId={activeItemId} onSelect={setActiveItemId} aria-label={t('title')}>
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
                        activeModId={activeItemId}
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
                        activeItemId={activeItemId}
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

function ExternalFiles({
   files,
   open,
   canCollapse,
   activeItemId,
   onOpenChange,
   onSelect
}: {
   files: ExternalMod[];
   open: boolean;
   canCollapse: boolean;
   activeItemId: string | null;
   onOpenChange: (open: boolean) => void;
   onSelect: (id: string) => void;
}) {
   const t = useTranslations('mods');
   const format = useFormatters();

   return (
      <Collapsible open={open} onOpenChange={onOpenChange}>
         <SectionHeader>
            <span className="-ml-1 size-5 shrink-0" />
            <CollapsibleTrigger asChild>
               <button
                  type="button"
                  disabled={!canCollapse}
                  className="group flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left whitespace-nowrap"
                  aria-label={t(open ? 'groups.collapse' : 'groups.expand', { name: t('external.category') })}
               >
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="truncate font-medium">{t('external.category')}</span>
               </button>
            </CollapsibleTrigger>
         </SectionHeader>

         <CollapsibleContent>
            {files.map((file) => {
               const itemId = `external:${file.id}`;

               return (
                  <MasterDetailRow key={file.id} id={itemId} aria-selected={itemId === activeItemId} onClick={() => onSelect(itemId)}>
                     <Checkbox className="pointer-events-none" checked disabled aria-label={file.name} />
                     <span className="min-w-0 flex-1 truncate">{file.name}</span>
                     <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{format.bytes(file.sizeBytes)}</span>
                  </MasterDetailRow>
               );
            })}
         </CollapsibleContent>
      </Collapsible>
   );
}

function ModGroupSection({
   group,
   open,
   canCollapse,
   canReorder,
   dragging,
   ticked,
   activeModId,
   disabled,
   onOpenChange,
   onDragStart,
   onDragEnd,
   onDrop,
   onMove,
   onToggle,
   onSelect
}: {
   group: ModGroup;
   open: boolean;
   canCollapse: boolean;
   canReorder: boolean;
   dragging: boolean;
   ticked: Set<string>;
   activeModId: string | null;
   disabled: boolean;
   onOpenChange: (open: boolean) => void;
   onDragStart: () => void;
   onDragEnd: () => void;
   onDrop: () => void;
   onMove: (offset: number) => void;
   onToggle: (modId: string) => void;
   onSelect: (modId: string) => void;
}) {
   const t = useTranslations('mods');

   return (
      <Collapsible
         open={open}
         onOpenChange={onOpenChange}
         className={cn('transition-opacity', dragging && 'opacity-50')}
         onDragOver={(event) => {
            if (canReorder) event.preventDefault();
         }}
         onDrop={(event) => {
            event.preventDefault();
            onDrop();
         }}
      >
         <SectionHeader>
            <button
               type="button"
               draggable={canReorder}
               disabled={!canReorder}
               aria-label={t('groups.reorder', { name: group.label })}
               aria-description={t('groups.reorderHint')}
               className={cn(
                  '-ml-1 flex size-5 shrink-0 items-center justify-center rounded-sm',
                  canReorder ? 'hover:bg-accent cursor-grab active:cursor-grabbing' : 'cursor-default opacity-40'
               )}
               onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', group.id);
                  onDragStart();
               }}
               onDragEnd={onDragEnd}
               onKeyDown={(event) => {
                  if (!canReorder || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  event.preventDefault();
                  onMove(event.key === 'ArrowUp' ? -1 : 1);
               }}
            >
               <GripVertical className="size-3.5" />
            </button>

            <CollapsibleTrigger asChild>
               <button
                  type="button"
                  disabled={!canCollapse}
                  className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-label={t(open ? 'groups.collapse' : 'groups.expand', { name: group.label })}
               >
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="text-foreground min-w-0 truncate font-medium">{group.label}</span>
               </button>
            </CollapsibleTrigger>
         </SectionHeader>

         <CollapsibleContent>
            {group.mods.map((mod) => (
               <ModRow
                  key={mod.modId}
                  mod={mod}
                  checked={ticked.has(mod.modId)}
                  active={mod.modId === activeModId}
                  disabled={disabled}
                  onToggle={() => onToggle(mod.modId)}
                  onSelect={() => onSelect(mod.modId)}
               />
            ))}
         </CollapsibleContent>
      </Collapsible>
   );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
   return (
      <div className="bg-muted/20 text-muted-foreground sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b px-2 py-2 text-xs backdrop-blur">
         {children}
      </div>
   );
}

function ModRow({
   mod,
   checked,
   active,
   disabled,
   onToggle,
   onSelect
}: {
   mod: ModSummary;
   checked: boolean;
   active: boolean;
   disabled: boolean;
   onToggle: () => void;
   onSelect: () => void;
}) {
   const t = useTranslations('mods');
   const pending = mod.state === 'available' ? (checked ? 'install' : null) : checked ? null : 'remove';

   return (
      <MasterDetailRow id={mod.modId} aria-selected={active} onClick={onSelect}>
         <Checkbox
            className={cn(active && !checked && 'border-accent-foreground/40')}
            checked={checked}
            disabled={disabled}
            aria-label={mod.name}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={onToggle}
         />
         <span className="min-w-0 flex-1 truncate font-medium">{mod.name}</span>
         {pending ? (
            <span className={cn('shrink-0 whitespace-nowrap text-xs', pending === 'install' ? 'text-primary' : 'text-destructive')}>
               {t(`pending.${pending}`)}
            </span>
         ) : null}
         {mod.state === 'update-available' ? (
            <ArrowUp className="text-status-warning size-3.5 shrink-0" aria-label={t('states.updateAvailable')} />
         ) : null}
         <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {mod.state === 'update-available' && mod.installedVersion
               ? t('versionPair', { installed: mod.installedVersion, latest: mod.latestVersion })
               : (mod.installedVersion ?? mod.latestVersion)}
         </span>
      </MasterDetailRow>
   );
}
