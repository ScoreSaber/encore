import { useEffect, useEffectEvent, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';
import { Download, FolderOpen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

import type { ProtonIssue } from '@/modules/launch/contract';
import { SettingsRow } from '@/modules/settings/renderer/settings-layout';
import { protonStateQueryOptions } from '@/modules/settings/renderer/settings-queries';
import { useSettings } from '@/modules/settings/renderer/use-settings';

type ProtonFieldState = { status: 'idle'; issue: ProtonIssue | null } | { status: 'picking' } | { status: 'clearing' } | { status: 'installing' };

export function ProtonFolderField({
   disabled,
   className,
   when,
   onChange
}: {
   disabled: boolean;
   className?: string;
   when?: 'missing' | 'ready';
   onChange?: () => void;
}) {
   const t = useTranslations('launch.proton');
   const common = useTranslations('common');
   const settings = useSettings();
   const queryClient = useQueryClient();
   const [fieldState, setFieldState] = useState<ProtonFieldState>({ status: 'idle', issue: null });
   const proton = useQuery({ ...protonStateQueryOptions, refetchInterval: fieldState.status === 'installing' ? 3_000 : false });

   const state = proton.data ?? null;
   const missing = state !== null && !state.path && !state.detectedPath;
   const busy = disabled || fieldState.status === 'picking' || fieldState.status === 'clearing';
   const waiting = fieldState.status === 'installing' && missing;
   const changed = useEffectEvent(() => onChange?.());

   useEffect(() => {
      if (fieldState.status === 'installing' && !missing && state !== null) {
         setFieldState({ status: 'idle', issue: null });
         changed();
      }
   }, [fieldState.status, missing, state]);

   async function pickFolder() {
      if (busy) return;

      setFieldState({ status: 'picking' });
      const choice = await Result.tryPromise(() => window.encore.settings.chooseProtonFolder());
      if (Result.isError(choice) || choice.value.status === 'cancelled') {
         setFieldState({ status: 'idle', issue: null });
         return;
      }

      if (choice.value.selected.status === 'invalid') {
         setFieldState({ status: 'idle', issue: choice.value.selected.issue });
         return;
      }

      const saved = await settings.updateLibrary({ protonPath: choice.value.selected.path });
      setFieldState({ status: 'idle', issue: null });
      if (!saved.ok) return;

      await queryClient.invalidateQueries({ queryKey: protonStateQueryOptions.queryKey });
      onChange?.();
   }

   async function installProton() {
      if (busy || waiting) return;

      const started = await Result.tryPromise(() => window.encore.settings.installProton());
      setFieldState(Result.isOk(started) && started.value ? { status: 'installing' } : { status: 'idle', issue: null });
   }

   async function clearFolder() {
      if (busy) return;

      setFieldState({ status: 'clearing' });
      const saved = await settings.updateLibrary({ protonPath: null });
      setFieldState({ status: 'idle', issue: null });
      if (!saved.ok) return;

      await queryClient.invalidateQueries({ queryKey: protonStateQueryOptions.queryKey });
      onChange?.();
   }

   if (settings.snapshot?.diagnostics.platform !== 'linux') return null;
   if ((when === 'missing' && !missing) || (when === 'ready' && (missing || !state))) return null;

   return (
      <SettingsRow
         className={className}
         title={t('label')}
         description={<span className="break-words">{description()}</span>}
         control={
            <>
               {missing ? (
                  <Button type="button" size="sm" disabled={busy || waiting} onClick={() => void installProton()}>
                     <Download data-icon="inline-start" />
                     {t(waiting ? 'installing' : 'install')}
                  </Button>
               ) : null}
               <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void pickFolder()}>
                  <FolderOpen data-icon="inline-start" />
                  {state?.path ? t('change') : t('choose')}
               </Button>
               {state?.path ? (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void clearFolder()}>
                     {t('clear')}
                  </Button>
               ) : null}
            </>
         }
      />
   );

   function description() {
      if (fieldState.status === 'idle' && fieldState.issue) return t(`issue.${fieldState.issue}`);
      if (proton.isError) return t('unavailable');
      if (!state) return common('loading');
      if (!state.path) return state.detectedPath ? t('detected', { path: state.detectedPath }) : t(waiting ? 'installingDetail' : 'notSet');
      if (state.validation?.status === 'invalid') return `${state.path} - ${t(`issue.${state.validation.issue}`)}`;
      if (state.nixOs) return `${state.path} - ${t('nixOs')}`;
      if (state.flatpak) return `${state.path} - ${t('flatpak')}`;

      return state.path;
   }
}
