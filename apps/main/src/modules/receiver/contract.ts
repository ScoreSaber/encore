import type { IpcResult } from '@/ipc/core';
import { receiverPairingCodeSchema } from '@/modules/receiver/protocol';
import type { Target, TargetId } from '@/modules/targets/contract';

type ReceiverStatus = 'disabled' | 'starting' | 'running' | 'stopped' | 'error';

export type ReceiverListenAddress = {
   host: string;
   port: number;
   url: string;
   interfaceName: string;
};

type ReceiverInterfaceOption = {
   host: string;
   interfaceName: string;
};

export type ReceiverPairingSession = {
   code: string;
   expiresAt: string;
   attemptsRemaining: number;
};

type ReceiverIdentityState = {
   fingerprint: string;
   persisted: boolean;
};

type ReceiverSecureStorageState = {
   available: boolean;
   reason?: string;
};

export type ReceiverState = {
   enabled: boolean;
   status: ReceiverStatus;
   addresses: ReceiverListenAddress[];
   interfaces: ReceiverInterfaceOption[];
   pairing: ReceiverPairingSession | null;
   identity: ReceiverIdentityState | null;
   secureStorage: ReceiverSecureStorageState;
   connectedDevices: string[];
   message?: string;
};

export type ReceiverPairingResult = IpcResult<ReceiverPairingSession>;
export type ReceiverActionResult = IpcResult<ReceiverState>;

export type ReceiverRemotePairRequest = {
   host: string;
   pairingCode: string;
   deviceName: string;
};

export type ReceiverRemotePairResult = IpcResult<Target>;

export type ReceiverRemoteForgetResult = IpcResult<TargetId>;

const pairingLinkBase = 'encore://pair';

export function pairingLink(host: string, code: string) {
   const link = new URL(pairingLinkBase);
   link.searchParams.set('host', host);
   link.searchParams.set('code', code);
   return link.toString();
}

export function readPairingLink(text: string) {
   if (!text.startsWith(`${pairingLinkBase}?`)) return null;
   const params = new URL(text).searchParams;
   const host = params.get('host')?.trim();
   const code = receiverPairingCodeSchema.safeParse(params.get('code'));
   return host && code.success ? { host, code: code.data } : null;
}
