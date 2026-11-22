import { defineIpc, request, event, type IpcResult } from '@/ipc/core';
import {
   questBluetoothSelectionSchema,
   questEnableWirelessRequestSchema,
   questLocalPairingSchema,
   questOwnerChallengeSchema,
   questPairingRequestSchema,
   questWirelessRequestSchema,
   type QuestBluetoothDevice,
   type QuestConnectionStatus,
   type QuestHostStatus,
   type QuestOwnerSignIn,
   type QuestWirelessResult,
   type QuestWirelessSettingsPage
} from '@/modules/quest/contract';
import { targetIdRequestSchema } from '@/modules/targets/contract';

export const questIpc = defineIpc('quest', {
   getConnectionStatus: request().returns<QuestConnectionStatus>(),
   getHostStatus: request().returns<QuestHostStatus>(),
   turnOnBluetooth: request().returns<boolean>(),
   connectWireless: request(questWirelessRequestSchema).returns<QuestWirelessResult>(),
   disconnectWireless: request(targetIdRequestSchema).returns<QuestWirelessResult>(),
   enableWireless: request(questEnableWirelessRequestSchema).returns<QuestWirelessResult>(),
   installCompanion: request(targetIdRequestSchema).returns<IpcResult<null>>(),
   ownerSignedIn: request().returns<boolean>(),
   startOwnerSignIn: request().returns<IpcResult<QuestOwnerSignIn>>(),
   openOwnerSignIn: request(),
   waitForOwner: request().returns<IpcResult<null>>(),
   signOutOwner: request(),
   cancelOwnerSignIn: request(),
   proveOwner: request(questOwnerChallengeSchema).returns<IpcResult<number[]>>(),
   onBluetoothDevices: event<QuestBluetoothDevice[]>(),
   recoverBluetoothService: request().returns<boolean>(),
   selectBluetoothDevice: request(questBluetoothSelectionSchema),
   pairWireless: request(questPairingRequestSchema).returns<QuestWirelessResult>(),
   refreshHeadsets: request(),
   forgetHeadset: request(targetIdRequestSchema).returns<IpcResult<null>>()
});

export const questLocalIpc = defineIpc('questLocal', {
   openWirelessSettings: request().returns<IpcResult<QuestWirelessSettingsPage>>(),
   pair: request(questLocalPairingSchema).returns<IpcResult<null>>()
});
