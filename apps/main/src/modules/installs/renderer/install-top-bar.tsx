import { useTranslations } from 'use-intl';

import { Collapsible } from '@/components/ui/collapsible';

import type { InstallDetail } from '@/modules/installs/contract';
import { InstallColorSwatch, InstallPlatformIcon } from '@/modules/installs/renderer/install-identity';
import { InstallProblemRow, InstallStatusBadge } from '@/modules/installs/renderer/install-labels';
import {
   LaunchAction,
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
   launch,
   onEdit,
   actions,
   tabs
}: {
   detail: InstallDetail;
   launch: InstallLaunch;
   onEdit?: () => void;
   actions: React.ReactNode;
   tabs: React.ReactNode;
}) {
   const t = useTranslations('installs.manage.edit');

   return (
      <div className="relative flex shrink-0 flex-col gap-3 border-b px-8 pt-4 pb-1.5">
         <Collapsible className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
               <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex min-w-0 items-center gap-2">
                     {onEdit ? (
                        <InstallColorSwatch color={detail.color} label={t('changeColor')} onClick={onEdit} />
                     ) : (
                        <InstallColorSwatch color={detail.color} />
                     )}
                     <InstallPlatformIcon store={detail.store} />
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
                  <LaunchAdvancedTrigger />
                  {actions}
               </div>
            </div>

            <div className="flex items-center gap-4">
               <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <LaunchOptions launch={launch} />
               </div>

               <LaunchAction launch={launch} />
            </div>

            <LaunchAdvanced launch={launch} />
         </Collapsible>

         <LaunchProton launch={launch} />
         <LaunchNotices launch={launch} />
         {detail.problem ? <InstallProblemRow problem={detail.problem} /> : null}

         {tabs}
         <LaunchProgress launch={launch} />
      </div>
   );
}
