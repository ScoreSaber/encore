import { useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Trash2, Unplug, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { QuestIcon } from '@/components/headset-icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

import { useHeadsetStatus } from '@/modules/quest/renderer/quest-headset-status';
import { QuestSetupDialog } from '@/modules/quest/renderer/quest-setup';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import type { Target } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapIpc } from '@/renderer/ipc-result';

type HeadsetAction = { owner: string; run: () => Promise<string | null> };

export function QuestStandaloneSection() {
   const t = useTranslations('quest');
   const { targets, reload } = useTargets();
   const [setupOpen, setSetupOpen] = useState(false);
   const headsets = targets.filter((target) => target.kind === 'quest');
   const connected = headsets.find((headset) => headset.status === 'ready' && headset.connection !== 'remote') ?? null;
   const desktop = window.encore.runtime === 'desktop';
   const headsetStatus = useHeadsetStatus();
   const action = useMutation({
      mutationFn: ({ run }: HeadsetAction) => run(),
      onSuccess: reload
   });
   const busy = action.isPending;

   function notice(owner: HeadsetAction['owner']) {
      if (action.variables?.owner !== owner) return null;
      if (action.error) return <span className="text-destructive">{action.error.message}</span>;

      return action.data ?? null;
   }

   return (
      <>
         <SettingsSection
            title={t('headsets')}
            headerAction={
               desktop ? (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setSetupOpen(true)}>
                     <Plus />
                     {t('setup.open')}
                  </Button>
               ) : null
            }
         >
            {headsets.length === 0 ? (
               <Empty className="min-h-52">
                  <EmptyHeader>
                     <EmptyMedia variant="icon">
                        <QuestIcon />
                     </EmptyMedia>
                     <EmptyTitle>{t('empty.title')}</EmptyTitle>
                     <EmptyDescription>{t('empty.description')}</EmptyDescription>
                  </EmptyHeader>
               </Empty>
            ) : (
               headsets.map((headset) => (
                  <SettingsRow
                     key={headset.id}
                     title={headset.name}
                     description={headsetStatus(headset)}
                     status={notice(headset.id)}
                     control={desktop && headset.connection !== 'remote' ? <HeadsetMenu headset={headset} busy={busy} onRun={action.mutate} /> : null}
                  />
               ))
            )}
         </SettingsSection>

         {desktop ? (
            <SettingsSection title={t('companion.title')}>
               <SettingsRow
                  title={t('companion.row')}
                  description={t('companion.description')}
                  status={notice('companion')}
                  control={
                     <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!connected || busy}
                        onClick={() => {
                           if (!connected) return;
                           action.mutate({
                              owner: 'companion',
                              run: async () => {
                                 unwrapIpc(await window.encore.quest.installCompanion({ targetId: connected.id }));
                                 return t('installed');
                              }
                           });
                        }}
                     >
                        {t(busy && action.variables.owner === 'companion' ? 'installingApp' : 'installApp')}
                     </Button>
                  }
               />
            </SettingsSection>
         ) : null}

         <QuestSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
      </>
   );
}

function HeadsetMenu({ headset, busy, onRun }: { headset: Target; busy: boolean; onRun: (action: HeadsetAction) => void }) {
   const t = useTranslations('quest');
   const common = useTranslations('common');
   const address = headset.address;

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={common('more')} disabled={busy}>
               <MoreHorizontal />
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end">
            {headset.status !== 'ready' ? null : address ? (
               <DropdownMenuItem
                  onSelect={() =>
                     onRun({
                        owner: headset.id,
                        run: async () => {
                           unwrapIpc(await window.encore.quest.disconnectWireless({ targetId: headset.id }));
                           return null;
                        }
                     })
                  }
               >
                  <Unplug />
                  {t('disconnect')}
               </DropdownMenuItem>
            ) : (
               <DropdownMenuItem
                  onSelect={() =>
                     onRun({
                        owner: headset.id,
                        run: async () => {
                           const enabled = unwrapIpc(await window.encore.quest.enableWireless({ targetId: headset.id, port: 5555 }));
                           return t('wirelessReady', { endpoint: enabled.endpoint });
                        }
                     })
                  }
               >
                  <Wifi />
                  {t('enableWireless')}
               </DropdownMenuItem>
            )}
            {headset.status === 'ready' ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
               onSelect={() =>
                  onRun({
                     owner: headset.id,
                     run: async () => {
                        unwrapIpc(await window.encore.quest.forgetHeadset({ targetId: headset.id }));
                        return null;
                     }
                  })
               }
            >
               <Trash2 />
               {t('forget')}
            </DropdownMenuItem>
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
