import { createFileRoute } from '@tanstack/react-router';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { ButtonGroup } from '@/components/ui/button-group';

import { BSManagerPrompt } from '@/modules/bsmanager/renderer/bsmanager-prompt';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { MacConnectionPrompt } from '@/modules/receiver/renderer/mac-connection-prompt';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
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
   const settings = useSettings();
   const targetList = useSelectedTarget();
   const targets = targetList.targets;
   const homeTargets = window.encore.platform === 'darwin' ? targets.filter((target) => target.capabilities.includes('list-installs')) : targets;
   const homeTargetId = homeTargets.some((target) => target.id === targetList.targetId)
      ? targetList.targetId
      : (homeTargets[0]?.id ?? targetList.targetId);
   const installs = useInstalls(homeTargetId);
   const support = useSupport({ targetId: homeTargetId });
   const summaries = installs.snapshot?.installs ?? [];
   const remoteTargets = targets.filter((target) => target.kind === 'remote');
   const hasConnectedRemote = remoteTargets.some((target) => target.status === 'ready' && target.capabilities.includes('list-installs'));
   const selectedTarget = targets.find((target) => target.id === homeTargetId);
   const showInstallControls = window.encore.platform !== 'darwin' || hasConnectedRemote;
   const showInstallLogs = selectedTarget?.capabilities.includes('list-installs') ?? false;

   return (
      <PageBody className="gap-5">
         <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
               <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
            </div>
            {showInstallControls ? (
               <ButtonGroup className="shrink-0" aria-label={t('pageTitle')}>
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
                     onClick={() => {
                        targetList.reload();
                        installs.reload();
                        support.reload();
                     }}
                  />
               </ButtonGroup>
            ) : null}
         </div>

         {support.notice ? (
            <p className="text-muted-foreground text-sm">
               {t(`notice.${support.notice.code}`)}
               {support.notice.detail ? ` ${support.notice.detail}` : ''}
            </p>
         ) : null}

         {window.encore.platform === 'darwin' && settings.snapshot ? (
            <MacConnectionPrompt
               receiverSettings={settings.snapshot.app.receiver}
               remoteTargets={remoteTargets}
               onRemotePaired={targetList.selectTarget}
            />
         ) : null}

         {window.encore.platform === 'darwin' ? null : <BSManagerPrompt installCount={summaries.length} />}

         <div className="flex flex-col">
            <SupportLogsCard support={support} showInstallLogs={showInstallLogs} />
            <SupportLinksCard support={support} />
         </div>

         <DiagnosticsDialog support={support} />
      </PageBody>
   );
}
