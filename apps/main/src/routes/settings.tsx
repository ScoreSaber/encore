import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, Check } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { RemoteSection } from '@/modules/receiver/renderer/remote-section';
import { AdvancedSection } from '@/modules/settings/renderer/advanced-section';
import { AppearanceSection } from '@/modules/settings/renderer/appearance-section';
import { BSManagerSection } from '@/modules/settings/renderer/bsmanager-section';
import { DeepLinkSection } from '@/modules/settings/renderer/deep-link-section';
import { InstallationSection } from '@/modules/settings/renderer/installation-section';
import { ModRepositoriesSection } from '@/modules/settings/renderer/mod-repositories-section';
import { SettingsLoading, SettingsPageShell } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';

export const Route = createFileRoute('/settings')({
   component: SettingsRoute
});

function SettingsRoute() {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const settings = useSettings();
   const targetList = useSelectedTarget();
   const snapshot = settings.snapshot;
   const controlsDisabled = settings.loadStatus !== 'ready' || settings.saveStatus === 'saving';
   const targets = targetList.targets;

   if (settings.loadStatus === 'error') {
      return (
         <SettingsPageShell title={t('pageTitle')}>
            <Alert variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('loadError.title')}</AlertTitle>
               <AlertDescription>
                  <p>{settings.loadError ?? t('loadError.description')}</p>
                  <RefreshButton className="mt-3" label={common('retry')} onClick={() => void settings.reload()} />
               </AlertDescription>
            </Alert>
         </SettingsPageShell>
      );
   }

   if (settings.loadStatus === 'loading' || !snapshot) {
      return (
         <SettingsPageShell title={t('pageTitle')}>
            <SettingsLoading />
         </SettingsPageShell>
      );
   }

   return (
      <SettingsPageShell title={t('pageTitle')}>
         {snapshot.problem ? (
            <Alert variant="warning">
               <AlertTriangle />
               <AlertTitle>{t('recovery.title')}</AlertTitle>
               <AlertDescription>
                  <p>{t('recovery.description', { path: snapshot.problem.path })}</p>
                  <Button
                     className="mt-3"
                     variant="outline"
                     size="sm"
                     disabled={settings.saveStatus === 'saving'}
                     onClick={() => void settings.updateApp({})}
                  >
                     <Check data-icon="inline-start" />
                     {t('recovery.action')}
                  </Button>
               </AlertDescription>
            </Alert>
         ) : null}

         {settings.writeError ? (
            <Alert variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('writeError.title')}</AlertTitle>
               <AlertDescription>{settings.writeError.message}</AlertDescription>
            </Alert>
         ) : null}

         <div className="flex flex-col">
            <AppearanceSection disabled={controlsDisabled} />

            <InstallationSection disabled={controlsDisabled} />

            <ModRepositoriesSection />

            <DeepLinkSection disabled={controlsDisabled} />

            <BSManagerSection />

            <RemoteSection
               receiverSettings={snapshot.app.receiver}
               disabled={controlsDisabled}
               canShareThisComputer={targets.some((target) => target.kind === 'local' && target.capabilities.includes('list-installs'))}
               remoteTargets={targets.filter((target) => target.kind === 'remote')}
               targetsStatus={targetList.status}
               onReloadTargets={targetList.reload}
               onRemotePaired={targetList.selectTarget}
            />

            <AdvancedSection disabled={controlsDisabled} />
         </div>
      </SettingsPageShell>
   );
}
