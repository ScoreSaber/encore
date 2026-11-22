import { useEffect, useEffectEvent, useState } from 'react';

import { CheckCircle2, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ConfirmDialog } from '@/components/dialog/confirm-dialog';
import { CopyableText } from '@/components/text/copyable-text';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/components/utils';

import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { receiverPortSchema } from '@/modules/receiver/address';
import { pairingLink } from '@/modules/receiver/contract';
import { receiverDeviceNameSchema } from '@/modules/receiver/protocol';
import { PairingQrCode } from '@/modules/receiver/renderer/pairing-qr';
import type { Receiver } from '@/modules/receiver/renderer/use-receiver';
import type { PairedDevice, ReceiverSettings } from '@/modules/settings/contract';
import { FoldedSettingsSection, SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { useFormatters } from '@/renderer/i18n/formatters';

const automaticNetwork = 'automatic';
const customNetwork = 'custom';
const allNetworksHost = '0.0.0.0';

export function ThisComputerSection({
   receiver,
   receiverSettings,
   disabled
}: {
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   disabled: boolean;
}) {
   const t = useTranslations('settings.remote.receiver');
   const [expanded, setExpanded] = useState(false);
   const [portOpen, setPortOpen] = useState(false);
   const state = receiver.state;
   const addresses = receiverSettings.enabled && state?.status === 'running' ? state.addresses : [];
   const [primary, ...others] = addresses;
   const allNetworks = state?.interfaces.find((option) => option.interfaceName === receiverSettings.interfaceName)?.host === allNetworksHost;

   return (
      <>
         <SettingsSection
            title={t('title')}
            headerAction={
               receiverSettings.enabled ? (
                  <ThisDeviceMenu
                     receiver={receiver}
                     receiverSettings={receiverSettings}
                     disabled={disabled}
                     onChangePort={() => setPortOpen(true)}
                  />
               ) : null
            }
         >
            <SettingsRow
               title={t('networkAccess')}
               htmlFor="settings-remote-share"
               description={
                  !receiverSettings.enabled ? (
                     t('networkOff')
                  ) : primary ? (
                     <span className="inline-flex max-w-full min-w-0 items-baseline gap-1">
                        <span className="shrink-0">{t('reachableAt')}</span>
                        <CopyableText text={primary.url} className="hover:text-foreground" />
                        {others.length > 0 ? (
                           <button
                              type="button"
                              className="hover:text-foreground shrink-0 cursor-pointer font-medium"
                              aria-expanded={expanded}
                              onClick={() => setExpanded((current) => !current)}
                           >
                              {expanded ? t('hide') : `+${others.length}`}
                           </button>
                        ) : null}
                     </span>
                  ) : state?.status === 'error' ? null : (
                     t('starting')
                  )
               }
               status={
                  state?.status === 'error' ? (
                     <span className="text-destructive">{state.message ?? t('failed')}</span>
                  ) : receiverSettings.enabled && allNetworks ? (
                     <span className="text-status-warning">{t('networkAllWarning')}</span>
                  ) : receiverSettings.enabled && state && !state.secureStorage.available ? (
                     <span className="text-status-warning">{t('secureStorage')}</span>
                  ) : null
               }
               control={
                  <Switch
                     id="settings-remote-share"
                     checked={receiverSettings.enabled}
                     disabled={disabled}
                     onCheckedChange={(enabled) => (enabled ? receiver.enableReceiver() : receiver.disableReceiver())}
                  />
               }
            />

            {expanded
               ? addresses.map((address) => (
                    <SettingsRow
                       key={address.url}
                       className="bg-muted/15"
                       title={address.interfaceName}
                       description={<CopyableText text={address.url} className="hover:text-foreground font-mono" />}
                    />
                 ))
               : null}
         </SettingsSection>

         {receiverSettings.enabled ? <PairedDevicesSection receiver={receiver} receiverSettings={receiverSettings} disabled={disabled} /> : null}

         {portOpen ? <PortDialog port={receiverSettings.port} onClose={() => setPortOpen(false)} /> : null}
      </>
   );
}

function ThisDeviceMenu({
   receiver,
   receiverSettings,
   disabled,
   onChangePort
}: {
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   disabled: boolean;
   onChangePort: () => void;
}) {
   const t = useTranslations('settings.remote.receiver');
   const interfaces = receiver.state?.interfaces ?? [];
   const options = interfaces.filter(
      (option) =>
         option.interfaceName === receiverSettings.interfaceName ||
         option.host === allNetworksHost ||
         (!option.host.includes(':') && !option.host.startsWith('127.'))
   );
   const missingInterface =
      receiverSettings.interfaceName && !interfaces.some((option) => option.interfaceName === receiverSettings.interfaceName)
         ? receiverSettings.interfaceName
         : null;

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t('more')} disabled={disabled}>
               <MoreHorizontal />
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel>{t('network')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
               value={receiverSettings.bindHost ? customNetwork : (receiverSettings.interfaceName ?? automaticNetwork)}
               onValueChange={(next) => {
                  if (next !== customNetwork) receiver.selectInterface(next === automaticNetwork ? null : next);
               }}
            >
               <DropdownMenuRadioItem value={automaticNetwork}>{t('networkAutomatic')}</DropdownMenuRadioItem>
               {receiverSettings.bindHost ? <DropdownMenuRadioItem value={customNetwork}>{receiverSettings.bindHost}</DropdownMenuRadioItem> : null}
               {missingInterface ? <DropdownMenuRadioItem value={missingInterface}>{missingInterface}</DropdownMenuRadioItem> : null}
               {options.map((option) => (
                  <DropdownMenuRadioItem key={option.interfaceName} value={option.interfaceName}>
                     {option.host === allNetworksHost ? t('networkAll') : `${option.interfaceName} · ${option.host}`}
                  </DropdownMenuRadioItem>
               ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onChangePort}>{t('changePort', { port: receiverSettings.port })}</DropdownMenuItem>
         </DropdownMenuContent>
      </DropdownMenu>
   );
}

function PairedDevicesSection({
   receiver,
   receiverSettings,
   disabled
}: {
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   disabled: boolean;
}) {
   const t = useTranslations('settings.remote.receiver');
   const format = useFormatters();
   const [open, setOpen] = useState(false);
   const [revokeAllOpen, setRevokeAllOpen] = useState(false);
   const [qrFor, setQrFor] = useState<{ code: string; openedAt: string; expiresAt: string } | null>(null);
   const pairing = receiver.state?.pairing ?? null;
   const pairingHost = receiver.state?.status === 'running' ? receiver.state.addresses[0]?.url : undefined;
   const devices = receiverSettings.pairedDevices;

   return (
      <FoldedSettingsSection
         title={t('devices')}
         summary={[t('deviceCount', { count: devices.length }), pairing ? t('codeActive') : null].filter(Boolean).join(' · ')}
         open={open}
         onOpenChange={setOpen}
         control={
            <>
               <Button
                  type="button"
                  variant="destructive-outline"
                  size="xs"
                  disabled={disabled || devices.length === 0}
                  onClick={() => setRevokeAllOpen(true)}
               >
                  {t('revokeAll')}
               </Button>
               <Button
                  type="button"
                  size="xs"
                  disabled={disabled || receiver.state?.status !== 'running'}
                  onClick={() => {
                     setOpen(true);
                     receiver.startPairing();
                  }}
               >
                  <Plus />
                  {t('createCode')}
               </Button>
            </>
         }
      >
         {pairing ? (
            <SettingsRow
               title={
                  <>
                     <span aria-hidden="true" className="bg-status-warning size-2 shrink-0 rounded-full" />
                     {t('pairing')}
                     {pairingHost ? (
                        <button
                           type="button"
                           className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-normal underline decoration-dashed underline-offset-4"
                           onClick={() => setQrFor({ code: pairing.code, openedAt: new Date().toISOString(), expiresAt: pairing.expiresAt })}
                        >
                           {t('showQr')}
                        </button>
                     ) : null}
                  </>
               }
               description={`${t('pairingExpires', { time: format.time(pairing.expiresAt) })} · ${t('pairingAttempts', { count: pairing.attemptsRemaining })}`}
               control={<CopyableText text={pairing.code} className="font-mono text-lg font-semibold tracking-[0.25em]" />}
            />
         ) : null}

         {qrFor ? (
            <PairingQrDialog
               code={qrFor.code}
               expiresAt={qrFor.expiresAt}
               link={pairing?.code === qrFor.code && pairingHost ? pairingLink(pairingHost, qrFor.code) : null}
               paired={devices.find((device) => device.pairedAt >= qrFor.openedAt) ?? null}
               onClose={() => setQrFor(null)}
            />
         ) : null}

         {devices.map((device) => (
            <PairedDeviceRow
               key={device.id}
               device={device}
               connected={receiver.state?.connectedDevices.includes(device.id) ?? false}
               disabled={disabled}
               onRename={receiver.renameDevice}
               onRevoke={receiver.revokeDevice}
            />
         ))}

         {!pairing && devices.length === 0 ? (
            <div className="px-3 py-3 sm:px-4">
               <p className="text-muted-foreground/60 text-xs">{t('devicesEmpty')}</p>
            </div>
         ) : null}

         <ConfirmDialog
            open={revokeAllOpen}
            title={t('revokeAllConfirm.title')}
            description={t('revokeAllConfirm.description')}
            confirmLabel={t('revokeAllConfirm.confirm')}
            busy={disabled}
            onOpenChange={setRevokeAllOpen}
            onConfirm={() => {
               setRevokeAllOpen(false);
               receiver.revokeAllDevices();
            }}
         />
      </FoldedSettingsSection>
   );
}

function PairedDeviceRow({
   device,
   connected,
   disabled,
   onRename,
   onRevoke
}: {
   device: PairedDevice;
   connected: boolean;
   disabled: boolean;
   onRename: (deviceId: string, name: string) => Promise<boolean>;
   onRevoke: (deviceId: string) => void;
}) {
   const t = useTranslations('settings.remote.receiver');
   const common = useTranslations('common');
   const format = useFormatters();
   const [renameOpen, setRenameOpen] = useState(false);
   const [revokeOpen, setRevokeOpen] = useState(false);
   const seenAt = format.time(device.lastSeenAt ?? device.pairedAt);

   return (
      <SettingsRow
         title={
            <>
               <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', connected ? 'bg-status-success' : 'bg-muted-foreground/40')} />
               {device.name}
            </>
         }
         description={connected ? t('deviceConnected') : t('deviceSeenAt', { time: seenAt })}
         control={
            <>
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button type="button" variant="ghost" size="icon-xs" aria-label={common('more')} disabled={disabled}>
                        <MoreHorizontal />
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     <DropdownMenuItem onSelect={() => setRenameOpen(true)}>{t('renameAction')}</DropdownMenuItem>
                  </DropdownMenuContent>
               </DropdownMenu>
               <Button type="button" variant="destructive-outline" size="xs" disabled={disabled} onClick={() => setRevokeOpen(true)}>
                  {t('revoke')}
               </Button>
            </>
         }
      >
         {renameOpen ? (
            <RenameDeviceDialog
               name={device.name}
               disabled={disabled}
               onClose={() => setRenameOpen(false)}
               onRename={async (name) => {
                  if (await onRename(device.id, name)) setRenameOpen(false);
               }}
            />
         ) : null}

         <ConfirmDialog
            open={revokeOpen}
            title={t('revokeConfirm.title')}
            description={t('revokeConfirm.description')}
            confirmLabel={t('revokeConfirm.confirm')}
            busy={disabled}
            onOpenChange={setRevokeOpen}
            onConfirm={() => {
               setRevokeOpen(false);
               onRevoke(device.id);
            }}
         >
            <PreviewRow label={t('revokeConfirm.name')} value={device.name} />
            <PreviewRow label={t('revokeConfirm.seen')} value={seenAt} />
         </ConfirmDialog>
      </SettingsRow>
   );
}

function RenameDeviceDialog({
   name,
   disabled,
   onClose,
   onRename
}: {
   name: string;
   disabled: boolean;
   onClose: () => void;
   onRename: (name: string) => void;
}) {
   const t = useTranslations('settings.remote.receiver');
   const common = useTranslations('common');
   const [draft, setDraft] = useState(name);
   const trimmed = draft.trim();
   const valid = receiverDeviceNameSchema.safeParse(trimmed).success && trimmed !== name;

   return (
      <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
         <DialogContent className="sm:max-w-sm">
            <form
               className="flex flex-col gap-4"
               onSubmit={(event) => {
                  event.preventDefault();
                  if (valid) onRename(trimmed);
               }}
            >
               <DialogHeader>
                  <DialogTitle>{t('renameTitle')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('deviceName')}</DialogDescription>
               </DialogHeader>
               <Input autoFocus value={draft} aria-label={t('deviceName')} disabled={disabled} onChange={(event) => setDraft(event.target.value)} />
               <DialogFooter>
                  <Button type="button" variant="outline" size="sm" onClick={onClose}>
                     {common('cancel')}
                  </Button>
                  <Button type="submit" size="sm" disabled={disabled || !valid}>
                     {t('rename')}
                  </Button>
               </DialogFooter>
            </form>
         </DialogContent>
      </Dialog>
   );
}

function PortDialog({ port, onClose }: { port: number; onClose: () => void }) {
   const t = useTranslations('settings.remote.receiver');
   const common = useTranslations('common');
   const settings = useSettings();
   const [draft, setDraft] = useState(String(port));
   const [error, setError] = useState<string | null>(null);

   async function save() {
      const next = receiverPortSchema.safeParse(Number(draft));
      if (!next.success) {
         setError(t('invalidPort'));
         return;
      }
      if (next.data !== port) {
         const written = await settings.updateApp({ receiver: { port: next.data } });
         if (!written.ok) {
            setError(written.error.message);
            return;
         }
      }
      setError(null);
      onClose();
   }

   return (
      <Dialog open onOpenChange={(next) => (next || settings.saving ? undefined : onClose())}>
         <DialogContent className="sm:max-w-sm">
            <form
               className="flex flex-col gap-4"
               onSubmit={(event) => {
                  event.preventDefault();
                  void save();
               }}
            >
               <DialogHeader>
                  <DialogTitle>{t('port')}</DialogTitle>
                  <DialogDescription>{t('portDescription')}</DialogDescription>
               </DialogHeader>
               <Input
                  autoFocus
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65_535}
                  value={draft}
                  aria-label={t('port')}
                  aria-invalid={error ? true : undefined}
                  disabled={settings.saving}
                  onChange={(event) => {
                     setDraft(event.target.value);
                     if (error) setError(null);
                  }}
               />
               {error ? <p className="text-destructive text-xs">{error}</p> : null}
               <DialogFooter>
                  <Button type="button" variant="outline" size="sm" disabled={settings.saving} onClick={onClose}>
                     {common('cancel')}
                  </Button>
                  <Button type="submit" size="sm" disabled={settings.saving}>
                     {t('savePort')}
                  </Button>
               </DialogFooter>
            </form>
         </DialogContent>
      </Dialog>
   );
}

const pairedNoticeMs = 3_000;
const pairedArrivalMs = 5_000;

function PairingQrDialog({
   code,
   expiresAt,
   link,
   paired,
   onClose
}: {
   code: string;
   expiresAt: string;
   link: string | null;
   paired: PairedDevice | null;
   onClose: () => void;
}) {
   const t = useTranslations('settings.remote.receiver.qr');
   const ended = link === null && paired === null;
   const close = useEffectEvent(onClose);

   useEffect(() => {
      if (!paired && !ended) return;
      const expired = Date.now() >= Date.parse(expiresAt);
      const timer = window.setTimeout(close, paired ? pairedNoticeMs : expired ? 0 : pairedArrivalMs);
      return () => window.clearTimeout(timer);
   }, [ended, expiresAt, paired]);

   return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
         <DialogContent className="sm:max-w-lg">
            <DialogHeader>
               <DialogTitle>{t(paired ? 'pairedTitle' : 'title')}</DialogTitle>
               <DialogDescription variant="muted">{paired ? t('pairedDescription', { name: paired.name }) : t('description')}</DialogDescription>
            </DialogHeader>
            {paired ? (
               <CheckCircle2 className="text-status-success mx-auto size-[min(40vh,14rem)]" strokeWidth={1.5} />
            ) : link ? (
               <>
                  <PairingQrCode value={link} className="mx-auto size-[min(60vh,26rem)]" />
                  <p className="text-center font-mono text-lg font-semibold tracking-[0.25em]">{code}</p>
               </>
            ) : (
               <p className="text-muted-foreground text-center text-sm">{t('finishing')}</p>
            )}
         </DialogContent>
      </Dialog>
   );
}
