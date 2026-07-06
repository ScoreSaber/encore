import { useCallback, useEffect, useState } from 'react';

import { createFileRoute } from '@tanstack/react-router';
import { Result } from 'better-result';
import { AlertTriangle, Cable, Check, Info, KeyRound, Moon, Pencil, RefreshCw, ShieldCheck, Sun, SunMoon, Trash2, Unplug } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { localeNames, locales } from '@/i18n/config';
import { useLocale } from '@/i18n/locale-provider';
import { useSettings } from '@/modules/settings/settings-provider';
import { useStoreDetection } from '@/modules/targets/use-store-detection';
import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { IpcResult } from '@/shared/ipc/core';
import type { ReceiverRemotePairRequest, ReceiverState } from '@/shared/receiver';
import type { PairedDevice } from '@/shared/settings';
import { storeKindSchema, storeKinds } from '@/shared/settings';
import type {
   StoreDetectionDiagnostic,
   StoreDetectionSnapshot,
   StoreDetectionStatus,
   StoreDetectionStoreSummary,
   StoreInstallCandidate,
   Target
} from '@/shared/targets';
import { themes } from '@/shared/ui-adjacent/theme';
import { useTheme } from '@/shared/ui-adjacent/theme-provider';

export const Route = createFileRoute('/settings')({
   component: SettingsRoute
});

