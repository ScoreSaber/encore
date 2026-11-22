import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import { LanguageRow } from '@/modules/settings/renderer/appearance-section';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { TelemetrySection } from '@/modules/settings/renderer/telemetry-section';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { runsOnSteamFrame } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { UpdateVersionRow } from '@/modules/updates/renderer/update-controls';

export const Route = createFileRoute('/settings/general')({
   component: GeneralSettings
});

function GeneralSettings() {
   const t = useTranslations('settings');
   const settings = useSettings();
   const desktop = window.encore.runtime === 'desktop';
   const { targets } = useTargets();
   const canRunInBackground = desktop && (window.encore.platform === 'win32' || window.encore.platform === 'linux') && !runsOnSteamFrame(targets);
   const tray = useQuery({ queryKey: ['app', 'hasTray'], queryFn: () => window.encore.app.hasTray(), enabled: canRunInBackground });

   return (
      <>
         {desktop ? (
            <SettingsSection title={t('about.title')}>
               <UpdateVersionRow />
            </SettingsSection>
         ) : null}

         <SettingsSection title={t('general.title')}>
            <LanguageRow disabled={settings.saving} />
            {settings.snapshot && targets.some((target) => target.kind === 'remote') ? (
               <SettingsRow
                  title={t('combineInstalls.label')}
                  description={t('combineInstalls.description')}
                  htmlFor="settings-combine-installs"
                  control={
                     <Switch
                        id="settings-combine-installs"
                        checked={settings.snapshot.app.combineInstalls}
                        disabled={settings.saving}
                        onCheckedChange={(combineInstalls) => void settings.updateApp({ combineInstalls })}
                     />
                  }
               />
            ) : null}
            {canRunInBackground && settings.snapshot ? (
               <SettingsRow
                  title={t('background.label')}
                  description={t(tray.data === false ? 'background.noTray' : 'background.description')}
                  htmlFor="settings-run-in-background"
                  control={
                     <Switch
                        id="settings-run-in-background"
                        checked={settings.snapshot.app.runInBackground}
                        disabled={settings.saving}
                        onCheckedChange={(runInBackground) => void settings.updateApp({ runInBackground })}
                     />
                  }
               />
            ) : null}
            {canRunInBackground && settings.snapshot ? (
               <SettingsRow
                  title={t('startAtLogin.label')}
                  description={t(tray.data === false ? 'startAtLogin.noTray' : 'startAtLogin.description')}
                  htmlFor="settings-start-at-login"
                  control={
                     <Switch
                        id="settings-start-at-login"
                        checked={settings.snapshot.app.startAtLogin}
                        disabled={settings.saving}
                        onCheckedChange={(startAtLogin) => void settings.updateApp({ startAtLogin })}
                     />
                  }
               />
            ) : null}
            {desktop ? (
               <SettingsRow
                  title={t('guide.label')}
                  control={
                     <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={settings.saving}
                        onClick={() => void settings.updateApp({ setup: null })}
                     >
                        {t('guide.action')}
                     </Button>
                  }
               />
            ) : null}
         </SettingsSection>

         {desktop ? <TelemetrySection disabled={settings.saving} /> : null}
      </>
   );
}
