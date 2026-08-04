import { useEffect, useState } from 'react';

import { FolderOpen, Plus } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';

export function PlaylistAddDialog({
   open,
   onOpenChange,
   onBrowse,
   onDownload
}: {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onBrowse?: () => void;
   onDownload: (url: string) => void;
}) {
   const t = useTranslations('playlists.add');
   const common = useTranslations('common');
   const [url, setUrl] = useState('');
   const [invalid, setInvalid] = useState(false);

   useEffect(() => {
      if (open) return;

      setUrl('');
      setInvalid(false);
   }, [open]);

   const submit = () => {
      const trimmed = url.trim();
      if (!URL.canParse(trimmed) || new URL(trimmed).protocol !== 'https:') {
         setInvalid(true);
         return;
      }

      onDownload(trimmed);
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t(onBrowse ? 'description' : 'urlDescription')}</DialogDescription>
            </DialogHeader>

            <form
               className="flex flex-col gap-2"
               onSubmit={(event) => {
                  event.preventDefault();
                  submit();
               }}
            >
               <InputGroup>
                  <InputGroupInput
                     value={url}
                     placeholder={t('placeholder')}
                     aria-label={t('placeholder')}
                     aria-invalid={invalid}
                     onChange={(event) => {
                        setUrl(event.target.value);
                        setInvalid(false);
                     }}
                  />
                  <InputGroupAddon align="inline-end">
                     <InputGroupButton type="submit" variant="default" size="icon-sm" aria-label={t('confirm')} disabled={url.trim().length === 0}>
                        <Plus />
                     </InputGroupButton>
                  </InputGroupAddon>
               </InputGroup>
               {invalid ? <p className="text-sm">{t('invalid')}</p> : null}
            </form>

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  {common('cancel')}
               </Button>
               {onBrowse ? (
                  <Button type="button" variant="outline" size="sm" onClick={onBrowse}>
                     <FolderOpen data-icon="inline-start" />
                     {t('browse')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