const defaultStoreEmptyValue = 'none';
function SettingsRoute() {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const targets = useTranslations('targets');
   const defaultRemoteDeviceName = t('receiver.remoteDefaultDeviceName');
   const settings = useSettings();
   const storeDetection = useStoreDetection();
   const { locale, setLocale } = useLocale();
   const { theme, setTheme } = useTheme();
   const receiver = useReceiverState();
   const [receiverActionError, setReceiverActionError] = useState<string | null>(null);
   const [receiverActionStatus, setReceiverActionStatus] = useState<'idle' | 'saving'>('idle');
   const [remotePairing, setRemotePairing] = useState<ReceiverRemotePairRequest>({
      host: '',
      pairingCode: '',
      deviceName: defaultRemoteDeviceName
   });
   const snapshot = settings.snapshot;
   const controlsDisabled = settings.loadStatus !== 'ready' || settings.saveStatus === 'saving' || receiverActionStatus === 'saving';
   const receiverState = receiver.state;
   const listenAddress = receiverState?.addresses[0] ?? null;
   const remotePairingDisabled =
      controlsDisabled ||
      remotePairing.host.trim().length === 0 ||
      remotePairing.pairingCode.trim().length === 0 ||
      remotePairing.deviceName.trim().length === 0;

   async function renameDevice(deviceId: string, name: string) {
      await runReceiverAction(
         () => getEncoreApi().receiver.renameDevice({ deviceId, name }),
         async () => {
            await settings.reload();
         }
      );
   }

   async function revokeDevice(deviceId: string) {
      await runReceiverAction(
         () => getEncoreApi().receiver.revokeDevice({ deviceId }),
         async () => {
            await settings.reload();
         }
      );
   }

   async function pairRemote(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();

      await runReceiverAction(
         () =>
            getEncoreApi().receiver.pairRemote({
               host: remotePairing.host,
               pairingCode: remotePairing.pairingCode,
               deviceName: remotePairing.deviceName
            }),
         (target) => {
            setRemotePairing((current) => ({
               ...current,
               pairingCode: ''
            }));
            receiver.upsertRemoteTarget(target);
         }
      );
   }

   async function runReceiverAction<Value>(action: () => Promise<IpcResult<Value>>, onSuccess?: (value: Value) => void | Promise<void>) {
      setReceiverActionStatus('saving');
      setReceiverActionError(null);

      const result = await Result.tryPromise({
         try: action,
         catch: (cause) => (cause instanceof Error ? cause.message : String(cause))
      });

      setReceiverActionStatus('idle');

      if (Result.isError(result)) {
         setReceiverActionError(result.error);
         return;
      }

      if (!result.value.ok) {
         setReceiverActionError(result.value.error.message);
         return;
      }

      await onSuccess?.(result.value.value);
   }

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
            <Button
               type="button"
               variant="outline"
               size="sm"
               disabled={controlsDisabled}
               onClick={() => void Promise.all([settings.reload(), receiver.reloadRemoteTargets()])}
            >
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

         {receiver.error || receiverActionError ? (
            <Alert variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('receiver.errorTitle')}</AlertTitle>
               <AlertDescription>{receiver.error ?? receiverActionError}</AlertDescription>
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
                        const Icon = item === 'light' ? Sun : item === 'dark' ? Moon : SunMoon;
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
               <SettingsRow label={t('library.installRoot')} description={snapshot.library.installRoot} />

               <SettingsRow label={t('library.defaultStore')} htmlFor="settings-default-store" description={t('library.defaultStoreDescription')}>
                  <Select
                     value={snapshot.library.defaultStore ?? defaultStoreEmptyValue}
                     disabled={controlsDisabled}
                     onValueChange={(value) => void settings.updateLibrary({ defaultStore: storeKindSchema.nullable().catch(null).parse(value) })}
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

            <StoreDetectionSection detection={storeDetection} />

            <SettingsSection title={t('receiver.title')} description={t('receiver.description')}>
               <Field orientation="vertical" className="px-6 py-4">
                  <div className="flex items-start justify-between gap-6">
                     <FieldContent className="min-w-0">
                        <FieldLabel htmlFor="settings-receiver-enabled">{t('receiver.enabled')}</FieldLabel>
                        <FieldDescription className="break-words">{t('receiver.enabledDescription')}</FieldDescription>
                     </FieldContent>
                     <Switch
                        id="settings-receiver-enabled"
                        checked={snapshot.app.receiver.enabled}
                        disabled={controlsDisabled}
                        onCheckedChange={(enabled) => void settings.updateApp({ receiver: { enabled } })}
                     />
                  </div>

                  {snapshot.app.receiver.enabled ? (
                     <div className="bg-background/50 grid gap-3 rounded-md border px-3 py-3 text-sm @lg/field-group:grid-cols-[auto_minmax(0,1fr)_auto]">
                        <div className="flex min-w-0 flex-col gap-1">
                           <div className="text-muted-foreground text-xs">{t('receiver.status')}</div>
                           <Badge
                              className="w-fit"
                              variant={
                                 receiverState?.status === 'running' ? 'default' : receiverState?.status === 'error' ? 'destructive' : 'outline'
                              }
                           >
                              {t(`receiver.statusValue.${receiverState?.status ?? 'disabled'}`)}
                           </Badge>
                        </div>
                        {listenAddress ? (
                           <div className="min-w-0">
                              <div className="text-muted-foreground text-xs">{t('receiver.listenAddress')}</div>
                              <div className="mt-1 min-w-0">
                                 <div className="font-mono text-xs break-all">{listenAddress.url}</div>
                                 <div className="text-muted-foreground mt-1 text-xs">{listenAddress.interfaceName}</div>
                              </div>
                           </div>
                        ) : null}
                        <div className="flex flex-col items-start gap-2">
                           {receiverState?.pairing ? (
                              <div>
                                 <div className="text-muted-foreground text-xs">{t('receiver.pairing')}</div>
                                 <div className="font-mono text-lg font-semibold tracking-[0.2em]">{receiverState.pairing.code}</div>
                                 <div className="text-muted-foreground mt-1 text-xs">
                                    {t('receiver.pairingExpires', { time: formatTime(receiverState.pairing.expiresAt) })}
                                 </div>
                              </div>
                           ) : null}
                           <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={controlsDisabled || receiverState?.status !== 'running'}
                              onClick={() => void runReceiverAction(() => getEncoreApi().receiver.startPairing())}
                           >
                              <KeyRound data-icon="inline-start" />
                              {t('receiver.startPairing')}
                           </Button>
                        </div>
                     </div>
                  ) : null}

                  {snapshot.app.receiver.enabled && snapshot.app.receiver.pairedDevices.length > 0 ? (
                     <div className="flex w-full flex-col gap-2">
                        <div className="text-muted-foreground text-xs font-medium">{t('receiver.pairedDevices')}</div>
                        {snapshot.app.receiver.pairedDevices.map((device) => (
                           <PairedDeviceRow
                              key={device.id}
                              device={device}
                              disabled={controlsDisabled}
                              onRename={renameDevice}
                              onRevoke={revokeDevice}
                           />
                        ))}
                     </div>
                  ) : null}
               </Field>

               <Field orientation="vertical" className="px-6 py-4">
                  <FieldContent className="min-w-0">
                     <FieldTitle>{t('receiver.remotePairing')}</FieldTitle>
                     <FieldDescription className="break-words">{t('receiver.remotePairingDescription')}</FieldDescription>
                  </FieldContent>

                  <form className="grid w-full gap-2 @lg/field-group:grid-cols-[minmax(10rem,1fr)_7rem_minmax(10rem,1fr)_auto]" onSubmit={pairRemote}>
                     <Input
                        value={remotePairing.host}
                        placeholder={t('receiver.remoteHostPlaceholder')}
                        aria-label={t('receiver.remoteHost')}
                        disabled={controlsDisabled}
                        onChange={(event) =>
                           setRemotePairing((current) => ({
                              ...current,
                              host: event.target.value
                           }))
                        }
                     />
                     <Input
                        className="font-mono"
                        value={remotePairing.pairingCode}
                        placeholder={t('receiver.remoteCodePlaceholder')}
                        aria-label={t('receiver.remoteCode')}
                        inputMode="numeric"
                        maxLength={6}
                        disabled={controlsDisabled}
                        onChange={(event) =>
                           setRemotePairing((current) => ({
                              ...current,
                              pairingCode: event.target.value
                           }))
                        }
                     />
                     <Input
                        value={remotePairing.deviceName}
                        aria-label={t('receiver.remoteDeviceName')}
                        disabled={controlsDisabled}
                        onChange={(event) =>
                           setRemotePairing((current) => ({
                              ...current,
                              deviceName: event.target.value
                           }))
                        }
                     />
                     <Button type="submit" disabled={remotePairingDisabled}>
                        <Cable data-icon="inline-start" />
                        {t('receiver.remotePair')}
                     </Button>
                  </form>

                  {receiver.remoteTargets.length > 0 ? (
                     <div className="flex w-full flex-col gap-2">
                        <div className="text-muted-foreground text-xs font-medium">{t('receiver.remoteTargets')}</div>
                        {receiver.remoteTargets.map((target) => (
                           <div
                              key={target.id}
                              className="bg-background/50 flex flex-col gap-2 rounded-md border px-3 py-2 text-sm @lg/field-group:flex-row @lg/field-group:items-center"
                           >
                              <div className="min-w-0 flex-1">
                                 <div className="truncate font-medium">{target.name}</div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                 <Badge variant={target.status === 'ready' ? 'default' : 'outline'}>{targets(`status.${target.status}`)}</Badge>
                                 <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={controlsDisabled}
                                    onClick={() =>
                                       void runReceiverAction(() => getEncoreApi().receiver.disconnectRemote(target.id), receiver.upsertRemoteTarget)
                                    }
                                 >
                                    <Unplug data-icon="inline-start" />
                                    {t('receiver.remoteDisconnect')}
                                 </Button>
                              </div>
                           </div>
                        ))}
                     </div>
                  ) : null}
               </Field>
            </SettingsSection>
         </div>
      </SettingsPageShell>
   );
}

