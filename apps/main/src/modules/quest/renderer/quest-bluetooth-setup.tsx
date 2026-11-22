import { useEffect, useRef, useState } from 'react';

import { Result } from 'better-result';
import { AlertTriangle, Bluetooth, Check, CheckCircle2, ChevronRight, ExternalLink, Loader2, LogOut } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { QuestIcon } from '@/components/headset-icons';
import { CopyableText } from '@/components/text/copyable-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import { createProblem, type Problem } from '@/lib/errors';
import type { QuestBluetoothDevice, QuestBluetoothPower, QuestPairingRequest } from '@/modules/quest/contract';
import { connectBluetoothHeadset } from '@/modules/quest/renderer/quest-bluetooth';
import { runCompanionSetup, waitAbortable, type CompanionPhase } from '@/modules/quest/renderer/quest-companion';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type RunPhase = CompanionPhase | 'connecting' | 'adb';

type SetupState =
   | { status: 'checking' }
   | { status: 'signed-out'; problem: Problem | null }
   | { status: 'starting-sign-in' }
   | { status: 'signing-in'; userCode: string }
   | { status: 'signed-in'; problem: Problem | null }
   | { status: 'signing-out' }
   | { status: 'scanning'; devices: QuestBluetoothDevice[] }
   | { status: 'pairing'; phase: RunPhase; headset: string }
   | { status: 'connected'; headset: string };

const phases: RunPhase[] = ['handshake', 'authenticate', 'developer-mode', 'pairing', 'adb'];
const allowWaitMs = 120_000;
const waitingForAllow = new Set([
   'android.adb.pair-failed',
   'android.adb.connect-failed',
   'quest.wireless.no-connect-port',
   'quest.wireless.not-ready'
]);

const quest = () => window.encore.quest;

