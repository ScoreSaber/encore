import { Result } from 'better-result';
import { shell, type IpcMainInvokeEvent } from 'electron';

import { defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import type { SecretStore } from '@/lib/security/secret-store';
import { questIpc } from '@/modules/quest/ipc';
import { createQuestBluetoothChooser } from '@/modules/quest/main/quest-bluetooth-chooser';
import { recoverLinuxCompanionService } from '@/modules/quest/main/quest-bluetooth-recovery';
import type { QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import type { QuestHeadsets } from '@/modules/quest/main/quest-headsets';
import { questPluggedIn, readBluetoothPower, turnOnBluetooth } from '@/modules/quest/main/quest-host-status';
import { createQuestOwnerAuth } from '@/modules/quest/main/quest-owner-auth';

export function createQuestIpcModule(devices: QuestDeviceService, headsets: QuestHeadsets, broadcast: IpcBroadcast, secrets: SecretStore) {
   const owner = createQuestOwnerAuth(secrets);
   const chooser = createQuestBluetoothChooser((found) => broadcast(questIpc.onBluetoothDevices, found));

   return defineIpcHandlers<typeof questIpc, IpcMainInvokeEvent>(questIpc, {
      getConnectionStatus: () => {
         devices.start();
         if (!devices.listTargets().some((target) => target.status === 'ready')) void devices.refresh();
         return devices.getConnectionStatus();
      },
      getHostStatus: async () => {
         const [pluggedIn, bluetooth] = await Promise.all([questPluggedIn(), readBluetoothPower()]);
         return { questPluggedIn: pluggedIn, bluetooth };
      },
      turnOnBluetooth: () => turnOnBluetooth(),
      connectWireless: async (request) => (await devices.connectWireless(request)).tap(() => headsets.accept()),
      disconnectWireless: async ({ targetId }) => {
         headsets.hold(targetId);
         const disabled = await devices.disableWireless(targetId);
         if (Result.isError(disabled)) headsets.unhold(targetId);
         return disabled;
      },
      enableWireless: (request) => devices.enableWireless(request),
      installCompanion: ({ targetId }) => devices.installCompanion(targetId),
      ownerSignedIn: () => owner.signedIn(),
      startOwnerSignIn: () => owner.start(),
      openOwnerSignIn: async () => {
         const url = owner.verificationUrl();
         if (url) await shell.openExternal(url);
      },
      waitForOwner: () => owner.wait(),
      cancelOwnerSignIn: () => owner.cancel(),
      signOutOwner: () => owner.signOut(),
      proveOwner: ({ challenge }) => owner.prove(challenge),
      recoverBluetoothService: async () => {
         const address = chooser.selected();
         return process.platform === 'linux' && address !== null && (await recoverLinuxCompanionService(address));
      },
      selectBluetoothDevice: ({ deviceId }) => chooser.select(deviceId),
      pairWireless: async (request) => (await devices.pairWireless(request)).tap(() => headsets.accept()),
      refreshHeadsets: async () => {
         devices.start();
         await headsets.retry();
         await devices.refresh();
      },
      forgetHeadset: async ({ targetId }) => (await headsets.forget(targetId)).map(() => null)
   });
}