function useReceiverState() {
   const [state, setState] = useState<ReceiverState | null>(null);
   const [remoteTargets, setRemoteTargets] = useState<Target[]>([]);
   const [error, setError] = useState<string | null>(null);

   const upsertRemoteTarget = useCallback((target: Target) => {
      setRemoteTargets((current) => {
         if (!current.some((item) => item.id === target.id)) return [...current, target];
         return current.map((item) => (item.id === target.id ? target : item));
      });
   }, []);

   const reloadRemoteTargets = useCallback(async () => {
      const result = await Result.tryPromise({
         try: () => getEncoreApi().receiver.listRemoteTargets(),
         catch: (cause) => (cause instanceof Error ? cause.message : String(cause))
      });

      if (Result.isError(result)) {
         setError(result.error);
         return;
      }

      setRemoteTargets(result.value);
   }, []);

   useEffect(() => {
      let disposed = false;
      const api = getEncoreApi();

      void Result.tryPromise({
         try: () => api.receiver.getState(),
         catch: (cause) => (cause instanceof Error ? cause.message : String(cause))
      }).then((result) => {
         if (Result.isOk(result)) {
            if (!disposed) setState(result.value);
            return;
         }

         if (!disposed) setError(result.error);
      });

      void reloadRemoteTargets();

      const unsubscribe = api.receiver.onStateChanged((nextState) => {
         if (!disposed) setState(nextState);
      });
      const unsubscribeRemoteTargets = api.receiver.onRemoteTargetEvent((event) => {
         if (!disposed && event.type === 'target-updated') upsertRemoteTarget(event.target);
      });

      return () => {
         disposed = true;
         unsubscribe();
         unsubscribeRemoteTargets();
      };
   }, [reloadRemoteTargets, upsertRemoteTarget]);

   return {
      state,
      remoteTargets,
      error,
      reloadRemoteTargets,
      upsertRemoteTarget
   };
}

