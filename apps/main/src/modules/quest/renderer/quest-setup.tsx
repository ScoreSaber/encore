import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bluetooth, Cable, Check, Download, Wifi, Wrench } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/components/utils';

import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { modListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import { questInstallId, questLocalPairingSchema, questWirelessRequestSchema, type QuestLocalPairing } from '@/modules/quest/contract';
import { QuestBluetoothSetup } from '@/modules/quest/renderer/quest-bluetooth-setup';
import { QuestPatchProgress, useQuestPatch } from '@/modules/quest/renderer/quest-patch-banner';
import { questStateQueryOptions } from '@/modules/quest/renderer/quest-queries';
import type { Target, TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapIpc } from '@/renderer/ipc-result';
import { apiKey } from '@/renderer/query/api-query';

type StepState = 'done' | 'current' | 'upcoming';

type ConnectMethod = 'cable' | 'bluetooth' | 'wireless';

export function QuestSetupDialog({ open, onOpenChange, targetId }: { open: boolean; onOpenChange: (open: boolean) => void; targetId?: TargetId }) {
   const t = useTranslations('quest');
   const common = useTranslations('common');
   const onHeadset = window.encore.platform === 'android';

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(event) => event.preventDefault()}>
            <DialogHeader>
               <DialogTitle>{t(onHeadset ? 'setup.local.open' : 'setup.title')}</DialogTitle>
               <DialogDescription>{t('setup.description')}</DialogDescription>
            </DialogHeader>
            {open ? <QuestSetup targetId={targetId} /> : null}
            <DialogFooter>
               <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  {common('close')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

export function QuestSetup({ targetId }: { targetId?: TargetId }) {
   const t = useTranslations('quest.setup');
   const { targets } = useTargets();
   const headsets = targets.filter(
      (target) =>
         target.kind === 'quest' && target.connection !== 'remote' && target.status !== 'disconnected' && (!targetId || target.id === targetId)
   );
   const headset = headsets.find((target) => target.status === 'ready') ?? headsets[0] ?? null;
   const ready = headset?.status === 'ready';
   const desktop = window.encore.runtime === 'desktop';
   const connection = useQuery({
      queryKey: apiKey('quest', 'getConnectionStatus'),
      queryFn: () => window.encore.quest.getConnectionStatus(),
      refetchInterval: ready ? false : 3_000,
      enabled: desktop
   });
   const problem = connection.data?.error?.message ?? null;
   const host = useQuery({
      queryKey: apiKey('quest', 'getHostStatus'),
      queryFn: () => window.encore.quest.getHostStatus(),
      enabled: desktop && !headset,
      refetchInterval: 10_000
   });
   const bluetoothReady = 'bluetooth' in navigator && host.data?.bluetooth !== 'missing';
   const pluggedIn = host.data?.questPluggedIn ?? false;
   const suggested: ConnectMethod = bluetoothReady && !pluggedIn ? 'bluetooth' : 'cable';
   const [initialMethod, setInitialMethod] = useState<ConnectMethod | null>(null);
   const [chosen, setChosen] = useState<ConnectMethod | null>(null);
   if (host.isSuccess && initialMethod === null) setInitialMethod(suggested);
   const defaultMethod = initialMethod ?? suggested;
   const requestedMethod = chosen ?? defaultMethod;
   const method = requestedMethod === 'bluetooth' && !bluetoothReady ? 'cable' : requestedMethod;
   const connectedSummary = headset ? t('connect.done', { name: headset.name, wifi: headset.address ? 'yes' : 'no' }) : null;
   const methods: ConnectMethod[] = defaultMethod === 'bluetooth' ? ['bluetooth', 'cable', 'wireless'] : ['cable', 'bluetooth', 'wireless'];

   return (
      <ol className="flex flex-col">
         {desktop ? (
            <>
               <SetupStep number={1} state={headset || method === 'bluetooth' ? 'done' : 'current'} title={t('developer.title')}>
                  {t(
                     headset
                        ? 'developer.done'
                        : method === 'bluetooth'
                          ? 'developer.bluetooth'
                          : pluggedIn
                            ? 'developer.pluggedIn'
                            : 'developer.body'
                  )}
               </SetupStep>
               <SetupStep number={2} state={headset ? 'done' : 'current'} title={t('connect.title')} problem={headset ? null : problem}>
                  {headset ? (
                     connectedSummary
                  ) : (
                     <Tabs
                        value={method}
                        onValueChange={(value) => setChosen(methods.find((option) => option === value) ?? null)}
                        className="gap-3 pt-1"
                     >
                        <TabsList className="w-full">
                           {methods.map((option) =>
                              option === 'bluetooth' && !bluetoothReady ? null : (
                                 <TabsTrigger key={option} value={option}>
                                    {option === 'cable' ? <Cable /> : option === 'bluetooth' ? <Bluetooth /> : <Wifi />}
                                    {t(`connect.${option}`)}
                                 </TabsTrigger>
                              )
                           )}
                        </TabsList>
                        <TabsContent value="cable">
                           <p>{connection.data?.adbReady === false && !problem ? t('connect.preparing') : t('connect.cableBody')}</p>
                        </TabsContent>
                        <TabsContent value="bluetooth" forceMount className="data-[state=inactive]:hidden">
                           <QuestBluetoothSetup power={host.data?.bluetooth ?? 'unknown'} onPowerChanged={() => void host.refetch()} />
                        </TabsContent>
                        <TabsContent value="wireless">
                           <WirelessConnect />
                        </TabsContent>
                     </Tabs>
                  )}
               </SetupStep>
            </>
         ) : (
            <SetupStep number={1} state={ready ? 'done' : 'current'} title={t('local.title')}>
               {ready ? t('local.connected') : <LocalWirelessSetup />}
            </SetupStep>
         )}
         {desktop ? (
            <SetupStep number={3} state={ready ? 'done' : headset ? 'current' : 'upcoming'} title={t('allow.title')}>
               {t(ready ? 'allow.done' : 'allow.body')}
            </SetupStep>
         ) : null}
         {ready && headset ? (
            <GameStep key={headset.id} number={desktop ? 4 : 2} headset={headset} />
         ) : (
            <SetupStep number={desktop ? 4 : 2} state="upcoming" title={t('game.title')} />
         )}
         {desktop ? <CompanionStep key={headset?.id} headset={ready ? headset : null} /> : null}
      </ol>
   );
}

function LocalWirelessSetup() {
   const t = useTranslations('quest.setup.local');
   const { reload } = useTargets();
   const [code, setCode] = useState('');
   const request = questLocalPairingSchema.safeParse({ code });
   const settings = useMutation({ mutationFn: async () => unwrapIpc(await window.encore.questLocal.openWirelessSettings()) });
   const pairing = useMutation({
      mutationFn: async (input: QuestLocalPairing) => unwrapIpc(await window.encore.questLocal.pair(input)),
      onSuccess: async () => {
         setCode('');
         await reload();
      }
   });
   const problem = pairing.error ?? settings.error;

   return (
      <form
         className="flex flex-col items-start gap-3"
         onSubmit={(event) => {
            event.preventDefault();
            if (request.success && !pairing.isPending) pairing.mutate(request.data);
         }}
      >
         <Button type="button" size="sm" variant="outline" disabled={settings.isPending || pairing.isPending} onClick={() => settings.mutate()}>
            {t('settings')}
         </Button>
         {settings.data === 'app-info' ? <p>{t('developerOptions')}</p> : null}
         <p>{t('instructions')}</p>
         <label className="flex w-full max-w-60 flex-col gap-1">
            {t('code')}
            <Input
               inputMode="numeric"
               autoComplete="off"
               disabled={pairing.isPending}
               value={code}
               onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                  if (pairing.isError) pairing.reset();
               }}
            />
         </label>
         <Button type="submit" size="sm" disabled={!request.success || settings.isPending || pairing.isPending}>
            {t(pairing.isPending ? 'pairing' : 'pair')}
         </Button>
         {problem ? (
            <p role="alert" className="text-destructive text-xs">
               {problem.message}
            </p>
         ) : pairing.isSuccess ? (
            <p role="status">{t('paired')}</p>
         ) : null}
      </form>
   );
}

