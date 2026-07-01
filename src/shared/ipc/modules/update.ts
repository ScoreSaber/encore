import { defineIpcCommand, defineIpcEvent, defineIpcModule, defineIpcQuery } from '@/shared/ipc/core';

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export type UpdateSnapshot = {
   status: UpdateStatus;
   version?: string;
   percent?: number;
   message?: string;
};

export const updateInfoQuery = defineIpcQuery<'update:info', UpdateSnapshot>('update:info');
export const updateCheckCommand = defineIpcCommand<'update:check', UpdateSnapshot>('update:check');
export const updateInstallCommand = defineIpcCommand<'update:install', UpdateSnapshot>('update:install');
export const updateStatusEvent = defineIpcEvent<'update:status', UpdateSnapshot>('update:status');

export const updateIpcModule = defineIpcModule({
   name: 'update',
   commands: [updateCheckCommand, updateInstallCommand],
   queries: [updateInfoQuery],
   events: [updateStatusEvent]
} as const);