function PairedDeviceRow({
   device,
   disabled,
   onRename,
   onRevoke
}: {
   device: PairedDevice;
   disabled: boolean;
   onRename: (deviceId: string, name: string) => Promise<void>;
   onRevoke: (deviceId: string) => Promise<void>;
}) {
   const t = useTranslations('settings');
   const [name, setName] = useState(device.name);
   const trimmedName = name.trim();
   const renameDisabled = disabled || trimmedName.length === 0 || trimmedName === device.name;

   useEffect(() => {
      setName(device.name);
   }, [device.name]);

   return (
      <div className="bg-background/50 flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
         <div className="flex flex-col gap-2 @lg/field-group:flex-row">
            <Input value={name} disabled={disabled} aria-label={t('receiver.deviceName')} onChange={(event) => setName(event.target.value)} />
            <div className="flex shrink-0 gap-2">
               <Button type="button" variant="outline" size="sm" disabled={renameDisabled} onClick={() => void onRename(device.id, trimmedName)}>
                  <Pencil data-icon="inline-start" />
                  {t('receiver.rename')}
               </Button>
               <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={() => void onRevoke(device.id)}>
                  <Trash2 data-icon="inline-start" />
                  {t('receiver.revoke')}
               </Button>
            </div>
         </div>
         <div className="text-muted-foreground text-xs">{t('receiver.deviceSeenAt', { time: formatTime(device.lastSeenAt ?? device.pairedAt) })}</div>
      </div>
   );
}

function formatTime(value: string) {
   return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
   });
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

type StoreDetectionViewModel = ReturnType<typeof useStoreDetection>;

