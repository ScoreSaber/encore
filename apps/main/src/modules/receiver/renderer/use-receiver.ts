import { useCallback, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { IpcResult } from '@/ipc/core';
import { causeMessage } from '@/lib/errors';
import type { ReceiverRemotePairRequest } from '@/modules/receiver/contract';
import { receiverStateQueryOptions } from '@/modules/receiver/renderer/receiver-queries';
import type { AppSettingsPatch } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import type { TargetId } from '@/modules/targets/contract';
import { ipcResult } from '@/renderer/ipc-result';

export type Receiver = ReturnType<typeof useReceiver>;

export function useReceiver() {
   const { snapshot, reload: reloadSettings, updateApp } = useSettings();
   const receiver = useQuery(receiverStateQueryOptions);
   const [actionError, setActionError] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);

   const state = receiver.data ?? null;
   const error = actionError ?? (receiver.error ? causeMessage(receiver.error) : null);

   const run = useCallback(async <Value>(action: () => Promise<IpcResult<Value>>) => {
      setBusy(true);
      setActionError(null);

      const result = await ipcResult(action);

      setBusy(false);

      if (Result.isError(result)) {
         setActionError(result.error.message);
         return null;
      }

      return result.value;
   }, []);

   const write = useCallback(
      async (patch: AppSettingsPatch) => {
         setBusy(true);
         setActionError(null);

         const written = await updateApp(patch);

         setBusy(false);

         if (!written.ok) {
            setActionError(written.error.message);
            return false;
         }

         return true;
      },
      [updateApp]
   );

   const enableReceiver = useCallback(() => write({ receiver: { enabled: true } }), [write]);

   const startPairing = useCallback(() => run(() => window.encore.receiver.startPairing()), [run]);

   const selectInterface = useCallback((interfaceName: string | null) => run(() => window.encore.receiver.selectInterface({ interfaceName })), [run]);

   const renameDevice = useCallback(
      async (deviceId: string, name: string) => {
         const renamed = await run(() => window.encore.receiver.renameDevice({ deviceId, name }));
         if (renamed) await reloadSettings();
      },
      [run, reloadSettings]
   );

   const revokeDevice = useCallback(
      async (deviceId: string) => {
         const revoked = await run(() => window.encore.receiver.revokeDevice({ deviceId }));
         if (revoked) await reloadSettings();
      },
      [run, reloadSettings]
   );

   const pairRemote = useCallback((request: ReceiverRemotePairRequest) => run(() => window.encore.receiver.pairRemote(request)), [run]);

   const forgetRemote = useCallback((targetId: TargetId) => run(() => window.encore.receiver.forgetRemote({ targetId })), [run]);

   const disableRemote = useCallback(async () => {
      const current = snapshot?.app.receiver;
      if (!current) return false;

      for (const device of current.pairedDevices) {
         const revoked = await run(() => window.encore.receiver.revokeDevice({ deviceId: device.id }));
         if (!revoked) return false;
      }

      for (const record of current.remoteTargets) {
         const forgotten = await run(() => window.encore.receiver.forgetRemote({ targetId: record.id }));
         if (!forgotten) return false;
      }

      return write({ receiver: { enabled: false, interfaceName: null } });
   }, [snapshot, run, write]);

   return {
      state,
      error,
      busy,
      enableReceiver,
      startPairing,
      selectInterface,
      renameDevice,
      revokeDevice,
      pairRemote,
      forgetRemote,
      disableRemote
   };
}
