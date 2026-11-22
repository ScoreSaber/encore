import { z } from 'zod';

import type { IpcResult } from '@/ipc/core';
import { adbEndpointSchema } from '@/lib/android/adb-endpoint';

export const beatSaberPackageId = 'com.beatgames.beatsaber';
export const encorePackageId = 'com.scoresaber.encore';
export const questInstallId = 'beat-saber';
export const companionServiceUuid = '0000feb8-0000-1000-8000-00805f9b34fb';
export const companionCharacteristicUuid = '7a442881-509c-47fa-ac02-b06a37d9eb76';

export const questStateSchema = z.object({ modded: z.boolean(), savedPlayerData: z.boolean(), companionInstalled: z.boolean() });
export type QuestState = z.infer<typeof questStateSchema>;

export const questWirelessRequestSchema = z.object({ endpoint: adbEndpointSchema });
export const questEnableWirelessRequestSchema = z.object({ targetId: z.string().min(1), port: z.int().min(1).max(65_535).default(5555) });

export const questOwnerChallengeSchema = z.object({ challenge: z.array(z.int().min(0).max(255)).min(1).max(256) });
export const questBluetoothSelectionSchema = z.object({ deviceId: z.string().min(1).max(200).nullable() });
export const questPairingRequestSchema = z.object({
   host: z.string().regex(/^[\d.]+$|^[\da-f:]+$/i),
   pairingPort: z.int().min(1).max(65_535),
   pairingCode: z.string().regex(/^\d{6}$/),
   connectionPort: z.int().min(1).max(65_535).nullable()
});
export const questLocalPairingSchema = z.object({
   code: z.string().regex(/^\d{6}$/)
});
export const questWirelessSettingsPageSchema = z.enum(['developer-options', 'app-info']);

export type QuestWirelessRequest = z.infer<typeof questWirelessRequestSchema>;
export type QuestPairingRequest = z.infer<typeof questPairingRequestSchema>;
export type QuestLocalPairing = z.infer<typeof questLocalPairingSchema>;
export type QuestWirelessSettingsPage = z.infer<typeof questWirelessSettingsPageSchema>;
export type QuestBluetoothDevice = { deviceId: string; name: string };
export type QuestOwnerSignIn = { userCode: string; verificationUrl: string; expiresAt: number };
export type QuestEnableWirelessRequest = z.infer<typeof questEnableWirelessRequestSchema>;
export type QuestWirelessResult = IpcResult<{ endpoint: string }>;
export type QuestBluetoothPower = 'on' | 'off' | 'missing' | 'unknown';
export type QuestHostStatus = { questPluggedIn: boolean; bluetooth: QuestBluetoothPower };
export type QuestConnectionStatus = { adbReady: boolean; error: { code: string; message: string } | null };
