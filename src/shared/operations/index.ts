export type OperationId = string;

export type OperationSerializable =
   | string
   | number
   | boolean
   | null
   | readonly OperationSerializable[]
   | { readonly [key: string]: OperationSerializable | undefined };

export type OperationKind = 'import' | 'download' | 'copy' | 'verification' | 'launch-preparation' | 'receiver-command' | 'demo';

export type OperationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type OperationProgress = {
   phase?: string;
   label?: string;
   current?: number;
   total?: number;
   percent?: number;
   unit?: 'bytes' | 'files' | 'items' | 'steps';
};

export type OperationTarget = {
   kind: 'local' | 'remote';
   id?: string;
   name?: string;
   platform?: NodeJS.Platform | 'unknown';
};

export type OperationError = {
   code: string;
   message: string;
   details?: OperationSerializable;
};

export type OperationSnapshot = {
   id: OperationId;
   kind: OperationKind;
   status: OperationStatus;
   title: string;
   message?: string;
   target?: OperationTarget;
   progress?: OperationProgress;
   cancelable: boolean;
   metadata?: OperationSerializable;
   result?: OperationSerializable;
   error?: OperationError;
   createdAt: string;
   updatedAt: string;
   completedAt?: string;
};

export type OperationEvent = {
   type: 'snapshot';
   snapshot: OperationSnapshot;
};

export type OperationCancelRequest = {
   id: OperationId;
};

export type OperationCancelResult =
   | {
        ok: true;
        status: 'cancelled';
        operation: OperationSnapshot;
     }
   | {
        ok: true;
        status: 'noop';
        reason: 'already-finished' | 'not-cancelable' | 'not-found';
        id: OperationId;
        operation?: OperationSnapshot;
     }
   | {
        ok: false;
        status: 'failed';
        id: OperationId;
        operation?: OperationSnapshot;
        error: OperationError;
     };

export type OperationDemoStartRequest = {
   outcome?: 'complete' | 'fail';
   steps?: number;
   intervalMs?: number;
};

export type OperationDemoStartResult =
   | {
        ok: true;
        operation: OperationSnapshot;
     }
   | {
        ok: false;
        error: OperationError;
     };

export const terminalOperationStatuses: readonly OperationStatus[] = ['completed', 'failed', 'cancelled'];

export function isOperationTerminalStatus(status: OperationStatus) {
   return terminalOperationStatuses.includes(status);
}
