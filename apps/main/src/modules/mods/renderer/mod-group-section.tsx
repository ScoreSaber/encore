import { ArrowUp, ChevronRight, GripVertical } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MasterDetailRow } from '@/components/ui/master-detail';
import { cn } from '@/components/utils';

import type { ExternalMod, ModSummary } from '@/modules/mods/contract';
import type { ModGroup } from '@/modules/mods/renderer/grouping';
import { useFormatters } from '@/renderer/i18n/formatters';

export function ExternalFiles({
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
                     <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {file.details?.version ?? (file.sizeBytes > 0 ? format.bytes(file.sizeBytes) : null)}
                     </span>
                  </MasterDetailRow>
               );
            })}
         </CollapsibleContent>
      </Collapsible>
   );
}

export function ModGroupSection({
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
