import type { IpcResult } from '@/app/ipc/core';
import type { Target, TargetId } from '@/modules/targets/contract';

export type ReceiverStatus = 'disabled' | 'starting' | 'running' | 'stopped' | 'error';

export type ReceiverListenAddress = {
   host: string;
   port: number;
   url: string;
   interfaceName: string;
};

export type ReceiverInterfaceOption = {
   host: string;
   interfaceName: string;
};

export type ReceiverPairingSession = {
   code: string;
   expiresAt: string;
   attemptsRemaining: number;
};

export type ReceiverIdentityState = {
   fingerprint: string;
   persisted: boolean;
};

export type ReceiverSecureStorageState = {
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

export type ReceiverRemoteForgetResult = IpcResult<TargetId>;
