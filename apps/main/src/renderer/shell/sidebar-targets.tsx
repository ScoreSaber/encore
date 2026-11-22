import { useState } from 'react';

import { useQueries } from '@tanstack/react-query';
import { Monitor, Pin, PinOff, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { AppLink } from '@/components/app-link';
import { QuestIcon } from '@/components/headset-icons';
import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import type { InstallSummary } from '@/modules/installs/contract';
import { InstallColorSwatch, InstallPlatformIcon } from '@/modules/installs/renderer/install-identity';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { questInstallId } from '@/modules/quest/contract';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import type { Target, TargetId } from '@/modules/targets/contract';
import type { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';
import { useTargetName } from '@/modules/targets/renderer/use-targets';

export const sidebarItemClassName =
   'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 cursor-default items-center justify-center gap-3 rounded-md px-0 text-sm font-medium transition-colors sm:justify-start sm:px-3';
const activeSidebarRowClassName =
   'has-[[data-status=active]]:bg-primary has-[[data-status=active]]:text-primary-foreground has-[[data-status=active]]:hover:bg-primary has-[[data-status=active]]:hover:text-primary-foreground';

export function SidebarTargets({ targetList }: { targetList: ReturnType<typeof useSelectedTarget> }) {
   const t = useTranslations('targets');
   const common = useTranslations('common');
   const { status, reload } = targetList;
   const unreachable = new Set(
      targetList.targets.filter((target) => target.kind === 'remote' && target.status !== 'ready').map((target) => target.name)
   );
   const targets = targetList.targets.filter(
      (target) =>
         !(target.kind === 'quest' && target.status !== 'ready' && target.connection === 'remote' && target.via && unreachable.has(target.via))
   );
   const twins = useInstallTwins(targets);

   if (status === 'loading') {
      return (
         <div className="flex flex-col gap-1">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
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
            <SidebarTargetSection key={target.id} target={target} showName={targets.length > 1} twins={twins} />
         ))}
      </div>
   );
}

type InstallTwins = { hidden: Set<string>; alsoOn: Map<string, string[]> };

const twinKey = (targetId: TargetId, installId: string) => `${targetId}/${installId}`;

function useInstallTwins(targets: Target[]): InstallTwins {
   const combine = useSettings().snapshot?.app.combineInstalls ?? false;
   const pcs = combine ? targets.filter((target) => target.kind !== 'quest' && target.status === 'ready') : [];
   const listed = useQueries({ queries: pcs.map((pc) => installListQueryOptions(pc.id)) });
   const hidden = new Set<string>();
   const alsoOn = new Map<string, string[]>();
   const firstByVersion = new Map<string, { targetId: TargetId; key: string }>();
   const folded = new Set<string>();

   pcs.forEach((pc, index) => {
      for (const install of listed[index]?.data?.installs ?? []) {
         if (!install.version) continue;
         const first = firstByVersion.get(install.version);
         if (!first) {
            firstByVersion.set(install.version, { targetId: pc.id, key: twinKey(pc.id, install.id) });
            continue;
         }
         if (first.targetId === pc.id || folded.has(`${pc.id}/${install.version}`)) continue;
         folded.add(`${pc.id}/${install.version}`);
         hidden.add(twinKey(pc.id, install.id));
         alsoOn.set(first.key, [...new Set([...(alsoOn.get(first.key) ?? []), pc.name])]);
      }
   });

   return { hidden, alsoOn };
}

