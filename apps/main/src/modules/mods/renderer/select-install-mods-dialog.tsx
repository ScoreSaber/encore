import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { InstallSummary } from '@/modules/installs/contract';
import type { ReadyModsSnapshot } from '@/modules/mods/contract';
import { modListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import type { TargetId } from '@/modules/targets/contract';

export function SelectInstallModsDialog({
   open,
   targetId,
   installs,
   currentMods,
   onOpenChange,
   onSelect
}: {
   open: boolean;
   targetId: TargetId;
   installs: InstallSummary[];
   currentMods: ReadyModsSnapshot['mods'];
   onOpenChange: (open: boolean) => void;
   onSelect: (modIds: string[]) => void;
}) {
   const t = useTranslations('mods.selectFromInstall');
   const common = useTranslations('common');
   const [selectedInstallId, setSelectedInstallId] = useState('');
   const installId = installs.some((install) => install.id === selectedInstallId) ? selectedInstallId : (installs[0]?.id ?? '');
   const request = { targetId, installId };
   const source = useQuery({
      ...modListQueryOptions(request),
      queryFn: () => window.encore.mods.refreshMods(request),
      enabled: open && installId.length > 0,
      staleTime: 0,
      refetchOnMount: 'always'
   });
   const snapshot = source.data?.status === 'ok' && source.data.value.status === 'ready' ? source.data.value : null;
   const installedNames = new Set(
      snapshot ? [...snapshot.mods.filter((mod) => mod.state !== 'available'), ...snapshot.external].map((mod) => mod.name.trim().toLowerCase()) : []
   );
   const matches = currentMods.filter((mod) => installedNames.has(mod.name.trim().toLowerCase())).map((mod) => mod.modId);
   const failed = source.isError || (source.data !== undefined && source.data.status !== 'ok') || (source.data?.status === 'ok' && !snapshot);

   function applySelection() {
      onSelect(matches);
      onOpenChange(false);
   }

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               <div className="flex flex-col gap-2">
                  <Label htmlFor="mods-source-install">{t('install')}</Label>
                  <Select value={installId} onValueChange={setSelectedInstallId}>
                     <SelectTrigger id="mods-source-install">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectGroup>
                           {installs.map((install) => (
                              <SelectItem key={install.id} value={install.id}>
                                 {install.name}
                              </SelectItem>
                           ))}
                        </SelectGroup>
                     </SelectContent>
                  </Select>
               </div>

               {source.isPending || source.isFetching ? <p className="text-muted-foreground">{common('loading')}</p> : null}
               {failed ? <p>{t('loadError')}</p> : null}
               {snapshot && !source.isFetching ? <p>{t('matchSummary', { count: matches.length })}</p> : null}
            </div>

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  {common('cancel')}
               </Button>
               <Button type="button" size="sm" disabled={matches.length === 0 || source.isFetching} onClick={applySelection}>
                  {t('confirm')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
