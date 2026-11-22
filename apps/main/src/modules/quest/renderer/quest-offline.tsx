import { useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { QuestIcon } from '@/components/headset-icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import { QuestSetupDialog } from '@/modules/quest/renderer/quest-setup';
import type { Target } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapIpc } from '@/renderer/ipc-result';

export function QuestOffline({ target }: { target: Target }) {
   const t = useTranslations('quest.offline');
   const navigate = useNavigate();
   const { reload } = useTargets();
   const [setupOpen, setSetupOpen] = useState(false);
   const desktop = window.encore.runtime === 'desktop';
   const forget = useMutation({
      mutationFn: async () => unwrapIpc(await window.encore.quest.forgetHeadset({ targetId: target.id })),
      onSuccess: () => {
         void reload();
         void navigate({ to: '/' });
      }
   });
   const refresh = useMutation({
      mutationFn: () => window.encore.quest.refreshHeadsets(),
      onSettled: reload
   });
   const unpaired = target.status === 'unpaired';

   return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
         <Empty className="max-w-md">
            <EmptyHeader>
               <EmptyMedia variant="icon">
                  <QuestIcon />
               </EmptyMedia>
               <EmptyTitle className="flex items-center gap-1.5">
                  {t(unpaired ? 'unpairedTitle' : 'title', { name: target.name })}
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <button
                           type="button"
                           aria-label={t('refresh')}
                           disabled={refresh.isPending}
                           className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:cursor-default disabled:opacity-50"
                           onClick={() => refresh.mutate()}
                        >
                           <RefreshCw className={cn('size-3.5', refresh.isPending && 'animate-spin')} />
                        </button>
                     </TooltipTrigger>
                     <TooltipContent>{t('refresh')}</TooltipContent>
                  </Tooltip>
               </EmptyTitle>
               <EmptyDescription>
                  {unpaired ? t('unpaired') : t('description', { connection: target.connection ?? 'other', via: target.via ?? '' })}
               </EmptyDescription>
            </EmptyHeader>
            {desktop && !unpaired ? (
               <EmptyContent className="flex-row justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSetupOpen(true)}>
                     <Plus data-icon="inline-start" />
                     {t('setup')}
                  </Button>
                  {target.status === 'disconnected' ? (
                     <Button type="button" variant="ghost" size="sm" disabled={forget.isPending} onClick={() => forget.mutate()}>
                        <Trash2 data-icon="inline-start" />
                        {t('forget')}
                     </Button>
                  ) : null}
               </EmptyContent>
            ) : null}
            {forget.error ? <p className="text-destructive text-xs">{forget.error.message}</p> : null}
         </Empty>
         <QuestSetupDialog open={setupOpen} onOpenChange={setSetupOpen} targetId={target.id} />
      </div>
   );
}
