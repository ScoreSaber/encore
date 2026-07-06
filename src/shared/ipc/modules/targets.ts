import { defineIpcCommand, defineIpcEvent, defineIpcModule, defineIpcQuery } from '@/shared/ipc/core';
import type { InstallSummary, StoreDetectionSnapshot, Target, TargetEvent, TargetHealth, TargetId } from '@/shared/targets';

export type TargetIdRequest = {
   targetId: TargetId;
};

export const targetListQuery = defineIpcQuery<'targets:list', Target[]>('targets:list');
export const targetInstallsQuery = defineIpcQuery<'targets:installs', InstallSummary[], TargetIdRequest>('targets:installs');
export const targetHealthQuery = defineIpcQuery<'targets:health', TargetHealth | null, TargetIdRequest>('targets:health');
export const targetStoreDetectionQuery = defineIpcQuery<'targets:store-detection', StoreDetectionSnapshot | null, TargetIdRequest>(
   'targets:store-detection'
);
export const targetStoreRescanCommand = defineIpcCommand<'targets:store-rescan', StoreDetectionSnapshot | null, TargetIdRequest>(
   'targets:store-rescan'
);
export const targetChangedEvent = defineIpcEvent<'targets:changed', TargetEvent>('targets:changed');

export const targetsIpcModule = defineIpcModule({
   name: 'targets',
   commands: [targetStoreRescanCommand],
   queries: [targetListQuery, targetInstallsQuery, targetHealthQuery, targetStoreDetectionQuery],
   events: [targetChangedEvent]
} as const);