const diagnosticMessageKeys = {
   'oculus.beat-saber-missing': 'storeDetection.diagnostics.oculusBeatSaberMissing',
   'oculus.detected': 'storeDetection.diagnostics.oculusDetected',
   'oculus.libraries-missing': 'storeDetection.diagnostics.oculusLibrariesMissing',
   'oculus.registry-read-failed': 'storeDetection.diagnostics.oculusRegistryReadFailed',
   'oculus.unsupported-platform': 'storeDetection.diagnostics.oculusUnsupportedPlatform',
   'steam.beat-saber-missing': 'storeDetection.diagnostics.steamBeatSaberMissing',
   'steam.detected': 'storeDetection.diagnostics.steamDetected',
   'steam.libraryfolders-missing': 'storeDetection.diagnostics.steamLibraryfoldersMissing',
   'steam.libraryfolders-read-failed': 'storeDetection.diagnostics.steamLibraryfoldersReadFailed',
   'steam.root-missing': 'storeDetection.diagnostics.steamRootMissing',
   'steam.unsupported-platform': 'storeDetection.diagnostics.steamUnsupportedPlatform'
} satisfies Record<StoreDetectionDiagnostic['code'], string>;

function StoreDetectionSection({ detection }: { detection: StoreDetectionViewModel }) {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const snapshot = detection.snapshot;
   const isScanning = detection.scanStatus === 'scanning';
   const isLoading = detection.loadStatus === 'loading';

   return (
      <SettingsSection title={t('storeDetection.title')} description={t('storeDetection.description')}>
         <SettingsRow
            label={t('storeDetection.scan.title')}
            description={
               snapshot ? t('storeDetection.scan.lastScanned', { time: formatScanTime(snapshot.scannedAt) }) : t('storeDetection.scan.description')
            }
         >
            <Button type="button" variant="outline" size="sm" disabled={isLoading || isScanning} onClick={() => void detection.rescan()}>
               <RefreshCw data-icon="inline-start" className={isScanning ? 'animate-spin' : undefined} />
               {t('storeDetection.rescan')}
            </Button>
         </SettingsRow>

         {detection.loadStatus === 'error' ? (
            <SettingsRow
               label={t('storeDetection.unavailable.title')}
               description={t('storeDetection.unavailable.description')}
               controlClassName="flex w-full min-w-0 justify-start @md/field-group:w-72 @md/field-group:justify-end"
            >
               <Button type="button" variant="outline" size="sm" onClick={detection.reload}>
                  <RefreshCw data-icon="inline-start" />
                  {common('retry')}
               </Button>
            </SettingsRow>
         ) : null}

         {isLoading ? <StoreDetectionLoading /> : null}

         {!isLoading && snapshot ? (
            <>
               <SettingsRow
                  label={t('storeDetection.installs.title')}
                  description={t('storeDetection.installs.description')}
                  controlClassName="flex w-full min-w-0 justify-start @md/field-group:w-[28rem]"
               >
                  <StoreInstallList candidates={snapshot.candidates} />
               </SettingsRow>

               <SettingsRow
                  label={t('storeDetection.libraries.title')}
                  description={t('storeDetection.libraries.description')}
                  controlClassName="flex w-full min-w-0 justify-start @md/field-group:w-[28rem]"
               >
                  <StoreLibraryList stores={snapshot.stores} />
               </SettingsRow>

               <SettingsRow
                  label={t('storeDetection.diagnostics.title')}
                  description={t('storeDetection.diagnostics.description')}
                  controlClassName="flex w-full min-w-0 justify-start @md/field-group:w-[28rem]"
               >
                  <StoreDiagnosticsList diagnostics={snapshot.diagnostics} />
               </SettingsRow>
            </>
         ) : null}
      </SettingsSection>
   );
}

function StoreDetectionLoading() {
   const t = useTranslations('settings');

   return (
      <SettingsRow label={t('storeDetection.loading')} controlClassName="flex w-full min-w-0 justify-start @md/field-group:w-[28rem]">
         <div className="flex w-full flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-5/6" />
         </div>
      </SettingsRow>
   );
}

