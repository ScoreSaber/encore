import { useIsMutating, useMutation, useMutationState, useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';

import { causeMessage } from '@/lib/errors';
import type { ReceiverRemotePairRequest } from '@/modules/receiver/contract';
import { receiverStateQueryOptions } from '@/modules/receiver/renderer/receiver-queries';
import type { AppSettingsPatch } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import type { Target, TargetId } from '@/modules/targets/contract';
import { unwrapIpc } from '@/renderer/ipc-result';

const receiverMutationPrefix = ['receiver'];
const receiverActionKey = ['receiver', 'action'];
const receiverPairKey = ['receiver', 'pair'];

export type Receiver = ReturnType<typeof useReceiver>;

type PairRemoteOutcome = { ok: true; target: Target } | { ok: false; error: string };

export function useReceiver() {
   const { snapshot, updateApp } = useSettings();
   const receiver = useQuery(receiverStateQueryOptions);
   const api = window.encore.receiver;
   const busy = useIsMutating({ mutationKey: receiverMutationPrefix }) > 0;
   const actionError = useMutationState({ filters: { mutationKey: receiverActionKey }, select: (mutation) => mutation.state.error }).at(-1) ?? null;

   const write = async (patch: AppSettingsPatch) => {
      const written = await updateApp(patch);
      if (!written.ok) throw written.error;
   };

   const enableReceiver = useMutation({ mutationKey: receiverActionKey, mutationFn: () => write({ receiver: { enabled: true } }) });
   const disableReceiver = useMutation({ mutationKey: receiverActionKey, mutationFn: () => write({ receiver: { enabled: false } }) });
   const startPairing = useMutation({ mutationKey: receiverActionKey, mutationFn: async () => unwrapIpc(await api.startPairing()) });
   const selectInterface = useMutation({
      mutationKey: receiverActionKey,
      mutationFn: async (interfaceName: string | null) => unwrapIpc(await api.selectInterface({ interfaceName }))
   });
   const renameDevice = useMutation({
      mutationKey: receiverActionKey,
      mutationFn: async ({ deviceId, name }: { deviceId: string; name: string }) => unwrapIpc(await api.renameDevice({ deviceId, name }))
   });
   const revokeDevice = useMutation({
      mutationKey: receiverActionKey,
      mutationFn: async (deviceId: string) => unwrapIpc(await api.revokeDevice({ deviceId }))
   });
   const pairRemote = useMutation({
      mutationKey: receiverPairKey,
      mutationFn: async (request: ReceiverRemotePairRequest) => unwrapIpc(await api.pairRemote(request))
   });
   const forgetRemote = useMutation({
      mutationKey: receiverActionKey,
      mutationFn: async (targetId: TargetId) => unwrapIpc(await api.forgetRemote({ targetId }))
   });
   const revokeAllDevices = useMutation({
      mutationKey: receiverActionKey,
      mutationFn: async () => {
         for (const device of snapshot?.app.receiver.pairedDevices ?? []) unwrapIpc(await api.revokeDevice({ deviceId: device.id }));
      }
   });

   return {
      state: receiver.data ?? null,
      error: actionError?.message ?? (receiver.error ? causeMessage(receiver.error) : null),
      busy,
      enableReceiver: () => enableReceiver.mutate(),
      disableReceiver: () => disableReceiver.mutate(),
      startPairing: () => startPairing.mutate(),
      selectInterface: (interfaceName: string | null) => selectInterface.mutate(interfaceName),
      renameDevice: (deviceId: string, name: string) =>
         renameDevice.mutateAsync({ deviceId, name }).then(
            () => true,
            () => false
         ),
      revokeDevice: (deviceId: string) => revokeDevice.mutate(deviceId),
      pairRemote: async (request: ReceiverRemotePairRequest): Promise<PairRemoteOutcome> => {
         const paired = await Result.tryPromise({ try: () => pairRemote.mutateAsync(request), catch: causeMessage });
         return Result.isOk(paired) ? { ok: true, target: paired.value } : { ok: false, error: paired.error };
      },
      forgetRemote: (targetId: TargetId) => forgetRemote.mutate(targetId),
      revokeAllDevices: () => revokeAllDevices.mutate()
   };
}