function GameStep({ number, headset }: { number: number; headset: Target }) {
   const t = useTranslations('quest.setup');
   const patchLabels = useTranslations('mods.quest');
   const missing = useTranslations('quest.gameMissing');
   const queryClient = useQueryClient();
   const installs = useInstalls(headset.id);
   const questState = useQuery(questStateQueryOptions(headset.id));
   const game = installs.snapshot?.installs.find((install) => install.id === questInstallId) ?? null;
   const patch = useQuestPatch(headset.id, () => {
      void queryClient.invalidateQueries({ queryKey: modListQueryOptions({ targetId: headset.id, installId: questInstallId }).queryKey });
   });

   if (game && questState.data?.modded && !patch.patching) {
      return (
         <SetupStep number={number} state="done" title={t('game.modded', { version: game.name })}>
            {t('game.tipRestore')}
         </SetupStep>
      );
   }

   const gameMissing = !patch.patching && installs.snapshot && questState.data && (!game || game.status === 'missing');

   return (
      <SetupStep
         number={number}
         state="current"
         title={gameMissing ? missing('title') : t('game.title')}
         problem={patch.failed ? (patch.error?.message ?? patchLabels('patchFailed')) : null}
      >
         {patch.patching ? (
            <QuestPatchProgress operation={patch.operation} />
         ) : !installs.snapshot || !questState.data ? (
            t('game.checking')
         ) : gameMissing ? (
            <div className="flex flex-col gap-2">
               <p>{missing('description')}</p>
               {questState.data.savedPlayerData ? <p className="text-muted-foreground text-xs">{missing('savedPlayerData')}</p> : null}
            </div>
         ) : (
            <Button type="button" size="sm" onClick={patch.start}>
               <Wrench data-icon="inline-start" />
               {patchLabels(patch.failed ? 'patchRetry' : 'patchAction')}
            </Button>
         )}
      </SetupStep>
   );
}

