import { useEffect, useState } from 'react';

import { AlertTriangle, KeyRound, Laptop, Pencil, PowerOff, ShieldCheck, Trash2, Unplug, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ConfirmDialog } from '@/components/dialog/confirm-dialog';
import { ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { useFormatters } from '@/app/renderer/i18n/formatters';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { receiverDeviceNameSchema } from '@/modules/receiver/protocol';
import { ConnectionSetupPrompt } from '@/modules/receiver/renderer/connection-setup-prompt';
import { RemoteSetupDialog } from '@/modules/receiver/renderer/remote-setup-dialog';
import { useReceiver, type Receiver } from '@/modules/receiver/renderer/use-receiver';
import type { PairedDevice, ReceiverSettings } from '@/modules/settings/contract';
import { SettingsSection } from '@/modules/settings/renderer/settings-layout';
import type { Target, TargetId } from '@/modules/targets/contract';
import type { TargetsLoadStatus } from '@/modules/targets/renderer/use-targets';

const automaticInterfaceValue = 'automatic';

export function RemoteSection({
   receiverSettings,
   disabled,
   canShareThisComputer,
   remoteTargets,
   targetsStatus,
   onReloadTargets,
   onRemotePaired
}: {
   receiverSettings: ReceiverSettings;
   disabled: boolean;
   canShareThisComputer: boolean;
   remoteTargets: Target[];
   targetsStatus: TargetsLoadStatus;
   onReloadTargets: () => void;
   onRemotePaired: (targetId: TargetId) => void;
}) {
   const t = useTranslations('settings');
   const receiver = useReceiver();
   const [setupOpen, setSetupOpen] = useState(false);
   const [teardownOpen, setTeardownOpen] = useState(false);
   const configured = receiverSettings.enabled || receiverSettings.remoteTargets.length > 0;
   const controlsDisabled = disabled || receiver.busy;
   const showControlledComputers = targetsStatus !== 'ready' || remoteTargets.length > 0;

   return (
      <>
         {receiver.error && !setupOpen && !teardownOpen ? (
            <Alert className="mt-6" variant="destructive">
               <AlertTriangle />
               <AlertTitle>{t('remote.errorTitle')}</AlertTitle>
               <AlertDescription>{receiver.error}</AlertDescription>
            </Alert>
         ) : null}

         <SettingsSection title={configured ? t('remote.title') : undefined}>
            {configured ? (
               <div className="flex min-w-0 flex-col">
                  <div className="flex flex-wrap justify-end gap-2 py-2">
                     <Button type="button" size="sm" disabled={controlsDisabled} onClick={() => setSetupOpen(true)}>
                        <Wifi data-icon="inline-start" />
                        {t('remote.connectComputer')}
                     </Button>
                     <Button type="button" variant="outline" size="sm" disabled={controlsDisabled} onClick={() => setTeardownOpen(true)}>
                        <PowerOff data-icon="inline-start" />
                        {t('remote.turnOff.action')}
                     </Button>
                  </div>

                  <div className="mt-2 min-w-0 divide-y border-y">
                     {canShareThisComputer ? (
                        <ThisComputerSection receiver={receiver} receiverSettings={receiverSettings} disabled={controlsDisabled} />
                     ) : null}
                     {showControlledComputers ? (
                        <ControlledComputersSection
                           receiver={receiver}
                           disabled={controlsDisabled}
                           targets={remoteTargets}
                           status={targetsStatus}
                           onReloadTargets={onReloadTargets}
                        />
                     ) : null}
                  </div>
               </div>
            ) : (
               <ConnectionSetupPrompt
                  context="settings"
                  canShareThisComputer={canShareThisComputer}
                  disabled={controlsDisabled}
                  onSetup={() => setSetupOpen(true)}
               />
            )}
         </SettingsSection>

         <RemoteSetupDialog
            open={setupOpen}
            receiver={receiver}
            receiverSettings={receiverSettings}
            startWithConnection={!canShareThisComputer}
            onOpenChange={setSetupOpen}
            onRemotePaired={onRemotePaired}
         />

         <RemoteTeardownDialog
            open={teardownOpen}
            receiver={receiver}
            receiverSettings={receiverSettings}
            remoteTargets={remoteTargets}
            onOpenChange={setTeardownOpen}
         />
      </>
   );
}

function ThisComputerSection({
   receiver,
   receiverSettings,
   disabled
}: {
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   disabled: boolean;
}) {
   const t = useTranslations('settings');
   const format = useFormatters();
   const state = receiver.state;
   const status = state?.status ?? 'disabled';
   const addresses = state?.addresses ?? [];
   const pairing = state?.pairing ?? null;
   const selectedInterface = state?.interfaces.find((option) => option.interfaceName === receiverSettings.interfaceName);
   const listensOnAllInterfaces = selectedInterface?.host === '0.0.0.0';

   return (
      <div className="min-w-0 py-4">
         <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
               <div className="text-muted-foreground flex size-9 shrink-0 items-center justify-center">
                  <Laptop className="size-4" />
               </div>
               <div className="min-w-0">
                  <h3 className="font-medium">{t('remote.thisComputer.title')}</h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">{t('remote.thisComputer.description')}</p>
               </div>
            </div>
            <Badge variant={status === 'running' ? 'default' : status === 'error' ? 'destructive' : 'outline'}>
               {t(`remote.receiver.statusValue.${status}`)}
            </Badge>
         </div>

         {receiverSettings.enabled ? (
            <div className="ml-12 flex flex-col gap-4 pt-4 pr-1">
               {addresses.length > 0 ? (
                  <div>
                     <div className="text-muted-foreground text-xs font-medium">{t('remote.receiver.address', { count: addresses.length })}</div>
                     <div className="mt-1.5 flex flex-col gap-1.5">
                        {addresses.map((item) => (
                           <div key={item.url} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                              <span className="min-w-0 font-mono break-all" data-selectable="true">
                                 {item.url}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">{item.interfaceName}</span>
                           </div>
                        ))}
                     </div>
                  </div>
               ) : null}
               {state?.message ? <p className="text-muted-foreground text-xs break-words">{state.message}</p> : null}

               <div>
                  <label className="text-muted-foreground text-xs font-medium" htmlFor="settings-remote-interface">
                     {t('remote.receiver.interface')}
                  </label>
                  <Select
                     value={receiverSettings.interfaceName ?? automaticInterfaceValue}
                     disabled={disabled}
                     onValueChange={(value) => void receiver.selectInterface(value === automaticInterfaceValue ? null : value)}
                  >
                     <SelectTrigger id="settings-remote-interface" className="mt-1.5 w-full">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectGroup>
                           <SelectItem value={automaticInterfaceValue}>{t('remote.receiver.interfaceAutomatic')}</SelectItem>
                           {(state?.interfaces ?? []).map((option) => (
                              <SelectItem key={option.interfaceName} value={option.interfaceName}>
                                 {option.host === '0.0.0.0' ? t('remote.receiver.interfaceAll') : `${option.interfaceName} (${option.host})`}
                              </SelectItem>
                           ))}
                        </SelectGroup>
                     </SelectContent>
                  </Select>
                  {listensOnAllInterfaces ? (
                     <p className="text-status-warning mt-2 flex gap-1.5 text-xs">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" />
                        <span>{t('remote.receiver.interfaceAllWarning')}</span>
                     </p>
                  ) : null}
               </div>

               {pairing ? (
                  <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
                     <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                        <KeyRound className="size-3.5" />
                        {t('remote.receiver.pairing')}
                     </div>
                     <div className="mt-1 font-mono text-xl font-semibold tracking-[0.25em]" data-selectable="true">
                        {pairing.code}
                     </div>
                     <p className="text-muted-foreground mt-1 text-xs">
                        {t('remote.receiver.pairingExpires', { time: format.time(pairing.expiresAt) })}
                     </p>
                  </div>
               ) : null}

               {state?.identity ? (
                  <details className="group rounded-lg border px-3 py-2.5">
                     <summary className="flex cursor-default list-none items-center gap-2 text-sm font-medium">
                        <ShieldCheck className="text-muted-foreground size-4" />
                        {t('remote.receiver.securityDetails')}
                     </summary>
                     <p className="text-muted-foreground mt-2 text-xs">{t('remote.receiver.identityDescription')}</p>
                     <p className="mt-1.5 font-mono text-xs break-all" data-selectable="true">
                        {state.identity.fingerprint}
                     </p>
                  </details>
               ) : null}

               {state && !state.secureStorage.available ? (
                  <Alert variant="warning">
                     <AlertTriangle />
                     <AlertTitle>{t('remote.receiver.secureStorage.title')}</AlertTitle>
                     <AlertDescription>{t('remote.receiver.secureStorage.description')}</AlertDescription>
                  </Alert>
               ) : null}

               {receiverSettings.pairedDevices.length > 0 ? (
                  <div className="border-t pt-4">
                     <div className="mb-3 flex items-center justify-between gap-3">
                        <h4 className="text-sm font-medium">{t('remote.receiver.pairedDevices')}</h4>
                        <span className="text-muted-foreground text-xs">
                           {t('remote.receiver.deviceCount', { count: receiverSettings.pairedDevices.length })}
                        </span>
                     </div>
                     <div className="flex w-full flex-col divide-y border-t">
                        {receiverSettings.pairedDevices.map((device) => (
                           <PairedDeviceRow
                              key={device.id}
                              device={device}
                              disabled={disabled}
                              onRename={receiver.renameDevice}
                              onRevoke={receiver.revokeDevice}
                           />
                        ))}
                     </div>
                  </div>
               ) : null}
            </div>
         ) : null}
      </div>
   );
}

function ControlledComputersSection({
   receiver,
   disabled,
   targets,
   status,
   onReloadTargets
}: {
   receiver: Receiver;
   disabled: boolean;
   targets: Target[];
   status: TargetsLoadStatus;
   onReloadTargets: () => void;
}) {
   const t = useTranslations('settings');

   return (
      <div className="min-w-0 py-4">
         <div className="flex items-center gap-3">
            <div className="text-muted-foreground flex size-9 shrink-0 items-center justify-center">
               <Wifi className="size-4" />
            </div>
            <h3 className="font-medium">{t('remote.remotes.title')}</h3>
         </div>
         <div className="ml-12 pt-3 pr-1">
            {status === 'loading' ? <LoadingPanel rows={1} className="w-full" /> : null}

            {status === 'error' ? <ErrorPanel className="w-full" message={t('remote.remotes.loadError')} onRetry={onReloadTargets} /> : null}

            {targets.length > 0 ? (
               <div className="flex w-full flex-col divide-y border-t">
                  {targets.map((target) => (
                     <RemoteTargetRow key={target.id} target={target} disabled={disabled} onForget={() => void receiver.forgetRemote(target.id)} />
                  ))}
               </div>
            ) : null}
         </div>
      </div>
   );
}

function RemoteTargetRow({ target, disabled, onForget }: { target: Target; disabled: boolean; onForget: () => void }) {
   const t = useTranslations('settings');
   const targetLabels = useTranslations('targets');
   const [confirmOpen, setConfirmOpen] = useState(false);

   return (
      <div className="flex items-center gap-3 py-3 text-sm">
         <div className="text-muted-foreground flex size-8 shrink-0 items-center justify-center">
            <Laptop className="size-4" />
         </div>
         <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{target.name}</div>
            <div className="text-muted-foreground truncate text-xs">
               {[target.address, target.status === 'ready' ? null : targetLabels(`status.${target.status}`), target.message]
                  .filter(Boolean)
                  .join(' - ')}
            </div>
         </div>
         <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={disabled} onClick={() => setConfirmOpen(true)}>
            <Unplug data-icon="inline-start" />
            {t('remote.remotes.forget')}
         </Button>

         <ConfirmDialog
            open={confirmOpen}
            title={t('remote.remotes.forgetConfirm.title')}
            description={t('remote.remotes.forgetConfirm.description')}
            confirmLabel={t('remote.remotes.forgetConfirm.confirm')}
            busy={disabled}
            onOpenChange={setConfirmOpen}
            onConfirm={() => {
               setConfirmOpen(false);
               onForget();
            }}
         >
            <PreviewRow label={t('remote.remotes.forgetConfirm.name')} value={target.name} />
            {target.address ? <PreviewRow label={t('remote.remotes.forgetConfirm.address')} value={target.address} /> : null}
            {target.fingerprint ? <PreviewRow label={t('remote.receiver.identity')} value={target.fingerprint} /> : null}
         </ConfirmDialog>
      </div>
   );
}

function RemoteTeardownDialog({
   open,
   receiver,
   receiverSettings,
   remoteTargets,
   onOpenChange
}: {
   open: boolean;
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   remoteTargets: Target[];
   onOpenChange: (open: boolean) => void;
}) {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const nothingPaired = receiverSettings.pairedDevices.length === 0 && remoteTargets.length === 0;

   return (
      <Dialog
         open={open}
         onOpenChange={(nextOpen) => {
            if (nextOpen || receiver.busy) return;

            onOpenChange(false);
         }}
      >
         <DialogContent className="sm:max-w-lg">
            <DialogHeader>
               <DialogTitle>{t('remote.turnOff.confirmTitle')}</DialogTitle>
               <DialogDescription>{t('remote.turnOff.confirmDescription')}</DialogDescription>
            </DialogHeader>

            {receiver.error ? (
               <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>{t('remote.errorTitle')}</AlertTitle>
                  <AlertDescription>{receiver.error}</AlertDescription>
               </Alert>
            ) : null}

            <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto text-sm">
               {nothingPaired ? <p className="text-muted-foreground">{t('remote.turnOff.nothing')}</p> : null}

               {receiverSettings.pairedDevices.length > 0 ? (
                  <div className="flex flex-col gap-1">
                     <p className="font-medium">{t('remote.turnOff.devices')}</p>
                     {receiverSettings.pairedDevices.map((device) => (
                        <p key={device.id} className="text-muted-foreground text-xs break-all">
                           {device.name}
                        </p>
                     ))}
                  </div>
               ) : null}

               {remoteTargets.length > 0 ? (
                  <div className="flex flex-col gap-1">
                     <p className="font-medium">{t('remote.turnOff.receivers')}</p>
                     {remoteTargets.map((target) => (
                        <p key={target.id} className="text-muted-foreground text-xs break-all">
                           {target.address ? `${target.name} (${target.address})` : target.name}
                        </p>
                     ))}
                  </div>
               ) : null}
            </div>

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" disabled={receiver.busy} onClick={() => onOpenChange(false)}>
                  {common('cancel')}
               </Button>
               <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={receiver.busy}
                  onClick={async () => {
                     const turnedOff = await receiver.disableRemote();
                     if (turnedOff) onOpenChange(false);
                  }}
               >
                  <PowerOff data-icon="inline-start" />
                  {receiver.busy ? t('remote.turnOff.working') : t('remote.turnOff.confirm')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
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
   const common = useTranslations('common');
   const format = useFormatters();
   const [name, setName] = useState(device.name);
   const [editing, setEditing] = useState(false);
   const [confirmOpen, setConfirmOpen] = useState(false);
   const trimmedName = name.trim();
   const renameDisabled = disabled || !receiverDeviceNameSchema.safeParse(trimmedName).success || trimmedName === device.name;
   const seenAt = format.time(device.lastSeenAt ?? device.pairedAt);

   useEffect(() => {
      setName(device.name);
      setEditing(false);
   }, [device.name]);

   return (
      <div className="flex flex-col gap-2 py-3 text-sm">
         {editing ? (
            <ButtonGroup className="w-full" aria-label={t('remote.receiver.deviceName')}>
               <Input
                  autoFocus
                  value={name}
                  disabled={disabled}
                  aria-label={t('remote.receiver.deviceName')}
                  onChange={(event) => setName(event.target.value)}
               />
               <Button
                  type="button"
                  size="sm"
                  disabled={renameDisabled}
                  onClick={async () => {
                     await onRename(device.id, trimmedName);
                     setEditing(false);
                  }}
               >
                  {t('remote.receiver.rename')}
               </Button>
               <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                     setName(device.name);
                     setEditing(false);
                  }}
               >
                  {common('cancel')}
               </Button>
            </ButtonGroup>
         ) : (
            <div className="flex items-center gap-3">
               <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{device.name}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">{t('remote.receiver.deviceSeenAt', { time: seenAt })}</div>
               </div>
               <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
                  <Pencil data-icon="inline-start" />
                  {t('remote.receiver.rename')}
               </Button>
               <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirmOpen(true)}>
                  <Trash2 data-icon="inline-start" />
                  {t('remote.receiver.revoke')}
               </Button>
            </div>
         )}

         <ConfirmDialog
            open={confirmOpen}
            title={t('remote.receiver.revokeConfirm.title')}
            description={t('remote.receiver.revokeConfirm.description')}
            confirmLabel={t('remote.receiver.revokeConfirm.confirm')}
            busy={disabled}
            onOpenChange={setConfirmOpen}
            onConfirm={() => {
               setConfirmOpen(false);
               void onRevoke(device.id);
            }}
         >
            <PreviewRow label={t('remote.receiver.revokeConfirm.name')} value={device.name} />
            <PreviewRow label={t('remote.receiver.revokeConfirm.seen')} value={seenAt} />
         </ConfirmDialog>
      </div>
   );
}
