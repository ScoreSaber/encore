import { useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';

import type { ProtonIssue } from '@/modules/launch/contract';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { protonStateQueryOptions } from '@/modules/settings/renderer/settings-queries';

export function ProtonFolderField({ disabled, onChange }: { disabled: boolean; onChange: () => void }) {
   const t = useTranslations('launch.proton');
   const common = useTranslations('common');
   const settings = useSettings();
   const queryClient = useQueryClient();
   const proton = useQuery(protonStateQueryOptions);
   const [issue, setIssue] = useState<ProtonIssue | null>(null);

   const state = proton.data ?? null;
   const reload = () => queryClient.invalidateQueries({ queryKey: protonStateQueryOptions.queryKey });

   async function pickFolder() {
      setIssue(null);
      const choice = await window.encore.settings.chooseProtonFolder();
      if (choice.status === 'cancelled') return;

      if (choice.selected.status === 'invalid') {
         setIssue(choice.selected.issue);
         return;
      }

      const saved = await settings.updateLibrary({ protonPath: choice.selected.path });
      if (!saved.ok) return;

      await reload();
      onChange();
   }

   async function clearFolder() {
      setIssue(null);
      const saved = await settings.updateLibrary({ protonPath: null });
      if (!saved.ok) return;

      await reload();
      onChange();
   }

   if (settings.snapshot?.diagnostics.platform !== 'linux') return null;

   return (
      <Field orientation="horizontal" className="items-start gap-6 border-t px-4 py-2.5">
         <FieldContent className="min-w-0">
            <FieldLabel>{t('label')}</FieldLabel>
            <FieldDescription className="break-all">{description()}</FieldDescription>
         </FieldContent>
         <ButtonGroup className="shrink-0" aria-label={t('label')}>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void pickFolder()}>
               <FolderOpen data-icon="inline-start" />
               {t('change')}
            </Button>
            {state?.path ? (
               <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void clearFolder()}>
                  {t('clear')}
               </Button>
            ) : null}
         </ButtonGroup>
      </Field>
   );

   function description() {
      if (issue) return t(`issue.${issue}`);
      if (proton.isError) return t('unavailable');
      if (!state) return common('loading');
      if (!state.path) return t('notSet');
      if (state.validation?.status === 'invalid') return `${state.path} - ${t(`issue.${state.validation.issue}`)}`;
      if (state.nixOs) return `${state.path} - ${t('nixOs')}`;
      if (state.flatpak) return `${state.path} - ${t('flatpak')}`;

      return state.path;
   }
}
