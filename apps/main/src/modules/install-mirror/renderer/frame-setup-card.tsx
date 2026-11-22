import { useState } from 'react';

import { useQueries } from '@tanstack/react-query';
import { Cable, Copy } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { AppLink } from '@/components/app-link';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { MirrorDialog, useInstallMirror, type InstallMirror } from '@/modules/install-mirror/renderer/mirror-dialog';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { localTargetId, runsOnSteamFrame } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

const pairHint = 'frame-pair-pc';
const mirrorHint = 'frame-mirror-pc';

export function FrameSetupCard() {
   const mirror = useInstallMirror();

   return (
      <>
         <FrameSetupHint onMirror={mirror.open} />
         <MirrorDialog mirror={mirror} />
      </>
   );
}

export function FrameCopyCard({ pcId }: { pcId: string }) {
   const mirror = useInstallMirror();

   return (
      <>
         <FrameSetupHint onMirror={mirror.open} pcId={pcId} />
         <MirrorDialog mirror={mirror} />
      </>
   );
}

function FrameSetupHint({ onMirror, pcId }: { onMirror: InstallMirror['open']; pcId?: string }) {
   const t = useTranslations('home.frame');
   const common = useTranslations('common');
   const { targets } = useTargets();
   const settings = useSettings();
   const local = useInstalls(localTargetId);
   const [picked, setPicked] = useState<string | null>(null);
   const pcs = targets.filter(
      (target) =>
         target.kind === 'remote' && target.status === 'ready' && target.capabilities.includes('mirror-install') && (!pcId || target.id === pcId)
   );
   const listed = useQueries({ queries: pcs.map((pc) => installListQueryOptions(pc.id)) });
   const sources = pcs.map((pc, index) => ({
      pc,
      installs: (listed[index]?.data?.installs ?? []).filter((install) => install.store === 'steam' && install.version && install.status === 'ready')
   }));
   const options = sources.flatMap(({ pc, installs }) => [
      ...(installs.length > 1
         ? [{ key: `${pc.id}/all`, pc, installIds: installs.map((install) => install.id), label: null, replaceOthers: true }]
         : []),
      ...installs.map((install) => ({
         key: `${pc.id}/${install.id}`,
         pc,
         installIds: [install.id],
         label: install.version ?? install.name,
         replaceOthers: false
      }))
   ]);
   const app = settings.snapshot?.app;
   const dismissed = app?.dismissedHints ?? [];

   if (!app || !runsOnSteamFrame(targets)) return null;

   if (!pcId && !targets.some((target) => target.kind === 'remote')) {
      if (dismissed.includes(pairHint)) return null;
      return (
         <HintCard
            title={t('pairTitle')}
            description={t('pairDescription')}
            onDismiss={() => void settings.updateApp({ dismissedHints: [...dismissed, pairHint] })}
            dismissLabel={common('notNow')}
         >
            <Button asChild size="sm">
               <AppLink to="/settings/remote">
                  <Cable data-icon="inline-start" />
                  {t('pairAction')}
               </AppLink>
            </Button>
         </HintCard>
      );
   }

   const hint = pcId ? `${mirrorHint}/${pcId}` : mirrorHint;
   if ((!pcId && ((local.snapshot?.installs.length ?? 0) > 0 || local.loadStatus === 'loading')) || dismissed.includes(hint)) return null;
   const selected = options.find((option) => option.key === picked) ?? options[0];
   if (!selected) return null;
   const optionLabel = (option: (typeof options)[number]) => {
      const label = option.label ?? t('allVersions', { count: option.installIds.length });
      return pcs.length > 1 ? `${label} · ${option.pc.name}` : label;
   };

   return (
      <HintCard
         title={t('mirrorTitle', { device: selected.pc.name })}
         description={t('mirrorDescription', { device: selected.pc.name })}
         onDismiss={() => void settings.updateApp({ dismissedHints: [...dismissed, hint] })}
         dismissLabel={common('notNow')}
      >
         {options.length > 1 ? (
            <Select value={selected.key} onValueChange={setPicked}>
               <SelectTrigger size="sm" className="w-52" aria-label={t('version')}>
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {options.map((option) => (
                     <SelectItem key={option.key} value={option.key}>
                        {optionLabel(option)}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
         ) : null}
         <Button
            size="sm"
            onClick={() => onMirror({ sourceTargetId: selected.pc.id, sourceInstallIds: selected.installIds, replaceOthers: selected.replaceOthers })}
         >
            <Copy data-icon="inline-start" />
            {selected.label ? t('mirrorAction', { version: selected.label }) : t('mirrorAllAction', { count: selected.installIds.length })}
         </Button>
      </HintCard>
   );
}

function HintCard({
   title,
   description,
   dismissLabel,
   onDismiss,
   children
}: {
   title: string;
   description: string;
   dismissLabel: string;
   onDismiss: () => void;
   children: React.ReactNode;
}) {
   return (
      <section className="bg-primary/5 border-primary/30 flex flex-col gap-3 rounded-xl border p-4">
         <div>
            <h2 className="font-medium">{title}</h2>
            <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
         </div>
         <div className="flex flex-wrap items-center gap-2">
            {children}
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onDismiss}>
               {dismissLabel}
            </Button>
         </div>
      </section>
   );
}
