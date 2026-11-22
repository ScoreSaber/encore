import { useState } from 'react';

import { createFileRoute } from '@tanstack/react-router';
import { useTranslations } from 'use-intl';

import { QuestIcon } from '@/components/headset-icons';
import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';

import { FrameSetupCard } from '@/modules/install-mirror/renderer/frame-setup-card';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { QuestSetupDialog } from '@/modules/quest/renderer/quest-setup';
import { DiagnosticsDialog } from '@/modules/support/renderer/diagnostics-dialog';
import { SupportLinksCard } from '@/modules/support/renderer/support-links-card';
import { SupportLogsCard } from '@/modules/support/renderer/support-logs-card';
import { useSupport } from '@/modules/support/renderer/use-support';
import { TargetPicker } from '@/modules/targets/renderer/target-picker';
import { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';
import { PageBody } from '@/renderer/shell/page-body';

export const Route = createFileRoute('/')({
   component: HomeRoute
});

function HomeRoute() {
   const t = useTranslations('home');
   const common = useTranslations('common');
   const targetLabels = useTranslations('targets');
   const quest = useTranslations('quest');
   const [questSetupOpen, setQuestSetupOpen] = useState(false);
   const targetList = useSelectedTarget();
   const targets = targetList.targets;
   const homeTargets = window.encore.platform === 'darwin' ? targets.filter((target) => target.capabilities.includes('list-installs')) : targets;
   const homeTargetId = homeTargets.some((target) => target.id === targetList.targetId)
      ? targetList.targetId
      : (homeTargets[0]?.id ?? targetList.targetId);
   const installs = useInstalls(homeTargetId);
   const support = useSupport({ targetId: homeTargetId });
   const remoteTargets = targets.filter((target) => target.kind === 'remote');
   const hasConnectedRemote = remoteTargets.some((target) => target.status === 'ready' && target.capabilities.includes('list-installs'));
   const hasConnectedQuest = targets.some((target) => target.kind === 'quest' && target.status === 'ready');
   const selectedTarget = targets.find((target) => target.id === homeTargetId);
   const showInstallControls = window.encore.platform !== 'darwin' || hasConnectedRemote || hasConnectedQuest;
   const showInstallLogs = selectedTarget?.capabilities.includes('list-installs') ?? false;
   const needsQuestSetup =
      window.encore.platform === 'android' &&
      !targets.some((target) => target.kind === 'quest' && target.status === 'ready' && target.connection !== 'remote');

   return (
      <PageBody className="gap-5">
         <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
               <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
            </div>
            {showInstallControls ? (
               <div className="flex shrink-0 gap-2">
                  <TargetPicker
                     id="home-target"
                     className="w-40"
                     label={targetLabels('picker')}
                     targets={homeTargets}
                     status={targetList.status}
                     value={homeTargetId}
                     onChange={targetList.selectTarget}
                  />
                  <RefreshButton
                     className="size-9"
                     label={common('refresh')}
                     onClick={async () => {
                        await Promise.all([targetList.reload(), installs.reload(), support.reload()]);
                     }}
                  />
               </div>
            ) : null}
         </div>

         {support.notice ? (
            <p className="text-muted-foreground text-sm">
               {t(`notice.${support.notice.code}`)}
               {support.notice.detail ? ` ${support.notice.detail}` : ''}
            </p>
         ) : null}

         <FrameSetupCard />

         {needsQuestSetup ? (
            <section className="flex flex-col items-start gap-3">
               <div>
                  <h2 className="font-medium">{quest('standaloneSetupTitle')}</h2>
                  <p className="text-muted-foreground max-w-2xl text-sm">{quest('standaloneHint')}</p>
               </div>
               <Button size="sm" onClick={() => setQuestSetupOpen(true)}>
                  <QuestIcon />
                  {quest('setup.local.open')}
               </Button>
            </section>
         ) : null}

         <div className="flex flex-col">
            <SupportLogsCard support={support} showInstallLogs={showInstallLogs} />
            <SupportLinksCard support={support} />
         </div>

         <DiagnosticsDialog support={support} />
         <QuestSetupDialog open={questSetupOpen} onOpenChange={setQuestSetupOpen} />
      </PageBody>
   );
}
