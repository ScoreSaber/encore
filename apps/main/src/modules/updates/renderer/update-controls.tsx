import { useState } from 'react';

import { Check, Download, RefreshCw, RotateCw } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ConfirmDialog } from '@/components/dialog/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import { SettingsRow } from '@/modules/settings/renderer/settings-layout';
import { localTargetId } from '@/modules/targets/contract';
import type { UpdateState } from '@/modules/updates/contract';
import { useUpdate } from '@/modules/updates/renderer/use-update';

const progressRadius = 10;
const progressCircumference = 2 * Math.PI * progressRadius;

export function SidebarUpdateButton() {
   const describe = useUpdateDescription();
   const update = useUpdate(localTargetId);
   const [confirmOpen, setConfirmOpen] = useState(false);
   const { state, action } = update;
   const checking = update.pendingMethod === 'check' || state?.status === 'checking';
   const disabled = action === 'none' || update.pending || state?.status === 'checking';
   const dialogOpen = confirmOpen && state?.status === 'downloaded';

   return (
      <>
         <Tooltip>
            <TooltipTrigger asChild>
               <button
                  type="button"
                  aria-label={describe(state)}
                  aria-disabled={disabled || undefined}
                  className={cn(
                     'window-no-drag focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2',
                     action === 'install' || action === 'download' || action === 'open-release' || state?.status === 'downloading'
                        ? 'bg-secondary text-foreground hover:bg-accent'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                     disabled && 'hover:text-muted-foreground cursor-not-allowed hover:bg-transparent',
                     state?.status === 'disabled' && 'opacity-60'
                  )}
                  onClick={() => {
                     if (disabled) return;
                     if (action === 'install') setConfirmOpen(true);
                     else if (action === 'open-release') update.openRelease(state?.availableVersion ?? null);
                     else update.run(action);
                  }}
               >
                  <UpdateStatusIcon state={state} checking={checking} />
               </button>
            </TooltipTrigger>
            <TooltipContent side="right">{describe(state)}</TooltipContent>
         </Tooltip>

         <InstallUpdateDialog
            open={dialogOpen}
            version={state?.downloadedVersion ?? null}
            onOpenChange={setConfirmOpen}
            onConfirm={() => {
               setConfirmOpen(false);
               update.run('install');
            }}
         />
      </>
   );
}

export function UpdateVersionRow() {
   const t = useTranslations('updates');
   const describe = useUpdateDescription();
   const update = useUpdate(localTargetId);
   const [confirmOpen, setConfirmOpen] = useState(false);
   const { state, action } = update;
   const dialogOpen = confirmOpen && state?.status === 'downloaded';
   const label =
      action === 'install'
         ? t('version.install')
         : action === 'download'
           ? t('version.download')
           : action === 'open-release'
             ? t('version.openRelease')
             : state?.status === 'checking'
               ? t('version.checking')
               : state?.status === 'downloading'
                 ? t('version.downloading', { percent: state.downloadPercent ?? 0 })
                 : state?.status === 'up-to-date'
                   ? t('version.upToDate')
                   : t('version.check');

   return (
      <SettingsRow
         title={
            <span className="inline-flex items-baseline gap-2">
               {t('version.title')}
               {state ? <code className="text-muted-foreground text-xs font-medium">{state.currentVersion}</code> : null}
            </span>
         }
         description={describe(state)}
         control={
            <Button
               type="button"
               variant={action === 'install' || action === 'download' ? 'default' : 'outline'}
               size="sm"
               disabled={action === 'none' || update.pending || state?.status === 'checking'}
               onClick={() => {
                  if (action === 'install') setConfirmOpen(true);
                  else if (action === 'open-release') update.openRelease(state?.availableVersion ?? null);
                  else if (action !== 'none') update.run(action);
               }}
            >
               {label}
            </Button>
         }
      >
         <InstallUpdateDialog
            open={dialogOpen}
            version={state?.downloadedVersion ?? null}
            onOpenChange={setConfirmOpen}
            onConfirm={() => {
               setConfirmOpen(false);
               update.run('install');
            }}
         />
      </SettingsRow>
   );
}

function InstallUpdateDialog({
   open,
   version,
   onOpenChange,
   onConfirm
}: {
   open: boolean;
   version: string | null;
   onOpenChange: (open: boolean) => void;
   onConfirm: () => void;
}) {
   const t = useTranslations('updates.install');

   return (
      <ConfirmDialog
         open={open}
         title={t('title')}
         description={t('description', { version: version ?? '' })}
         confirmLabel={t('confirm')}
         confirmVariant="default"
         onOpenChange={onOpenChange}
         onConfirm={onConfirm}
      />
   );
}

function useUpdateDescription() {
   const t = useTranslations('updates');

   return (state: UpdateState | null) => {
      if (!state) return t('check');
      if (state.status === 'disabled') return t(`disabled.${state.disabledReason ?? 'development'}`);
      if (state.status === 'checking') return t('checking');
      if (state.status === 'downloading') return t('downloading', { percent: state.downloadPercent ?? 0 });
      if (state.status === 'downloaded') {
         return state.errorContext === 'install'
            ? t('installFailed', { version: state.downloadedVersion ?? '' })
            : t('downloaded', { version: state.downloadedVersion ?? '' });
      }
      if (state.status === 'available') {
         if (state.errorContext === 'download') return t('downloadFailed', { version: state.availableVersion ?? '' });
         return t(state.selfUpdates ? 'available' : 'availableManual', { version: state.availableVersion ?? '' });
      }
      if (state.status === 'error') return t('checkFailed');
      if (state.status === 'up-to-date') return t('upToDate');

      return t('check');
   };
}

function UpdateStatusIcon({ state, checking }: { state: UpdateState | null; checking: boolean }) {
   if (state?.status === 'available') {
      return (
         <span className="relative grid size-3.5 place-items-center">
            <Download className="size-3.5" />
            <span aria-hidden="true" className="ring-secondary absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current ring-2" />
         </span>
      );
   }

   if (state?.status === 'downloading') {
      const offset = progressCircumference * (1 - Math.min(100, Math.max(0, state.downloadPercent ?? 0)) / 100);

      return (
         <span className="relative grid size-6 place-items-center">
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 24 24">
               <circle cx="12" cy="12" r={progressRadius} fill="none" className="stroke-current/20" strokeWidth="1.5" />
               <circle
                  cx="12"
                  cy="12"
                  r={progressRadius}
                  fill="none"
                  stroke="currentColor"
                  strokeDasharray={progressCircumference}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  strokeWidth="1.5"
                  className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
               />
            </svg>
            <Download className="size-3" />
         </span>
      );
   }

   if (state?.status === 'downloaded') {
      return (
         <span className="relative grid size-3.5 place-items-center">
            <RotateCw className="size-3.5" />
            <span className="bg-foreground text-background ring-secondary absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full ring-2">
               <Check className="size-2" strokeWidth={3} />
            </span>
         </span>
      );
   }

   return <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />;
}
