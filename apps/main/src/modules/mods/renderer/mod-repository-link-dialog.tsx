import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';

import type { ModRepositoryLinkEvent } from '@/modules/mods/contract';
import { ModRepositoriesFields } from '@/modules/settings/renderer/mod-repositories-section';

export function ModRepositoryLinkDialog() {
   const t = useTranslations('settings.modRepositories.link');
   const mods = window.encore.mods;
   const nextId = useRef(0);
   const [opened, setOpened] = useState<{ id: number; event: ModRepositoryLinkEvent } | null>(null);
   const event = opened?.event ?? null;

   useEffect(() => {
      let active = true;
      const open = (nextEvent: ModRepositoryLinkEvent) => {
         if (!active) return;

         nextId.current += 1;
         setOpened({ id: nextId.current, event: nextEvent });
      };
      const unsubscribe = mods.onRepositoryLinkOpened((nextEvent) => {
         open(nextEvent);
         void mods.takePendingRepositoryLink();
      });

      void mods.takePendingRepositoryLink().then((pending) => {
         if (pending) open(pending);
      });

      return () => {
         active = false;
         unsubscribe();
      };
   }, [mods]);

   function dismiss() {
      setOpened(null);
   }

   return (
      <Dialog open={event !== null} onOpenChange={(open) => !open && dismiss()}>
         <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription className="not-sr-only text-sm leading-normal">{t('description')}</DialogDescription>
            </DialogHeader>

            {event?.status === 'rejected' ? <WarningLine className="text-status-warning">{t('invalid')}</WarningLine> : null}
            {event?.status === 'ready' ? (
               <FieldGroup className="min-h-0 gap-0 overflow-y-auto">
                  <ModRepositoriesFields key={opened?.id} initialUrl={event.url} addOnly reviewOnly onChanged={dismiss} onDraftDismissed={dismiss} />
               </FieldGroup>
            ) : null}
         </DialogContent>
      </Dialog>
   );
}
