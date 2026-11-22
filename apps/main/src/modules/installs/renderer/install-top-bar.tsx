import { Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Collapsible } from '@/components/ui/collapsible';

import type { InstallDetail } from '@/modules/installs/contract';
import { InstallColorSwatch, InstallPlatformIcon } from '@/modules/installs/renderer/install-identity';
import { InstallProblemRow, InstallStatusBadge } from '@/modules/installs/renderer/install-labels';
import { LaunchChoice, type LaunchDestinations } from '@/modules/launch/renderer/launch-choice';
import {
   LaunchAdvanced,
   LaunchAdvancedTrigger,
   LaunchNotices,
   LaunchOptions,
   LaunchProgress,
   LaunchProton
} from '@/modules/launch/renderer/launch-controls';
import type { InstallLaunch } from '@/modules/launch/renderer/use-install-launch';

export function InstallTopBar({
   detail,
   quest,
   launch,
   destinations,
   onEdit,
   onSync,
   copyHint,
   actions,
   summary,
   tabs
}: {
   detail: InstallDetail;
   quest: boolean;
   launch: InstallLaunch;
   destinations: LaunchDestinations;
   onEdit?: () => void;
   onSync?: { label: string; onSelect: () => void };
   copyHint?: { onCopy: () => void; onDismiss: () => void };
   actions: React.ReactNode;
   summary?: string;
   tabs: React.ReactNode;
}) {
   const t = useTranslations('installs.manage.edit');
   const launchCopy = useTranslations('launch.choice');
   const copyCopy = useTranslations('installs.mirror');
   const common = useTranslations('common');
   const elsewhere = destinations?.elsewhere ?? null;

   return (
      <div className="relative flex shrink-0 flex-col gap-3 border-b px-4 pt-4 pb-1.5 sm:px-8">
         <Collapsible className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
               <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex min-w-0 items-center gap-2">
                     {onEdit ? (
                        <InstallColorSwatch color={detail.color} label={t('changeColor')} onClick={onEdit} />
                     ) : (
                        <InstallColorSwatch color={detail.color} />
                     )}
                     <InstallPlatformIcon store={detail.store} quest={quest} />
                     <h1 className="min-w-0 text-lg leading-tight font-semibold">
                        {onEdit ? (
                           <button
                              type="button"
                              className="block max-w-full cursor-pointer truncate text-left"
                              aria-label={t('title')}
                              onClick={onEdit}
                           >
                              {detail.name}
                           </button>
                        ) : (
                           <span className="block truncate">{detail.name}</span>
                        )}
                     </h1>
                     <InstallStatusBadge install={detail} />
                  </div>
               </div>

               <div className="flex shrink-0 items-center gap-1">
                  {launch.platform !== 'quest' ? <LaunchAdvancedTrigger /> : null}
                  {onSync ? (
                     <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={onSync.onSelect}>
                        <RefreshCw data-icon="inline-start" />
                        {onSync.label}
                     </Button>
                  ) : null}
                  {actions}
               </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
               <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-2">
                  {summary ? (
                     <span className="text-muted-foreground truncate text-sm">{summary}</span>
                  ) : (
                     <>
                        {elsewhere ? (
                           <span className="text-muted-foreground text-xs font-medium">
                              {launchCopy('optionsOn', { name: elsewhere.target.name })}
                           </span>
                        ) : null}
                        <LaunchOptions launch={launch} />
                     </>
                  )}
               </div>

               <LaunchChoice launch={launch} destinations={destinations} />
            </div>

            {launch.platform !== 'quest' ? <LaunchAdvanced launch={launch} /> : null}
         </Collapsible>

         {copyHint ? (
            <div className="bg-primary/5 border-primary/30 flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center">
               <p className="min-w-0 flex-1">{copyCopy('hint', { version: detail.version ?? detail.name })}</p>
               <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={copyHint.onDismiss}>
                     {common('notNow')}
                  </Button>
                  <Button type="button" size="sm" onClick={copyHint.onCopy}>
                     <Copy data-icon="inline-start" />
                     {copyCopy('toFrame')}
                  </Button>
               </div>
            </div>
         ) : null}
         <LaunchProton launch={launch} when="missing" />
         <LaunchNotices launch={launch} />
         {detail.problem ? <InstallProblemRow problem={detail.problem} /> : null}

         {tabs}
         <LaunchProgress launch={launch} />
      </div>
   );
}
