import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, Check, Moon, RefreshCw, Sun, SunMoon } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { localeNames, locales } from '@/i18n/config';
import { useLocale } from '@/i18n/locale-provider';
import { useSettings } from '@/modules/settings/settings-provider';
import type { StoreKind } from '@/shared/settings';
import { storeKindSchema, storeKinds } from '@/shared/settings';
import { themes, type Theme } from '@/shared/ui-adjacent/theme';
import { useTheme } from '@/shared/ui-adjacent/theme-provider';

export const Route = createFileRoute('/settings')({
   component: SettingsRoute
});

const defaultStoreEmptyValue = 'none';
function SettingsRoute() {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const settings = useSettings();
   const { locale, setLocale } = useLocale();
   const { theme, setTheme } = useTheme();
   const snapshot = settings.snapshot;
   const controlsDisabled = settings.loadStatus !== 'ready' || settings.saveStatus === 'saving';

   if (settings.loadStatus === 'loading' || !snapshot) {
      return (
         <SettingsPageShell title={t('pageTitle')} description={t('pageDescription')}>
            <LoadingSettings />
         </SettingsPageShell>
      );
   }

   if (settings.loadStatus === 'error') {
      return (
         <SettingsPageShell title={t('pageTitle')} description={t('pageDescription')}>
            <Alert variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('loadError.title')}</AlertTitle>
               <AlertDescription>
                  <p>{settings.loadError ?? t('loadError.description')}</p>
                  <Button className="mt-3" variant="outline" size="sm" onClick={() => void settings.reload()}>
                     <RefreshCw data-icon="inline-start" />
                     {common('retry')}
                  </Button>
               </AlertDescription>
            </Alert>
         </SettingsPageShell>
      );
   }

   return (
      <SettingsPageShell
         title={t('pageTitle')}
         description={t('pageDescription')}
         action={
            <Button type="button" variant="outline" size="sm" disabled={controlsDisabled} onClick={() => void settings.reload()}>
               <RefreshCw data-icon="inline-start" />
               {t('refresh')}
            </Button>
         }
      >
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

         <div className="flex flex-col gap-4">
            <SettingsSection title={t('appearance.title')} description={t('appearance.description')}>
               <SettingsRow label={t('language.title')} htmlFor="settings-locale" description={t('language.description')}>
                  <Select value={locale} onValueChange={setLocale} disabled={controlsDisabled}>
                     <SelectTrigger id="settings-locale" className="w-full min-w-44 @md/field-group:w-48">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectGroup>
                           {locales.map((item) => (
                              <SelectItem key={item} value={item}>
                                 {localeNames[item]}
                              </SelectItem>
                           ))}
                        </SelectGroup>
                     </SelectContent>
                  </Select>
               </SettingsRow>

               <SettingsRow label={t('theme.title')} id="settings-theme" description={t('theme.description')}>
                  <ToggleGroup
                     className="flex-wrap justify-start @md/field-group:justify-end"
                     type="single"
                     value={theme}
                     spacing={2}
                     aria-labelledby="settings-theme"
                     disabled={controlsDisabled}
                     onValueChange={(value) => {
                        if (value) setTheme(value);
                     }}
                  >
                     {themes.map((item) => {
                        const Icon = themeIcon(item);
                        return (
                           <ToggleGroupItem key={item} value={item}>
                              <Icon />
                              {t(`theme.${item}`)}
                           </ToggleGroupItem>
                        );
                     })}
                  </ToggleGroup>
               </SettingsRow>
            </SettingsSection>

            <SettingsSection title={t('library.title')} description={t('library.description')}>
               <SettingsRow label={t('library.installRoot')} description={snapshot.library.installRoot}>
                  <Badge variant="outline">{t('library.managed')}</Badge>
               </SettingsRow>

               <SettingsRow label={t('library.defaultStore')} htmlFor="settings-default-store" description={t('library.defaultStoreDescription')}>
                  <Select
                     value={snapshot.library.defaultStore ?? defaultStoreEmptyValue}
                     disabled={controlsDisabled}
                     onValueChange={(value) => void settings.updateLibrary({ defaultStore: storeKindFromSelectValue(value) })}
                  >
                     <SelectTrigger id="settings-default-store" className="w-full min-w-44 @md/field-group:w-48">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectGroup>
                           <SelectItem value={defaultStoreEmptyValue}>{t('library.noDefaultStore')}</SelectItem>
                           {storeKinds.map((store) => (
                              <SelectItem key={store} value={store}>
                                 {t(`store.${store}`)}
                              </SelectItem>
                           ))}
                        </SelectGroup>
                     </SelectContent>
                  </Select>
               </SettingsRow>
            </SettingsSection>

            <SettingsSection title={t('receiver.title')} description={t('receiver.description')}>
               <SettingsRow label={t('receiver.enabled')} htmlFor="settings-receiver-enabled" description={t('receiver.enabledDescription')}>
                  <Switch
                     id="settings-receiver-enabled"
                     checked={snapshot.app.receiver.enabled}
                     disabled={controlsDisabled}
                     onCheckedChange={(enabled) => void settings.updateApp({ receiver: { enabled } })}
                  />
               </SettingsRow>

               <SettingsRow
                  label={t('receiver.pairedDevices')}
                  description={t('receiver.pairedDevicesDescription')}
                  controlClassName="flex w-full min-w-0 justify-start @md/field-group:w-72 @md/field-group:justify-end"
               >
                  {snapshot.app.receiver.pairedDevices.length > 0 ? (
                     <div className="flex w-full flex-col gap-2">
                        {snapshot.app.receiver.pairedDevices.map((device) => (
                           <div key={device.id} className="bg-background/50 rounded-md border px-3 py-2 text-sm">
                              <div className="font-medium">{device.name}</div>
                              <div className="text-muted-foreground text-xs">{device.lastSeenAt ?? device.pairedAt}</div>
                           </div>
                        ))}
                     </div>
                  ) : (
                     <Badge variant="outline">{t('receiver.noPairedDevices')}</Badge>
                  )}
               </SettingsRow>
            </SettingsSection>
         </div>
      </SettingsPageShell>
   );
}

