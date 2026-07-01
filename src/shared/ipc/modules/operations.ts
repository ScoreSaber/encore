import { defineIpcCommand, defineIpcEvent, defineIpcModule, defineIpcQuery } from '@/shared/ipc/core';
import type {
   OperationCancelRequest,
   OperationCancelResult,
   OperationDemoStartRequest,
   OperationDemoStartResult,
   OperationEvent,
   OperationSnapshot
} from '@/shared/operations';

export const operationListQuery = defineIpcQuery<'operations:list', OperationSnapshot[]>('operations:list');
export const operationCancelCommand = defineIpcCommand<'operations:cancel', OperationCancelResult, OperationCancelRequest>('operations:cancel');
export const operationDemoStartCommand = defineIpcCommand<'operations:start-demo', OperationDemoStartResult, OperationDemoStartRequest>(
   'operations:start-demo'
);
export const operationSnapshotEvent = defineIpcEvent<'operations:snapshot', OperationEvent>('operations:snapshot');

export const operationsIpcModule = defineIpcModule({
   name: 'operations',
   commands: [operationCancelCommand, operationDemoStartCommand],
   queries: [operationListQuery],
   events: [operationSnapshotEvent]
} as const);
