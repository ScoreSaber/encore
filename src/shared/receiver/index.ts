import type { IpcResult } from '@/shared/ipc/core';
import type { Target } from '@/shared/targets';

export type ReceiverStatus = 'disabled' | 'starting' | 'running' | 'stopped' | 'error';

export type ReceiverListenAddress = {
   host: string;
   port: number;
   url: string;
   interfaceName: string;
};

export type ReceiverPairingSession = {
   code: string;
   expiresAt: string;
};

export type ReceiverState = {
   enabled: boolean;
   status: ReceiverStatus;
   addresses: ReceiverListenAddress[];
   pairing: ReceiverPairingSession | null;
   message?: string;
};

export type ReceiverPairingResult = IpcResult<ReceiverPairingSession>;
export type ReceiverActionResult = IpcResult<ReceiverState>;

export type ReceiverDeviceRequest = {
   deviceId: string;
};

export type ReceiverRenameDeviceRequest = ReceiverDeviceRequest & {
   name: string;
};

export type ReceiverRemotePairRequest = {
   host: string;
   pairingCode: string;
   deviceName: string;
};

export type ReceiverRemotePairResult = IpcResult<Target>;

export type ReceiverRemoteDisconnectResult = IpcResult<Target>;

export * from '@/shared/receiver/protocol';
