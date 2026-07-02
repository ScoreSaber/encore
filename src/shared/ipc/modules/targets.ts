import { defineIpcEvent, defineIpcModule, defineIpcQuery } from '@/shared/ipc/core';
import type { InstallSummary, Target, TargetEvent, TargetHealth, TargetId } from '@/shared/targets';

export type TargetIdRequest = {
   targetId: TargetId;
};

export const targetListQuery = defineIpcQuery<'targets:list', Target[]>('targets:list');
export const targetInstallsQuery = defineIpcQuery<'targets:installs', InstallSummary[], TargetIdRequest>('targets:installs');
export const targetHealthQuery = defineIpcQuery<'targets:health', TargetHealth | null, TargetIdRequest>('targets:health');
export const targetChangedEvent = defineIpcEvent<'targets:changed', TargetEvent>('targets:changed');

export const targetsIpcModule = defineIpcModule({
   name: 'targets',
   commands: [],
   queries: [targetListQuery, targetInstallsQuery, targetHealthQuery],
   events: [targetChangedEvent]
} as const);