function StoreInstallList({ candidates }: { candidates: StoreInstallCandidate[] }) {
   const t = useTranslations('settings');

   if (candidates.length === 0) {
      return <Badge variant="outline">{t('storeDetection.installs.empty')}</Badge>;
   }

   return (
      <div className="flex w-full flex-col gap-2">
         {candidates.map((candidate) => (
            <div key={candidate.id} className="bg-background/50 min-w-0 rounded-md border px-3 py-2 text-sm">
               <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{t('storeDetection.installName', { store: t(`store.${candidate.store}`) })}</span>
                  <Badge variant="secondary">
                     <ShieldCheck />
                     {t('storeDetection.protected')}
                  </Badge>
                  <Badge variant="outline">{t('storeDetection.readOnly')}</Badge>
               </div>
               <div className="text-muted-foreground mt-1 text-xs break-all">{candidate.path}</div>
            </div>
         ))}
      </div>
   );
}

function StoreLibraryList({ stores }: { stores: StoreDetectionStoreSummary[] }) {
   return (
      <div className="divide-border flex w-full flex-col divide-y rounded-md border">
         {stores.map((store) => (
            <StoreLibraryGroup key={store.store} store={store} />
         ))}
      </div>
   );
}

function StoreLibraryGroup({ store }: { store: StoreDetectionStoreSummary }) {
   const t = useTranslations('settings');

   return (
      <div className="flex min-w-0 flex-col gap-2 px-3 py-2 text-sm">
         <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-medium">{t(`store.${store.store}`)}</span>
            <Badge variant={storeStatusVariant(store.status)}>{t(`storeDetection.status.${store.status}`)}</Badge>
         </div>
         {store.clientPath ? (
            <div className="text-muted-foreground text-xs break-all">{t('storeDetection.clientPath', { path: store.clientPath })}</div>
         ) : null}
         {store.libraries.length > 0 ? (
            <div className="flex flex-col gap-1">
               {store.libraries.map((library) => (
                  <div key={library.id} className="text-muted-foreground flex min-w-0 flex-col gap-1 text-xs">
                     <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 break-all">{library.path}</span>
                        {library.isDefault ? <Badge variant="outline">{t('storeDetection.defaultLibrary')}</Badge> : null}
                        {library.hasBeatSaber ? <Badge variant="secondary">{t('storeDetection.containsBeatSaber')}</Badge> : null}
                     </div>
                  </div>
               ))}
            </div>
         ) : (
            <div className="text-muted-foreground text-xs">{t('storeDetection.libraries.empty')}</div>
         )}
      </div>
   );
}

function StoreDiagnosticsList({ diagnostics }: { diagnostics: StoreDetectionDiagnostic[] }) {
   const t = useTranslations('settings');

   if (diagnostics.length === 0) {
      return <Badge variant="outline">{t('storeDetection.diagnostics.empty')}</Badge>;
   }

   return (
      <div className="flex w-full flex-col gap-2">
         {diagnostics.map((diagnostic) => {
            const Icon = diagnostic.severity === 'info' ? Info : AlertTriangle;

            return (
               <div key={diagnostic.id} className="bg-background/50 flex min-w-0 gap-2 rounded-md border px-3 py-2 text-sm">
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0">
                     <div className="font-medium">{t(`store.${diagnostic.store}`)}</div>
                     <div className="text-muted-foreground text-xs break-words">
                        {t(diagnosticMessageKeys[diagnostic.code], { path: diagnostic.path ?? '' })}
                     </div>
                  </div>
               </div>
            );
         })}
      </div>
   );
}

function storeStatusVariant(status: StoreDetectionStatus) {
   if (status === 'detected') return 'default';
   if (status === 'error') return 'destructive';
   if (status === 'unsupported') return 'outline';
   return 'secondary';
}

function formatScanTime(scannedAt: StoreDetectionSnapshot['scannedAt']) {
   return new Date(scannedAt).toLocaleString();
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
   children?: React.ReactNode;
}) {
   return (
      <Field orientation="responsive" className="px-6 py-4">
         <FieldContent className="min-w-0">
            {htmlFor ? <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel> : <FieldTitle id={id}>{label}</FieldTitle>}
            {description ? <FieldDescription className="break-words">{description}</FieldDescription> : null}
         </FieldContent>
         {children ? <div className={controlClassName}>{children}</div> : null}
      </Field>
   );
}
