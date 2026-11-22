import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { AlertTriangle, Check } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { SettingsLoading } from '@/modules/settings/renderer/settings-layout';
import { settingsPages } from '@/modules/settings/renderer/settings-nav';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { PageBody } from '@/renderer/shell/page-body';

export const Route = createFileRoute('/settings')({
   beforeLoad: ({ location }) => {
      if (location.pathname === '/settings') throw redirect({ to: '/settings/general', replace: true });
   },
   component: SettingsLayout
});

function SettingsLayout() {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const settings = useSettings();
   const pathname = useRouterState({ select: (state) => state.location.pathname });
   const page = settingsPages.find((candidate) => candidate.to === pathname)?.page;
   const snapshot = settings.snapshot;

   return (
      <PageBody className="max-w-4xl gap-8">
         <h1 className="text-2xl font-semibold">{page ? t(`pages.${page}`) : t('pageTitle')}</h1>

         {settings.loadStatus === 'error' ? (
            <Alert variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('loadError.title')}</AlertTitle>
               <AlertDescription>
                  <p>{settings.loadError ?? t('loadError.description')}</p>
                  <RefreshButton className="mt-3" label={common('retry')} onClick={settings.reload} />
               </AlertDescription>
            </Alert>
         ) : null}

         {snapshot?.problem ? (
            <Alert variant="warning">
               <AlertTriangle />
               <AlertTitle>{t('recovery.title')}</AlertTitle>
               <AlertDescription>
                  <p>{t('recovery.description', { path: snapshot.problem.path })}</p>
                  <Button className="mt-3" variant="outline" size="sm" disabled={settings.saving} onClick={() => void settings.updateApp({})}>
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

         {snapshot ? <Outlet /> : settings.loadStatus === 'loading' ? <SettingsLoading /> : null}
      </PageBody>
   );
}
