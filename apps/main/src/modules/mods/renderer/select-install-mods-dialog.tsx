import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { InstallSummary } from '@/modules/installs/contract';
import type { ReadyModsSnapshot } from '@/modules/mods/contract';
import type { TargetId } from '@/modules/targets/contract';
import { installKey, targetQuery } from '@/renderer/query/api-query';

export type ModSourceInstall = { targetId: TargetId; targetName: string; install: InstallSummary };

const sourceKey = (source: ModSourceInstall) => `${source.targetId}\0${source.install.id}`;

export function SelectInstallModsDialog({
   open,
   sources,
   currentMods,
   onOpenChange,
   onSelect
}: {
   open: boolean;
   sources: ModSourceInstall[];
   currentMods: ReadyModsSnapshot['mods'];
   onOpenChange: (open: boolean) => void;
   onSelect: (modIds: string[]) => void;
}) {
   if (!open) return null;

   return <OpenSelectInstallModsDialog sources={sources} currentMods={currentMods} onOpenChange={onOpenChange} onSelect={onSelect} />;
}

function OpenSelectInstallModsDialog({
   sources,
   currentMods,
   onOpenChange,
   onSelect
}: {
   sources: ModSourceInstall[];
   currentMods: ReadyModsSnapshot['mods'];
   onOpenChange: (open: boolean) => void;
   onSelect: (modIds: string[]) => void;
}) {
   const t = useTranslations('mods.selectFromInstall');
   const common = useTranslations('common');
   const [selectedKey, setSelectedKey] = useState('');
   const chosen = sources.find((candidate) => sourceKey(candidate) === selectedKey) ?? sources[0];
   const request = { targetId: chosen?.targetId ?? '', installId: chosen?.install.id ?? '' };
   const manyDevices = new Set(sources.map((candidate) => candidate.targetId)).size > 1;
   const source = useQuery({
      ...targetQuery(installKey('mods', request, 'refreshMods'), () => window.encore.mods.refreshMods(request)),
      enabled: chosen !== undefined,
      staleTime: 0,
      refetchOnMount: 'always'
   });
   const snapshot = source.data && source.data.status === 'ready' ? source.data : null;
   const installedNames = new Set(
      snapshot ? [...snapshot.mods.filter((mod) => mod.state !== 'available'), ...snapshot.external].map((mod) => mod.name.trim().toLowerCase()) : []
   );
   const matches = currentMods.filter((mod) => installedNames.has(mod.name.trim().toLowerCase())).map((mod) => mod.modId);
   const loading = source.isPending || source.isFetching;
   const status: 'loading' | 'failed' | 'ready' = loading ? 'loading' : source.isError || !snapshot ? 'failed' : 'ready';

   return (
      <Dialog open onOpenChange={onOpenChange}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               <div className="flex flex-col gap-2">
                  <Label htmlFor="mods-source-install">{t('install')}</Label>
                  <Select value={chosen ? sourceKey(chosen) : ''} onValueChange={setSelectedKey}>
                     <SelectTrigger id="mods-source-install">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectGroup>
                           {sources.map((candidate) => (
                              <SelectItem key={sourceKey(candidate)} value={sourceKey(candidate)}>
                                 {manyDevices ? `${candidate.install.name} · ${candidate.targetName}` : candidate.install.name}
                              </SelectItem>
                           ))}
                        </SelectGroup>
                     </SelectContent>
                  </Select>
               </div>

               {status === 'loading' ? <p className="text-muted-foreground">{common('loading')}</p> : null}
               {status === 'failed' ? <p>{t('loadError')}</p> : null}
               {status === 'ready' ? <p>{t('matchSummary', { count: matches.length })}</p> : null}
            </div>

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  {common('cancel')}
               </Button>
               <Button
                  type="button"
                  size="sm"
                  disabled={status !== 'ready' || matches.length === 0}
                  onClick={() => {
                     onSelect(matches);
                     onOpenChange(false);
                  }}
               >
                  {t('confirm')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
