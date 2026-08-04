import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';

import { ModRepositoriesFields } from '@/modules/settings/renderer/mod-repositories-section';

export function ManageModSourcesDialog({
   open,
   onOpenChange,
   onChanged
}: {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onChanged: () => void;
}) {
   const t = useTranslations('mods.sources.manage');
   const common = useTranslations('common');

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {open ? (
               <FieldGroup className="min-h-0 gap-0 overflow-y-auto pr-2">
                  <ModRepositoriesFields onChanged={onChanged} />
               </FieldGroup>
            ) : null}

            <DialogFooter>
               <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                  {common('close')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