export function QuestBluetoothSetup({ power, onPowerChanged }: { power: QuestBluetoothPower; onPowerChanged: () => void }) {
   const t = useTranslations('quest.setup.bluetooth');
   const common = useTranslations('common');
   const { reload } = useTargets();
   const [state, setState] = useState<SetupState>({ status: 'checking' });
   const abort = useRef<AbortController | null>(null);
   const mounted = useRef(true);

   useEffect(
      () =>
         quest().onBluetoothDevices((found) => {
            if (abort.current?.signal.aborted && found.length > 0) {
               void quest().selectBluetoothDevice({ deviceId: null });
               return;
            }
            setState((current) => (current.status === 'scanning' ? { status: 'scanning', devices: found } : current));
         }),
      []
   );
   useEffect(() => {
      let active = true;
      void Result.tryPromise(() => quest().ownerSignedIn()).then((result) => {
         if (!active) return;
         const signedIn = Result.isOk(result) && result.value;
         setState((current) => (current.status === 'checking' ? { status: signedIn ? 'signed-in' : 'signed-out', problem: null } : current));
      });
      return () => {
         active = false;
      };
   }, []);
   useEffect(
      () => () => {
         mounted.current = false;
         abort.current?.abort();
         void quest().cancelOwnerSignIn();
         void quest().selectBluetoothDevice({ deviceId: null });
      },
      []
   );

   if (window.encore.runtime !== 'desktop' || !('bluetooth' in navigator)) return null;

   const signIn = async () => {
      if (state.status !== 'signed-out') return;
      setState({ status: 'starting-sign-in' });
      const started = await quest().startOwnerSignIn();
      if (!mounted.current) return;
      if (!started.ok) return setState({ status: 'signed-out', problem: started.error });
      setState({ status: 'signing-in', userCode: started.value.userCode });
      void quest().openOwnerSignIn();
      const signedIn = await quest().waitForOwner();
      if (!mounted.current) return;
      if (!signedIn.ok) {
         return setState({ status: 'signed-out', problem: signedIn.error.code === 'quest.owner.cancelled' ? null : signedIn.error });
      }
      setState({ status: 'signed-in', problem: null });
   };

   const signOut = async () => {
      if (state.status !== 'signed-in') return;
      abort.current?.abort();
      setState({ status: 'signing-out' });
      await Result.tryPromise(() => quest().signOutOwner());
      if (!mounted.current) return;
      setState({ status: 'signed-out', problem: null });
   };

   const pairHeadset = async (signal: AbortSignal): Promise<Result<string, Problem>> => {
      const headset = await connectBluetoothHeadset(() => quest().recoverBluetoothService());
      if (Result.isError(headset)) return Result.err(headset.error);

      const { name, transport, disconnect } = headset.value;
      const pairing = await runCompanionSetup({
         transport,
         prove: async (challenge) => {
            const proof = await quest().proveOwner({ challenge: [...challenge] });
            return proof.ok ? Result.ok(Uint8Array.from(proof.value)) : Result.err(proof.error);
         },
         onPhase: (phase) => {
            if (mounted.current) setState({ status: 'pairing', phase, headset: name });
         },
         signal
      }).finally(disconnect);
      if (Result.isError(pairing)) return Result.err(pairing.error);

      if (mounted.current) setState({ status: 'pairing', phase: 'adb', headset: name });
      return (await pairOnceAllowed(pairing.value, signal)).map(() => name);
   };

   const connect = async () => {
      if (state.status !== 'signed-in') return;
      const controller = new AbortController();
      abort.current = controller;
      setState({ status: 'scanning', devices: [] });
      const connected = await Result.tryPromise({
         try: () => pairHeadset(controller.signal),
         catch: () => createProblem('quest.bluetooth.interrupted')
      });
      if (abort.current === controller) abort.current = null;
      if (!mounted.current) return;
      const headset = Result.flatten(connected);
      if (Result.isError(headset)) return setState({ status: 'signed-in', problem: controller.signal.aborted ? null : headset.error });
      void reload();
      setState({ status: 'connected', headset: headset.value });
   };

   const cancel = () => {
      abort.current?.abort();
      void quest().selectBluetoothDevice({ deviceId: null });
   };

   const choose = (device: QuestBluetoothDevice) => {
      setState((current) => (current.status === 'scanning' ? { status: 'pairing', phase: 'connecting', headset: device.name } : current));
      void quest().selectBluetoothDevice({ deviceId: device.deviceId });
   };

   if (state.status === 'checking') return null;

   if (state.status === 'signing-in') {
      return (
         <div className="flex flex-col gap-3">
            <p>{t('code')}</p>
            <div className="bg-muted/40 flex items-center rounded-lg border px-4 py-3">
               <CopyableText text={state.userCode} className="text-foreground font-mono text-2xl font-semibold tracking-[0.3em]" />
            </div>
            <p className="text-xs">{t('waiting')}</p>
            <div className="flex flex-wrap items-center gap-2">
               <Button type="button" size="sm" onClick={() => void quest().openOwnerSignIn()}>
                  <ExternalLink data-icon="inline-start" />
                  {t('openMeta')}
               </Button>
               <Button type="button" variant="ghost" size="sm" onClick={() => void quest().cancelOwnerSignIn()}>
                  {common('cancel')}
               </Button>
            </div>
         </div>
      );
   }

   const powerWarning = power === 'off' ? <BluetoothOff onChanged={onPowerChanged} /> : null;

   if (state.status === 'signed-in' || state.status === 'signing-out') {
      const busy = state.status === 'signing-out';
      return (
         <div className="flex flex-col gap-3">
            {powerWarning}
            <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
               <CheckCircle2 className="text-status-success size-3.5" />
               {t('signedIn')}
               <Tooltip>
                  <TooltipTrigger asChild>
                     <button
                        type="button"
                        aria-label={t('signOut')}
                        disabled={busy}
                        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-5 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:cursor-default disabled:opacity-50"
                        onClick={() => void signOut()}
                     >
                        <LogOut className="size-3" />
                     </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('signOut')}</TooltipContent>
               </Tooltip>
            </p>
            <p>{t('find')}</p>
            <SetupProblem problem={state.status === 'signed-in' ? state.problem : null} />
            <Button type="button" size="sm" className="self-start" disabled={power === 'off' || busy} onClick={() => void connect()}>
               <Bluetooth data-icon="inline-start" />
               {t('findAction')}
            </Button>
         </div>
      );
   }

   if (state.status === 'connected') {
      return (
         <div className="flex flex-col gap-3">
            <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
               <CheckCircle2 className="text-status-success size-4" />
               {t('connected', { name: state.headset })}
            </p>
            <p>{t('allowNext')}</p>
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setState({ status: 'signed-in', problem: null })}>
               {t('again')}
            </Button>
         </div>
      );
   }

   if (state.status === 'scanning') {
      return (
         <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
               <p className="text-foreground text-sm font-medium">{t('phase.connecting')}</p>
               <p className="text-xs">{t('scanning')}</p>
            </div>
            <DeviceChoices devices={state.devices} onChoose={choose} />
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={cancel}>
               {common('cancel')}
            </Button>
         </div>
      );
   }

   if (state.status === 'pairing') {
      const current = state.phase === 'connecting' ? 0 : phases.indexOf(state.phase);

      return (
         <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
               <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <QuestIcon className="text-foreground size-5" />
               </span>
               <span className="text-foreground min-w-0 truncate text-sm font-medium">{state.headset}</span>
            </div>
            <ol className="flex flex-col gap-2">
               {phases.map((phase, index) => (
                  <li key={phase} className="flex flex-col gap-2">
                     <PhaseRow label={t(`phase.${phase}`)} state={index < current ? 'done' : index === current ? 'current' : 'upcoming'} />
                     {index === current && (phase === 'pairing' || phase === 'adb') ? <p className="pl-6 text-xs">{t('pairingHint')}</p> : null}
                  </li>
               ))}
            </ol>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={cancel}>
               {common('cancel')}
            </Button>
         </div>
      );
   }

   return (
      <div className="flex flex-col gap-3">
         {powerWarning}
         <p>{t('hint')}</p>
         <SetupProblem problem={state.status === 'signed-out' ? state.problem : null} />
         <Button type="button" size="sm" className="self-start" disabled={state.status === 'starting-sign-in'} onClick={() => void signIn()}>
            <Bluetooth data-icon="inline-start" />
            {t('start')}
         </Button>
      </div>
   );
}