function SidebarTargetSection({ target, showName, twins }: { target: Target; showName: boolean; twins: InstallTwins }) {
   const t = useTranslations('targets');
   const TargetIcon = target.kind === 'remote' ? Wifi : target.kind === 'quest' ? QuestIcon : Monitor;
   const name = useTargetName()(target);
   const installs = useInstalls(target.id);
   const reconnecting = target.kind !== 'remote' && target.status === 'disconnected' && (installs.snapshot?.installs.length ?? 0) > 0;

   if (target.status !== 'ready' && !reconnecting && target.kind === 'quest') {
      return (
         <AppLink
            to="/installs/$installId"
            params={{ installId: questInstallId }}
            search={{ targetId: target.id }}
            draggable={false}
            aria-label={name}
            className={cn(sidebarItemClassName, 'data-[status=active]:bg-accent data-[status=active]:text-accent-foreground')}
         >
            <TargetIcon className="size-4 shrink-0 opacity-60" />
            <span className="hidden min-w-0 flex-1 truncate sm:block">{name}</span>
            <span className="hidden shrink-0 text-xs sm:block">{t(`status.${target.status}`)}</span>
         </AppLink>
      );
   }

   if (target.status !== 'ready' && !reconnecting) {
      return (
         <div
            className="text-muted-foreground flex h-10 items-center justify-center gap-3 rounded-md px-0 text-sm font-medium sm:justify-start sm:px-3"
            aria-label={name}
         >
            <TargetIcon className="size-4 shrink-0" />
            <span className="hidden min-w-0 flex-1 truncate sm:block">{name}</span>
            <span className="hidden shrink-0 text-xs sm:block">{t(`status.${target.status}`)}</span>
         </div>
      );
   }

   const shown = (installs.snapshot?.installs ?? []).filter((install) => !twins.hidden.has(twinKey(target.id, install.id)));
   if ((installs.loadStatus === 'ready' || installs.loadStatus === 'unsupported') && shown.length === 0) return null;

   return (
      <div className="flex flex-col gap-1">
         {showName || reconnecting ? (
            <div className="text-muted-foreground hidden items-center gap-2 px-3 text-xs font-medium sm:flex" aria-label={name}>
               <span className="min-w-0 flex-1 truncate">{name}</span>
               {reconnecting ? <span className="shrink-0">{t(`status.${target.status}`)}</span> : null}
            </div>
         ) : null}
         <SidebarInstalls
            targetId={target.id}
            installs={installs}
            twins={twins}
            canOrganise={target.capabilities.includes('manage-installs')}
            quest={target.kind === 'quest'}
         />
      </div>
   );
}

function SidebarInstalls({
   targetId,
   installs,
   twins,
   canOrganise,
   quest
}: {
   targetId: TargetId;
   installs: ReturnType<typeof useInstalls>;
   twins: InstallTwins;
   canOrganise: boolean;
   quest: boolean;
}) {
   const t = useTranslations('targets');
   const common = useTranslations('common');
   const [draggedInstallId, setDraggedInstallId] = useState<string | null>(null);

   if (installs.loadStatus === 'loading') {
      return <Skeleton className="h-10" />;
   }

   if (installs.loadStatus === 'error') {
      return (
         <div className="flex flex-col items-stretch gap-2 sm:px-3">
            <span className="hidden text-xs sm:block">{t('loadError')}</span>
            <RefreshButton label={common('retry')} onClick={installs.reload} />
         </div>
      );
   }

   const visible = (installs.snapshot?.installs ?? []).filter((install) => !twins.hidden.has(twinKey(targetId, install.id)));
   const pinned = visible.filter((install) => install.pinned);
   const ordered = [...pinned, ...visible.filter((install) => !install.pinned)];

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
         alsoOn={twins.alsoOn.get(twinKey(targetId, install.id)) ?? []}
         canOrganise={canOrganise}
         quest={quest}
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
   alsoOn,
   canOrganise,
   quest,
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
   alsoOn: string[];
   canOrganise: boolean;
   quest: boolean;
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
         <AppLink
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
            <InstallPlatformIcon store={install.store} quest={quest} />
            <span className="hidden min-w-0 flex-1 truncate sm:block">
               {install.name}
               {alsoOn.length > 0 ? <span className="ml-1.5 text-xs font-normal opacity-60">{t('alsoOn', { names: alsoOn.join(', ') })}</span> : null}
            </span>
         </AppLink>

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
