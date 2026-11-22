import { useEffect, useEffectEvent, useRef } from 'react';

import { useQueries } from '@tanstack/react-query';
import { Cast, ChevronDown, Copy, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import { LaunchAction } from '@/modules/launch/renderer/launch-controls';
import type { InstallLaunch } from '@/modules/launch/renderer/use-install-launch';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { localTargetId, runsOnSteamFrame, type Target } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type Destination = { target: Target; installId: string; streams: boolean };
type Menu = { destinations: Destination[]; selected: string; onSelect: (targetId: string) => void; onMirror?: () => void };

export type LaunchDestinations = ReturnType<typeof useLaunchDestinations>;

export function useLaunchDestinations(input: { launch: InstallLaunch; installId: string; version: string | null; onMirror?: () => void }) {
   const { launch, installId, version, onMirror } = input;
   const { targets } = useTargets();
   const settings = useSettings();
   const frame = runsOnSteamFrame(targets);
   const here = targets.find((target) => target.id === launch.targetId);
   const pcs =
      launch.platform === 'quest' || !version
         ? []
         : targets.filter(
              (target) =>
                 target.id !== launch.targetId &&
                 target.kind !== 'quest' &&
                 target.status === 'ready' &&
                 target.capabilities.includes('launch-install')
           );
   const listed = useQueries({ queries: pcs.map((pc) => installListQueryOptions(pc.id)) });
   const twins = pcs.flatMap((pc, index) => {
      const install = (listed[index]?.data?.installs ?? []).find((candidate) => candidate.version === version && candidate.status === 'ready');
      return install ? [{ target: pc, installId: install.id, streams: frame && pc.id !== localTargetId }] : [];
   });
   const current: Destination | null = here ? { target: here, installId, streams: frame && here.id !== localTargetId } : null;
   const mirror = twins.some((twin) => twin.target.id === localTargetId) ? undefined : onMirror;

   if (!current || !version || launch.platform === 'quest' || (twins.length === 0 && !current.streams && !mirror)) return null;

   const launchVia = settings.snapshot?.app.launchVia ?? {};
   const chosen = twins.find((twin) => twin.target.id === launchVia[version]) ?? current;
   const menu: Menu = {
      destinations: [current, ...twins],
      selected: chosen.target.id,
      onSelect: (targetId) => void settings.updateApp({ launchVia: { ...launchVia, [version]: targetId } }),
      onMirror: mirror
   };
   return { frame, current, chosen, elsewhere: chosen !== current ? chosen : null, menu };
}

export function LaunchChoice({ launch, destinations }: { launch: InstallLaunch; destinations: LaunchDestinations }) {
   if (!destinations) return <LaunchAction launch={launch} />;
   return <ChosenLaunch launch={launch} destination={destinations.chosen} frame={destinations.frame} menu={destinations.menu} />;
}

function ChosenLaunch({ launch, destination, frame, menu }: { launch: InstallLaunch; destination: Destination; frame: boolean; menu: Menu }) {
   const t = useTranslations('launch.choice');
   const common = useTranslations('common');
   const local = destination.target.id === localTargetId;
   const name = destination.target.name;
   const completedId = !local && launch.operation?.status === 'completed' ? launch.operation.id : null;
   const notifiedId = useRef<string | null>(null);
   const notifyStarted = useEffectEvent(() => toast.success(t(destination.streams ? 'streamStarted' : 'started', { name })));

   useEffect(() => {
      if (!completedId || notifiedId.current === completedId) return;

      notifiedId.current = completedId;
      notifyStarted();
   }, [completedId]);

   const Icon = launch.launching ? Loader2 : destination.streams ? Cast : Play;
   const label = launch.launching
      ? local
         ? t('starting')
         : t('startingOn', { name })
      : destination.streams
        ? t('streamAction')
        : local
          ? frame
             ? t('standaloneAction')
             : t('action')
          : t('on', { name });

   return (
      <div className="flex shrink-0 items-center gap-2">
         {launch.launching ? (
            <Button type="button" variant="outline" size="sm" disabled={launch.starting} onClick={launch.cancel}>
               {common('cancel')}
            </Button>
         ) : null}
         <div className="shadow-primary/20 flex shrink-0 rounded-md shadow-lg">
            <Button
               type="button"
               size="lg"
               className="min-w-52 cursor-pointer gap-2.5 rounded-r-none font-semibold"
               disabled={!launch.canLaunch}
               onClick={launch.launch}
            >
               <Icon />
               {label}
            </Button>
            <ChoiceMenu menu={menu} frame={frame} disabled={launch.launching} />
         </div>
      </div>
   );
}

function ChoiceMenu({ menu, frame, disabled }: { menu: Menu; frame: boolean; disabled: boolean }) {
   const t = useTranslations('launch.choice');
   const describe = (destination: Destination) =>
      destination.target.id === localTargetId
         ? frame
            ? t('standalone')
            : t('here')
         : destination.streams
           ? t('stream', { name: destination.target.name })
           : t('on', { name: destination.target.name });

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button
               type="button"
               size="lg"
               className="border-primary-foreground/20 cursor-pointer rounded-l-none border-l px-2.5"
               disabled={disabled}
               aria-label={t('menu')}
            >
               <ChevronDown />
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={menu.selected} onValueChange={menu.onSelect}>
               {menu.destinations.map((destination) => {
                  const Icon = destination.streams ? Cast : Play;
                  return (
                     <DropdownMenuRadioItem key={destination.target.id} value={destination.target.id} className="cursor-pointer">
                        <Icon />
                        {describe(destination)}
                     </DropdownMenuRadioItem>
                  );
               })}
            </DropdownMenuRadioGroup>
            {menu.onMirror ? (
               <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer" onSelect={menu.onMirror}>
                     <Copy />
                     {t('copyToFrame')}
                  </DropdownMenuItem>
               </>
            ) : null}
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
