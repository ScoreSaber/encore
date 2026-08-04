import { useState } from 'react';

import { FolderOpen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

import type { InstallRootIssue, InstallRootValidation } from '@/modules/installs/contract';
import { useSettings } from '@/modules/settings/renderer/settings-provider';

type PendingRootChange = {
   currentRoot: string;
   currentInstallCount: number;
   selected: InstallRootValidation;
};

export function LibraryRootField({ disabled, onChange }: { disabled: boolean; onChange: () => void }) {
   const t = useTranslations('downloads.library');
   const common = useTranslations('common');
   const settings = useSettings();
   const [pending, setPending] = useState<PendingRootChange | null>(null);
   const [issue, setIssue] = useState<InstallRootIssue | null>(null);
   const installRoot = settings.snapshot?.library.installRoot;

   if (!installRoot) return null;

   async function pickRoot() {
      setIssue(null);
      const choice = await window.encore.settings.chooseInstallRoot();
      if (choice.status === 'cancelled') return;

      if (choice.selected.status === 'invalid') {
         setIssue(choice.selected.issue ?? 'inspect-failed');
         return;
      }

      setPending({ currentRoot: choice.currentRoot, currentInstallCount: choice.currentInstallCount, selected: choice.selected });
   }

   async function confirmRoot() {
      if (!pending) return;

      const saved = await settings.updateLibrary({ installRoot: pending.selected.path });
      if (!saved.ok) return;

      setPending(null);
      onChange();
   }

   return (
      <div className="flex flex-col gap-2">
         <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
               <div className="font-medium">{t('label')}</div>
               <div className="text-muted-foreground break-all">{issue ? t(`rootIssue.${issue}`) : installRoot}</div>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={disabled} onClick={() => void pickRoot()}>
               <FolderOpen data-icon="inline-start" />
               {t('change')}
            </Button>
         </div>

         {pending ? (
            <div className="flex flex-col gap-3 rounded-md border px-3 py-2 text-xs">
               <p className="text-muted-foreground">{t('rootChange.description')}</p>
               <div className="min-w-0">
                  <div className="font-medium">{t('rootChange.currentRoot')}</div>
                  <div className="text-muted-foreground break-all">{pending.currentRoot}</div>
                  <div className="text-muted-foreground">{t('rootChange.staying', { count: pending.currentInstallCount })}</div>
               </div>
               <div className="min-w-0">
                  <div className="font-medium">{t('rootChange.newRoot')}</div>
                  <div className="text-muted-foreground break-all">{pending.selected.path}</div>
                  <div className="text-muted-foreground">{t('rootChange.found', { count: pending.selected.installCount })}</div>
               </div>
               <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPending(null)}>
                     {common('cancel')}
                  </Button>
                  <Button type="button" size="sm" disabled={disabled} onClick={() => void confirmRoot()}>
                     {t('rootChange.confirm')}
                  </Button>
               </div>
            </div>
         ) : null}
      </div>
   );
}