function SettingsPageShell({
   title,
   description,
   action,
   children
}: {
   title: string;
   description: string;
   action?: React.ReactNode;
   children: React.ReactNode;
}) {
   return (
      <div className="flex max-w-4xl flex-col gap-5">
         <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
               <h1 className="text-2xl font-semibold">{title}</h1>
               <p className="text-muted-foreground mt-1 text-sm">{description}</p>
            </div>
            {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
         </div>
         {children}
      </div>
   );
}

function LoadingSettings() {
   return (
      <div className="flex flex-col gap-4">
         <LoadingCard rows={2} />
         <LoadingCard rows={2} />
         <LoadingCard rows={2} />
      </div>
   );
}

function LoadingCard({ rows }: { rows: number }) {
   return (
      <Card variant="settings" className="gap-0 py-0">
         <CardHeader className="border-b py-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64 max-w-full" />
         </CardHeader>
         <CardContent className="px-0">
            <div className="divide-border flex flex-col divide-y">
               {Array.from({ length: rows }).map((_, index) => (
                  <div key={index} className="flex items-center justify-between gap-6 px-6 py-4">
                     <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full max-w-72" />
                     </div>
                     <Skeleton className="h-8 w-36" />
                  </div>
               ))}
            </div>
         </CardContent>
      </Card>
   );
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
   return (
      <Card variant="settings" className="gap-0 py-0">
         <CardHeader className="border-b py-5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
         </CardHeader>
         <CardContent className="px-0">
            <FieldGroup className="divide-border gap-0 divide-y">{children}</FieldGroup>
         </CardContent>
      </Card>
   );
}

function SettingsRow({
   label,
   description,
   htmlFor,
   id,
   controlClassName = 'flex w-full min-w-0 justify-start @md/field-group:w-auto @md/field-group:min-w-56 @md/field-group:justify-end',
   children
}: {
   label: string;
   description?: string;
   htmlFor?: string;
   id?: string;
   controlClassName?: string;
   children: React.ReactNode;
}) {
   return (
      <Field orientation="responsive" className="px-6 py-4">
         <FieldContent className="min-w-0">
            {htmlFor ? <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel> : <FieldTitle id={id}>{label}</FieldTitle>}
            {description ? <FieldDescription className="break-words">{description}</FieldDescription> : null}
         </FieldContent>
         <div className={controlClassName}>{children}</div>
      </Field>
   );
}

function storeKindFromSelectValue(value: string): StoreKind | null {
   return storeKindSchema.nullable().catch(null).parse(value);
}

function themeIcon(theme: Theme) {
   if (theme === 'light') return Sun;
   if (theme === 'dark') return Moon;
   return SunMoon;
}
