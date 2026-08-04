import { useState } from 'react';

import { AlertTriangle, Cable, Check, KeyRound, Monitor, RefreshCw, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';

import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { Receiver } from '@/modules/receiver/renderer/use-receiver';
import type { ReceiverSettings } from '@/modules/settings/contract';
import type { Target, TargetId } from '@/modules/targets/contract';

const totalSteps = 3;
const pairingCodeLength = 6;
const connectFormId = 'remote-setup-connect';

type SetupMode = 'manage' | 'share';

type SetupStep = { name: 'connect' } | { name: 'done'; mode: SetupMode; target: Target | null } | { name: 'mode' } | { name: 'share' };

type ConnectForm = {
   host: string;
   pairingCode: string;
   deviceName: string;
};

export function RemoteSetupDialog({
   open,
   receiver,
   receiverSettings,
   startWithConnection = false,
   onOpenChange,
   onRemotePaired
}: {
   open: boolean;
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   startWithConnection?: boolean;
   onOpenChange: (open: boolean) => void;
   onRemotePaired: (targetId: TargetId) => void;
}) {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const [step, setStep] = useState<SetupStep>(startWithConnection ? { name: 'connect' } : { name: 'mode' });
   const [directConnection, setDirectConnection] = useState(startWithConnection);
   const [connect, setConnect] = useState<ConnectForm>({
      host: '',
      pairingCode: '',
      deviceName: t('remote.setup.connect.defaultDeviceName')
   });
   const connectDisabled =
      receiver.busy || connect.host.trim().length === 0 || connect.pairingCode.length !== pairingCodeLength || connect.deviceName.trim().length === 0;
   const currentStep = step.name === 'mode' ? 1 : step.name === 'done' ? 3 : 2;

   function close(nextOpen: boolean) {
      if (nextOpen || receiver.busy) return;

      onOpenChange(false);
      setStep(startWithConnection ? { name: 'connect' } : { name: 'mode' });
      setDirectConnection(startWithConnection);
      setConnect((current) => ({ ...current, pairingCode: '' }));
   }

   async function pairRemote(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();

      const target = await receiver.pairRemote(connect);
      if (!target) return;

      onRemotePaired(target.id);
      setConnect((current) => ({ ...current, pairingCode: '' }));
      setStep({ name: 'done', mode: 'manage', target });
   }

   return (
      <Dialog open={open} onOpenChange={close}>
         <DialogContent className="sm:max-w-xl">
            <DialogHeader>
               <DialogTitle className="flex flex-wrap items-baseline gap-x-2">
                  <span>{t('remote.setup.title')}</span>
                  {directConnection ? null : (
                     <span className="text-muted-foreground text-sm font-normal">
                        <span aria-hidden="true">·</span> {t('remote.setup.step', { current: currentStep, total: totalSteps })}
                     </span>
                  )}
               </DialogTitle>
               <DialogDescription>{t('remote.setup.description')}</DialogDescription>
            </DialogHeader>

            {receiver.error ? (
               <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>{t('remote.errorTitle')}</AlertTitle>
                  <AlertDescription>{receiver.error}</AlertDescription>
               </Alert>
            ) : null}

            {step.name === 'mode' ? <ModeStep onSelect={(mode) => setStep(mode === 'share' ? { name: 'share' } : { name: 'connect' })} /> : null}

            {step.name === 'share' ? <ShareStep receiver={receiver} receiverSettings={receiverSettings} /> : null}

            {step.name === 'connect' ? <ConnectStep busy={receiver.busy} form={connect} onChange={setConnect} onSubmit={pairRemote} /> : null}

            {step.name === 'done' ? <DoneStep step={step} /> : null}

            <DialogFooter>
               {step.name === 'mode' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => close(false)}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {step.name === 'share' || step.name === 'connect' ? (
                  <Button
                     type="button"
                     variant="outline"
                     size="sm"
                     disabled={receiver.busy}
                     onClick={() => {
                        setDirectConnection(false);
                        setStep({ name: 'mode' });
                     }}
                  >
                     {common('back')}
                  </Button>
               ) : null}

               {step.name === 'share' ? (
                  <ShareStepActions
                     receiver={receiver}
                     receiverSettings={receiverSettings}
                     onFinish={() => setStep({ name: 'done', mode: 'share', target: null })}
                  />
               ) : null}

               {step.name === 'connect' ? (
                  <Button type="submit" form={connectFormId} size="sm" disabled={connectDisabled}>
                     <Cable data-icon="inline-start" />
                     {t('remote.setup.connect.pair')}
                  </Button>
               ) : null}

               {step.name === 'done' ? (
                  <Button type="button" size="sm" onClick={() => close(false)}>
                     <Check data-icon="inline-start" />
                     {t('remote.setup.done.finish')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function ModeStep({ onSelect }: { onSelect: (mode: SetupMode) => void }) {
   const t = useTranslations('settings');

   return (
      <div className="flex flex-col gap-2">
         <p className="text-sm font-medium">{t('remote.setup.mode.title')}</p>
         <ModeChoice
            icon={<Wifi className="size-4 shrink-0" />}
            title={t('remote.setup.mode.shareTitle')}
            description={t('remote.setup.mode.shareDescription')}
            onSelect={() => onSelect('share')}
         />
         <ModeChoice
            icon={<Monitor className="size-4 shrink-0" />}
            title={t('remote.setup.mode.manageTitle')}
            description={t('remote.setup.mode.manageDescription')}
            onSelect={() => onSelect('manage')}
         />
      </div>
   );
}

function ModeChoice({ icon, title, description, onSelect }: { icon: React.ReactNode; title: string; description: string; onSelect: () => void }) {
   return (
      <button
         type="button"
         className="hover:bg-accent hover:text-accent-foreground flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors"
         onClick={onSelect}
      >
         <span className="mt-0.5">{icon}</span>
         <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            <span className="text-muted-foreground block text-xs break-words">{description}</span>
         </span>
      </button>
   );
}

function ShareStep({ receiver, receiverSettings }: { receiver: Receiver; receiverSettings: ReceiverSettings }) {
   const t = useTranslations('settings');
   const format = useFormatters();
   const state = receiver.state;
   const addresses = state?.addresses ?? [];
   const pairing = state?.pairing ?? null;

   if (!receiverSettings.enabled) {
      return (
         <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">{t('remote.setup.share.title')}</p>
            <p className="text-muted-foreground">{t('remote.setup.share.description')}</p>
         </div>
      );
   }

   if (state?.status === 'error') {
      return (
         <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t('remote.setup.share.failed')}</AlertTitle>
            <AlertDescription>{state.message ?? t('remote.setup.share.failedDescription')}</AlertDescription>
         </Alert>
      );
   }

   if (state?.status !== 'running') {
      return (
         <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <RefreshCw className="size-4 animate-spin" />
            {t('remote.setup.share.starting')}
         </div>
      );
   }

   return (
      <div className="flex flex-col gap-3 text-sm">
         <p className="text-muted-foreground">{t('remote.setup.share.running')}</p>

         {addresses.length > 0 ? (
            <div className="bg-background/50 min-w-0 rounded-md border px-3 py-2">
               <div className="text-muted-foreground text-xs">{t('remote.setup.share.address', { count: addresses.length })}</div>
               <div className="mt-1.5 flex flex-col gap-2">
                  {addresses.map((address) => (
                     <div key={address.url}>
                        <div className="font-mono text-xs break-all">{address.url}</div>
                        <div className="text-muted-foreground mt-0.5 text-xs">{address.interfaceName}</div>
                     </div>
                  ))}
               </div>
            </div>
         ) : null}

         {state.identity ? (
            <div className="bg-background/50 min-w-0 rounded-md border px-3 py-2">
               <div className="text-muted-foreground text-xs">{t('remote.setup.share.fingerprint')}</div>
               <div className="mt-1 font-mono text-xs break-all">{state.identity.fingerprint}</div>
            </div>
         ) : null}

         {state.secureStorage.available ? null : (
            <Alert variant="warning">
               <AlertTriangle />
               <AlertTitle>{t('remote.receiver.secureStorage.title')}</AlertTitle>
               <AlertDescription>{t('remote.receiver.secureStorage.description')}</AlertDescription>
            </Alert>
         )}

         {pairing ? (
            <div className="bg-background/50 min-w-0 rounded-md border px-3 py-2">
               <div className="text-muted-foreground text-xs">{t('remote.setup.share.code')}</div>
               <div className="font-mono text-2xl font-semibold tracking-[0.3em]">{pairing.code}</div>
               <div className="text-muted-foreground mt-1 text-xs">
                  {t('remote.setup.share.codeExpires', { time: format.time(pairing.expiresAt) })}
               </div>
               <div className="text-muted-foreground text-xs">{t('remote.setup.share.codeAttempts', { count: pairing.attemptsRemaining })}</div>
               <div className="text-muted-foreground mt-2 text-xs">{t('remote.setup.share.codeHint')}</div>
            </div>
         ) : (
            <p className="text-muted-foreground text-xs">{t('remote.setup.share.codeMissing')}</p>
         )}
      </div>
   );
}

function ShareStepActions({
   receiver,
   receiverSettings,
   onFinish
}: {
   receiver: Receiver;
   receiverSettings: ReceiverSettings;
   onFinish: () => void;
}) {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const state = receiver.state;

   if (!receiverSettings.enabled) {
      return (
         <Button type="button" size="sm" disabled={receiver.busy} onClick={() => void receiver.enableReceiver()}>
            <Wifi data-icon="inline-start" />
            {t('remote.setup.share.enable')}
         </Button>
      );
   }

   if (state?.status === 'error') {
      return <RefreshButton label={common('retry')} variant="default" disabled={receiver.busy} onClick={() => void receiver.enableReceiver()} />;
   }

   return (
      <>
         <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={receiver.busy || state?.status !== 'running'}
            onClick={() => void receiver.startPairing()}
         >
            <KeyRound data-icon="inline-start" />
            {t('remote.setup.share.createCode')}
         </Button>
         <Button type="button" size="sm" disabled={state?.status !== 'running'} onClick={onFinish}>
            {t('remote.setup.share.continue')}
         </Button>
      </>
   );
}

function ConnectStep({
   busy,
   form,
   onChange,
   onSubmit
}: {
   busy: boolean;
   form: ConnectForm;
   onChange: (update: (current: ConnectForm) => ConnectForm) => void;
   onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
   const t = useTranslations('settings');

   return (
      <form id={connectFormId} className="flex flex-col gap-3 text-sm" onSubmit={onSubmit}>
         <p className="text-muted-foreground">{t('remote.setup.connect.description')}</p>

         <div className="flex flex-col gap-1.5">
            <Label htmlFor="remote-setup-host">{t('remote.setup.connect.host')}</Label>
            <Input
               id="remote-setup-host"
               value={form.host}
               placeholder={t('remote.setup.connect.hostPlaceholder')}
               disabled={busy}
               onChange={(event) => onChange((current) => ({ ...current, host: event.target.value }))}
            />
         </div>

         <div className="flex flex-col gap-1.5">
            <Label htmlFor="remote-setup-code">{t('remote.setup.connect.code')}</Label>
            <InputOTP
               id="remote-setup-code"
               maxLength={pairingCodeLength}
               value={form.pairingCode}
               disabled={busy}
               onChange={(pairingCode) => onChange((current) => ({ ...current, pairingCode }))}
            >
               <InputOTPGroup>
                  {Array.from({ length: pairingCodeLength }).map((_, index) => (
                     <InputOTPSlot key={index} index={index} />
                  ))}
               </InputOTPGroup>
            </InputOTP>
         </div>

         <div className="flex flex-col gap-1.5">
            <Label htmlFor="remote-setup-device-name">{t('remote.setup.connect.deviceName')}</Label>
            <Input
               id="remote-setup-device-name"
               value={form.deviceName}
               disabled={busy}
               onChange={(event) => onChange((current) => ({ ...current, deviceName: event.target.value }))}
            />
         </div>

         {busy ? (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
               <RefreshCw className="size-4 animate-spin" />
               {t('remote.setup.connect.pairing')}
            </div>
         ) : null}
      </form>
   );
}

function DoneStep({ step }: { step: Extract<SetupStep, { name: 'done' }> }) {
   const t = useTranslations('settings');

   if (step.mode === 'share') {
      return (
         <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">{t('remote.setup.done.shareTitle')}</p>
            <p className="text-muted-foreground">{t('remote.setup.done.shareDescription')}</p>
         </div>
      );
   }

   return (
      <div className="flex flex-col gap-2 text-sm">
         <p className="font-medium">{t('remote.setup.done.manageTitle', { name: step.target?.name ?? '' })}</p>
         <p className="text-muted-foreground">{t('remote.setup.done.manageDescription')}</p>
      </div>
   );
}
