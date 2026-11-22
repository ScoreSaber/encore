import { useState } from 'react';

import { Result } from 'better-result';
import { FolderOpen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

import type { InstallRootIssue, InstallRootValidation } from '@/modules/installs/contract';
import { SettingsRow } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/use-settings';

type PendingRootChange = {
   currentRoot: string;
   currentInstallCount: number;
   selected: Extract<InstallRootValidation, { status: 'ok' }>;
};

type RootFieldState =
   | { status: 'idle'; issue: InstallRootIssue | null }
   | { status: 'picking' }
   | { status: 'confirming'; pending: PendingRootChange; error: string | null }
   | { status: 'saving'; pending: PendingRootChange };

export function InstallRootField({ disabled, className, onChange }: { disabled: boolean; className?: string; onChange?: () => void }) {
   const t = useTranslations('installs.library');
   const common = useTranslations('common');
   const settings = useSettings();
   const [state, setState] = useState<RootFieldState>({ status: 'idle', issue: null });
   const installRoot = settings.snapshot?.library.installRoot;

   if (!installRoot) return null;

   const busy = disabled || settings.saving || state.status === 'picking' || state.status === 'saving';
   const issue = state.status === 'idle' ? state.issue : null;
   const pending = state.status === 'confirming' || state.status === 'saving' ? state.pending : null;

   async function pickRoot() {
      if (busy) return;

      setState({ status: 'picking' });
      const choice = await Result.tryPromise(() => window.encore.settings.chooseInstallRoot());
      if (Result.isError(choice) || choice.value.status === 'cancelled') {
         setState({ status: 'idle', issue: null });
         return;
      }

      if (choice.value.selected.status === 'invalid') {
         setState({ status: 'idle', issue: choice.value.selected.issue });
         return;
      }

      setState({
         status: 'confirming',
         pending: {
            currentRoot: choice.value.currentRoot,
            currentInstallCount: choice.value.currentInstallCount,
            selected: choice.value.selected
         },
         error: null
      });
   }

   async function confirmRoot() {
      if (state.status !== 'confirming' || busy) return;

      const selected = state.pending;
      setState({ status: 'saving', pending: selected });
      const saved = await settings.updateLibrary({ installRoot: selected.selected.path });
      if (!saved.ok) {
         setState({ status: 'confirming', pending: selected, error: saved.error.message });
         return;
      }

      setState({ status: 'idle', issue: null });
      onChange?.();
   }

   return (
      <SettingsRow
         className={className}
         title={t('label')}
         description={
            <>
               {t('description')}
               <span className="mt-1 block break-all">{issue ? t(`rootIssue.${issue}`) : installRoot}</span>
            </>
         }
         control={
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void pickRoot()}>
               <FolderOpen data-icon="inline-start" />
               {t('change')}
            </Button>
         }
      >
         {pending ? (
            <div className="mt-3 flex flex-col gap-3 rounded-md border px-3 py-2 text-xs">
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
               {state.status === 'confirming' && state.error ? <p className="text-destructive break-all">{state.error}</p> : null}
               <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setState({ status: 'idle', issue: null })}>
                     {common('cancel')}
                  </Button>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void confirmRoot()}>
                     {t('rootChange.confirm')}
                  </Button>
               </div>
            </div>
         ) : null}
      </SettingsRow>
   );
}
