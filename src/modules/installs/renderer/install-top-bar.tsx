import { Collapsible } from '@/components/ui/collapsible';

import type { InstallDetail } from '@/modules/installs/contract';
import { InstallProblemRow, InstallStatusBadge } from '@/modules/installs/renderer/install-labels';
import {
   LaunchAction,
   LaunchAdvanced,
   LaunchAdvancedTrigger,
   LaunchFacets,
   LaunchNotices,
   LaunchOptions,
   LaunchProgress
} from '@/modules/launch/renderer/launch-controls';
import type { InstallLaunch } from '@/modules/launch/renderer/use-install-launch';

export function InstallTopBar({
   detail,
   launch,
   actions,
   tabs
}: {
   detail: InstallDetail;
   launch: InstallLaunch;
   actions: React.ReactNode;
   tabs: React.ReactNode;
}) {
   return (
      <div className="relative flex shrink-0 flex-col gap-3 border-b px-8 pt-4 pb-1.5">
         <Collapsible className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
               <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                     {detail.color ? <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: detail.color }} /> : null}
                     <h1 className="truncate text-lg leading-tight font-semibold">{detail.name}</h1>
                     <InstallStatusBadge install={detail} />
                  </div>

                  <LaunchFacets launch={launch} name={detail.name} />
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

         <LaunchNotices launch={launch} />
         {detail.problem ? <InstallProblemRow problem={detail.problem} /> : null}

         {tabs}
         <LaunchProgress launch={launch} />
      </div>
   );
}
