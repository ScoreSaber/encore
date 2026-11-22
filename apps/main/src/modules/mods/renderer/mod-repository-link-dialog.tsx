import { useMemo, useRef, useState } from 'react';

import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { createProblem } from '@/lib/errors';
import type { ModRepositoryLinkEvent } from '@/modules/mods/contract';
import { ModRepositoriesFields } from '@/modules/settings/renderer/mod-repositories-section';
import { usePendingLinkEvent } from '@/renderer/use-pending-link-event';

const pendingLinkFailure = createProblem('mods.preview-failed');

export function ModRepositoryLinkDialog() {
   const t = useTranslations('settings.modRepositories.link');
   const mods = window.encore.mods;
   const nextId = useRef(0);
   const [opened, setOpened] = useState<{ id: number; event: ModRepositoryLinkEvent } | null>(null);
   const event = opened?.event ?? null;
   const client = useMemo(
      () => ({
         onLinkOpened: (listener: () => void) => mods.onRepositoryLinkOpened(() => listener()),
         takePendingLink: () => mods.takePendingRepositoryLink()
      }),
      [mods]
   );

   usePendingLinkEvent(
      client,
      (nextEvent) => {
         nextId.current += 1;
         setOpened({ id: nextId.current, event: nextEvent });
      },
      () => {
         nextId.current += 1;
         setOpened({ id: nextId.current, event: { status: 'rejected', issue: 'invalid-url' } });
      },
      pendingLinkFailure
   );

   function dismiss() {
      setOpened(null);
   }

   return (
      <Dialog open={event !== null} onOpenChange={(open) => !open && dismiss()}>
         <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription variant="visible">{t('description')}</DialogDescription>
            </DialogHeader>

            {event?.status === 'rejected' ? <WarningLine className="text-status-warning">{t('invalid')}</WarningLine> : null}
            {event?.status === 'ready' ? (
               <div className="min-h-0 overflow-y-auto">
                  <ModRepositoriesFields key={opened?.id} initialUrl={event.url} reviewOnly onChanged={dismiss} onDraftDismissed={dismiss} />
               </div>
            ) : null}
         </DialogContent>
      </Dialog>
   );
}
