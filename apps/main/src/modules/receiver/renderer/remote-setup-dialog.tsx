import { useState } from 'react';

import { Result } from 'better-result';
import { AlertTriangle, Cable, Check, Keyboard, RefreshCw, ScanQrCode } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';

import { causeCode } from '@/lib/errors';
import { readPairingLink } from '@/modules/receiver/contract';
import { PairingScanner, useCameraAvailable } from '@/modules/receiver/renderer/pairing-qr';
import type { Receiver } from '@/modules/receiver/renderer/use-receiver';
import type { Target, TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

const pairingCodeLength = 6;
const connectFormId = 'remote-setup-connect';

type SetupState =
   | { status: 'form'; error: string | null }
   | { status: 'scanning'; error: string | null }
   | { status: 'pairing' }
   | { status: 'paired'; target: Target };

type ConnectDraft = { host: string; pairingCode: string; deviceName: string | null };

const emptyDraft: ConnectDraft = { host: '', pairingCode: '', deviceName: null };

export function RemoteSetupDialog({
   open,
   receiver,
   onOpenChange,
   onRemotePaired
}: {
   open: boolean;
   receiver: Receiver;
   onOpenChange: (open: boolean) => void;
   onRemotePaired: (targetId: TargetId) => void;
}) {
   const t = useTranslations('settings');
   const common = useTranslations('common');
   const [state, setState] = useState<SetupState>({ status: 'form', error: null });
   const camera = useCameraAvailable();
   const nativeScan = window.encore.scanPairingQr;
   const nativeScanning = Boolean(nativeScan) && state.status === 'scanning';
   const { targets } = useTargets();
   const thisDeviceName =
      targets.find((target) => target.kind === (window.encore.runtime === 'mobile' ? 'quest' : 'local'))?.name ??
      t('remote.setup.connect.defaultDeviceName');
   const [draft, setDraft] = useState(emptyDraft);
   const connect = { ...draft, deviceName: draft.deviceName ?? thisDeviceName };
   const pairing = state.status === 'pairing' || receiver.busy;
   const error = state.status === 'form' || state.status === 'scanning' ? state.error : null;
   const connectDisabled =
      pairing || connect.host.trim().length === 0 || connect.pairingCode.length !== pairingCodeLength || connect.deviceName.trim().length === 0;

   function close(nextOpen: boolean) {
      if (nextOpen || pairing || nativeScanning) return;

      onOpenChange(false);
      setState({ status: 'form', error: null });
      setDraft((current) => ({ ...emptyDraft, deviceName: current.deviceName }));
   }

   async function pair(request: typeof connect) {
      if (pairing) return;

      setState({ status: 'pairing' });
      const result = await receiver.pairRemote(request);
      if (!result.ok) {
         setState({ status: 'form', error: result.error });
         return;
      }

      onRemotePaired(result.target.id);
      setDraft((current) => ({ ...emptyDraft, deviceName: current.deviceName }));
      setState({ status: 'paired', target: result.target });
   }

   function scanned(link: { host: string; code: string }) {
      if (pairing) return;

      setDraft((current) => ({ ...current, host: link.host, pairingCode: link.code }));
      void pair({ ...connect, host: link.host, pairingCode: link.code });
   }

   async function toggleScanner() {
      if (state.status === 'scanning') {
         setState({ status: 'form', error: null });
         return;
      }

      setState({ status: 'scanning', error: null });
      if (!nativeScan) return;
      const result = await Result.tryPromise({
         try: () => nativeScan({ hint: t('remote.setup.scan.hint'), cancel: common('cancel') }),
         catch: causeCode
      });
      if (Result.isError(result)) {
         setState({ status: 'form', error: t(result.error === 'camera-permission' ? 'remote.setup.scan.permission' : 'remote.setup.scan.failed') });
         return;
      }
      const text = result.value.text;
      const link = text === null ? null : readPairingLink(text);
      if (link) scanned(link);
      else setState({ status: 'form', error: text === null ? null : t('remote.setup.scan.wrongCode') });
   }

   return (
      <Dialog open={open} onOpenChange={close}>
         <DialogContent className="sm:max-w-xl">
            <DialogHeader>
               <DialogTitle>{t('remote.setup.title')}</DialogTitle>
               <DialogDescription>{t('remote.setup.description')}</DialogDescription>
            </DialogHeader>

            {error ? (
               <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>{t('remote.errorTitle')}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
               </Alert>
            ) : null}

            {state.status === 'scanning' && !nativeScan ? <PairingScanner onScan={scanned} /> : null}

            {state.status === 'paired' ? (
               <div className="flex flex-col gap-2 text-sm">
                  <p className="font-medium">{t('remote.setup.done.manageTitle', { name: state.target.name })}</p>
                  <p className="text-muted-foreground">{t('remote.setup.done.manageDescription')}</p>
                  {state.target.hardware === 'steam-frame' ? (
                     <p className="text-muted-foreground">{t('remote.setup.done.frameNote', { name: state.target.name })}</p>
                  ) : null}
               </div>
            ) : null}

            {state.status === 'form' || state.status === 'pairing' ? (
               <form
                  id={connectFormId}
                  className="flex flex-col gap-3 text-sm"
                  onSubmit={(event) => {
                     event.preventDefault();
                     void pair(connect);
                  }}
               >
                  <div className="flex flex-col gap-1.5">
                     <Label htmlFor="remote-setup-host">{t('remote.setup.connect.host')}</Label>
                     <Input
                        id="remote-setup-host"
                        value={connect.host}
                        placeholder={t('remote.setup.connect.hostPlaceholder')}
                        disabled={pairing}
                        onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
                     />
                  </div>

                  <div className="flex flex-col gap-1.5">
                     <Label htmlFor="remote-setup-code">{t('remote.setup.connect.code')}</Label>
                     <InputOTP
                        id="remote-setup-code"
                        maxLength={pairingCodeLength}
                        value={connect.pairingCode}
                        disabled={pairing}
                        onChange={(pairingCode) => setDraft((current) => ({ ...current, pairingCode }))}
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
                        value={connect.deviceName}
                        disabled={pairing}
                        onChange={(event) => setDraft((current) => ({ ...current, deviceName: event.target.value }))}
                     />
                  </div>

                  {pairing ? (
                     <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <RefreshCw className="size-4 animate-spin" />
                        {t('remote.setup.connect.pairing')}
                     </div>
                  ) : null}
               </form>
            ) : null}

            <DialogFooter>
               {state.status === 'paired' ? (
                  <Button type="button" size="sm" onClick={() => close(false)}>
                     <Check data-icon="inline-start" />
                     {t('remote.setup.done.finish')}
                  </Button>
               ) : (
                  <>
                     {camera ? (
                        <Button
                           type="button"
                           variant="ghost"
                           size="sm"
                           className="sm:mr-auto"
                           disabled={pairing || nativeScanning}
                           onClick={() => void toggleScanner()}
                        >
                           {state.status === 'scanning' ? <Keyboard data-icon="inline-start" /> : <ScanQrCode data-icon="inline-start" />}
                           {t(state.status === 'scanning' ? 'remote.setup.scan.type' : 'remote.setup.scan.start')}
                        </Button>
                     ) : null}
                     <Button type="button" variant="outline" size="sm" disabled={pairing || nativeScanning} onClick={() => close(false)}>
                        {common('cancel')}
                     </Button>
                     <Button type="submit" form={connectFormId} size="sm" disabled={connectDisabled || state.status === 'scanning'}>
                        <Cable data-icon="inline-start" />
                        {t('remote.setup.connect.pair')}
                     </Button>
                  </>
               )}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