async function pairOnceAllowed(request: QuestPairingRequest, signal: AbortSignal): Promise<Result<void, Problem>> {
   const deadline = Date.now() + allowWaitMs;
   for (;;) {
      if (signal.aborted) return Result.err(createProblem('quest.companion.cancelled'));
      const paired = await quest().pairWireless(request);
      if (paired.ok) return Result.ok();
      if (signal.aborted || !waitingForAllow.has(paired.error.code) || Date.now() > deadline) return Result.err(paired.error);
      await waitAbortable(2_000, signal);
   }
}

function BluetoothOff({ onChanged }: { onChanged: () => void }) {
   const t = useTranslations('quest.setup.bluetooth');
   const [manual, setManual] = useState(false);
   const [turningOn, setTurningOn] = useState(false);
   const mac = window.encore.platform === 'darwin';

   return (
      <Alert variant="warning">
         <AlertTriangle />
         <AlertTitle>{t('off')}</AlertTitle>
         <AlertDescription className="flex flex-col items-start gap-2">
            {manual ? <p>{t('turnOnManually')}</p> : null}
            <Button
               type="button"
               variant="outline"
               size="sm"
               disabled={turningOn}
               onClick={async () => {
                  if (turningOn) return;
                  setTurningOn(true);
                  const turnedOn = await Result.tryPromise(() => quest().turnOnBluetooth());
                  setTurningOn(false);
                  setManual(!(Result.isOk(turnedOn) && turnedOn.value) && !mac);
                  onChanged();
               }}
            >
               <Bluetooth data-icon="inline-start" />
               {t(mac ? 'openSettings' : 'turnOn')}
            </Button>
         </AlertDescription>
      </Alert>
   );
}

function SetupProblem({ problem }: { problem: Problem | null }) {
   const t = useTranslations('quest.setup.bluetooth');

   if (!problem) return null;

   return (
      <Alert variant="destructive">
         <AlertTriangle />
         <AlertTitle>{t('failed')}</AlertTitle>
         <AlertDescription className="break-words">
            {problem.message}
            {problem.detail ? (
               <span className="text-muted-foreground block font-mono text-xs" data-selectable="true">
                  {problem.detail}
               </span>
            ) : null}
         </AlertDescription>
      </Alert>
   );
}

function PhaseRow({ label, state }: { label: string; state: 'done' | 'current' | 'upcoming' }) {
   return (
      <div
         className={cn(
            'flex items-center gap-2 text-sm',
            state === 'current' && 'text-foreground font-medium',
            state === 'upcoming' && 'text-muted-foreground/60'
         )}
      >
         <span
            aria-hidden="true"
            className={cn(
               'flex size-4 shrink-0 items-center justify-center rounded-full',
               state !== 'current' && 'border',
               state === 'done' && 'border-status-success bg-status-success text-white'
            )}
         >
            {state === 'done' ? <Check className="size-2.5" strokeWidth={3} /> : null}
            {state === 'current' ? <Loader2 className="text-primary size-4 animate-spin" /> : null}
         </span>
         {label}
      </div>
   );
}

function DeviceChoices({ devices, onChoose }: { devices: QuestBluetoothDevice[]; onChoose: (device: QuestBluetoothDevice) => void }) {
   const t = useTranslations('quest.setup.bluetooth');

   if (devices.length === 0) {
      return (
         <div className="text-muted-foreground flex items-center gap-3 rounded-lg border border-dashed px-4 py-5 text-sm">
            <Bluetooth className="size-4 shrink-0" />
            {t('nothingYet')}
         </div>
      );
   }

   return (
      <ul className="divide-border flex flex-col divide-y overflow-hidden rounded-lg border">
         {devices.map((device) => (
            <li key={device.deviceId}>
               <button
                  type="button"
                  className="hover:bg-muted/60 focus-visible:bg-muted/60 group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none"
                  onClick={() => onChoose(device)}
               >
                  <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                     <QuestIcon className="text-foreground size-5" />
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">{device.name}</span>
                  <span className="text-muted-foreground group-hover:text-foreground flex items-center gap-1 text-xs">
                     {t('connect')}
                     <ChevronRight className="size-3.5" />
                  </span>
               </button>
            </li>
         ))}
      </ul>
   );
}