function CompanionStep({ headset }: { headset: Target | null }) {
   const t = useTranslations('quest');
   const install = useMutation({
      mutationFn: async (targetId: string) => unwrapIpc(await window.encore.quest.installCompanion({ targetId })).installed
   });
   const questState = useQuery({ ...questStateQueryOptions(headset?.id ?? ''), enabled: headset !== null });
   const installed = install.data === true || (questState.data?.companionInstalled ?? false);

   return (
      <SetupStep
         number={5}
         state={installed ? 'done' : headset ? 'current' : 'upcoming'}
         title={t('setup.companion.title')}
         badge={t('setup.optional')}
         problem={install.error?.message ?? null}
      >
         {installed ? (
            t('installed')
         ) : (
            <div className="flex flex-col gap-2">
               <p>{t('setup.companion.body')}</p>
               <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={!headset || install.isPending}
                  onClick={() => headset && install.mutate(headset.id)}
               >
                  <Download data-icon="inline-start" />
                  {t('installApp')}
               </Button>
            </div>
         )}
      </SetupStep>
   );
}

function SetupStep({
   number,
   state,
   title,
   badge = null,
   problem = null,
   children
}: {
   number: number;
   state: StepState;
   title: string;
   badge?: string | null;
   problem?: string | null;
   children?: React.ReactNode;
}) {
   return (
      <li
         className={cn(
            'relative flex gap-3 pb-6 last:pb-0',
            'before:bg-border before:absolute before:top-8 before:bottom-2 before:left-3 before:w-px last:before:hidden',
            state === 'done' && 'before:bg-status-success/40'
         )}
      >
         <span
            className={cn(
               'bg-background flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
               state === 'done' && 'border-status-success bg-status-success text-white',
               state === 'current' && 'border-primary text-primary',
               state === 'upcoming' && 'text-muted-foreground'
            )}
         >
            {state === 'done' ? <Check className="size-3.5" /> : number}
         </span>
         <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <p className={cn('flex items-center gap-2 text-sm font-medium', state === 'upcoming' && 'text-muted-foreground')}>
               {title}
               {badge ? (
                  <Badge variant="outline" className="text-muted-foreground font-normal">
                     {badge}
                  </Badge>
               ) : null}
            </p>
            {children && state !== 'upcoming' ? <div className="text-muted-foreground text-sm">{children}</div> : null}
            {problem ? (
               <p role="alert" className="text-destructive text-xs break-words">
                  {problem}
               </p>
            ) : null}
         </div>
      </li>
   );
}

function WirelessConnect() {
   const t = useTranslations('quest');
   const { reload } = useTargets();
   const [endpoint, setEndpoint] = useState('');
   const [invalid, setInvalid] = useState(false);
   const connect = useMutation({
      mutationFn: async (request: { endpoint: string }) => unwrapIpc(await window.encore.quest.connectWireless(request)),
      onSuccess: reload
   });
   const problem = invalid ? t('invalidAddress') : (connect.error?.message ?? null);

   return (
      <form
         className="flex flex-col gap-2"
         onSubmit={(event) => {
            event.preventDefault();
            const request = questWirelessRequestSchema.safeParse({ endpoint });
            setInvalid(!request.success);
            if (request.success) connect.mutate(request.data);
         }}
      >
         <p>{t('setup.connect.wirelessHint')}</p>
         <InputGroup className="h-8 max-w-72">
            <InputGroupInput
               value={endpoint}
               placeholder="192.168.1.50:5555"
               aria-label={t('address')}
               disabled={connect.isPending}
               autoCapitalize="none"
               autoCorrect="off"
               onChange={(event) => {
                  setEndpoint(event.target.value);
                  if (invalid) setInvalid(false);
                  if (connect.isError) connect.reset();
               }}
            />
            <InputGroupAddon align="inline-end">
               <InputGroupButton type="submit" disabled={connect.isPending || !endpoint.trim()}>
                  {t('connect')}
               </InputGroupButton>
            </InputGroupAddon>
         </InputGroup>
         {problem ? (
            <p role="alert" className="text-destructive text-xs break-words">
               {problem}
            </p>
         ) : null}
      </form>
   );
}
