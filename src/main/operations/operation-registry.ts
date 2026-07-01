import { Result } from 'better-result';

import type {
   OperationCancelResult,
   OperationError,
   OperationEvent,
   OperationId,
   OperationKind,
   OperationProgress,
   OperationSerializable,
   OperationSnapshot,
   OperationStatus,
   OperationTarget
} from '@/shared/operations';
import { isOperationTerminalStatus } from '@/shared/operations';

type OperationCancelHandler = () => void | Promise<void>;
type OperationListener = (event: OperationEvent) => void;

type OperationRecord = {
   snapshot: OperationSnapshot;
   cancel?: OperationCancelHandler;
};

type CreateOperationInput = {
   id?: OperationId;
   kind: OperationKind;
   title: string;
   message?: string;
   target?: OperationTarget;
   progress?: OperationProgress;
   cancelable?: boolean;
   metadata?: OperationSerializable;
   cancel?: OperationCancelHandler;
};

type OperationUpdate = {
   title?: string;
   message?: string;
   progress?: OperationProgress;
   metadata?: OperationSerializable;
   cancelable?: boolean;
   result?: OperationSerializable;
   error?: OperationError;
};

export type OperationRegistry = ReturnType<typeof createOperationRegistry>;

let nextOperationNumber = 0;

export function createOperationRegistry() {
   const operations = new Map<OperationId, OperationRecord>();
   const listeners = new Set<OperationListener>();

   function create(input: CreateOperationInput) {
      const now = new Date().toISOString();
      const id = input.id ?? createOperationId();

      if (operations.has(id)) {
         throw new Error(`Duplicate operation id "${id}"`);
      }

      const snapshot: OperationSnapshot = {
         id,
         kind: input.kind,
         status: 'running',
         title: input.title,
         message: input.message,
         target: input.target,
         progress: input.progress,
         cancelable: input.cancelable ?? Boolean(input.cancel),
         metadata: input.metadata,
         createdAt: now,
         updatedAt: now
      };

      operations.set(id, {
         snapshot,
         cancel: input.cancel
      });
      emitSnapshot(snapshot);
      return snapshot;
   }

   function update(id: OperationId, update: OperationUpdate) {
      const record = operations.get(id);
      if (!record || isOperationTerminalStatus(record.snapshot.status)) return record?.snapshot;

      return replaceSnapshot(record, {
         ...record.snapshot,
         ...update,
         updatedAt: new Date().toISOString()
      });
   }

   function complete(id: OperationId, result?: OperationSerializable) {
      return finish(id, 'completed', {
         result,
         cancelable: false
      });
   }

   function fail(id: OperationId, error: OperationError) {
      return finish(id, 'failed', {
         error,
         cancelable: false
      });
   }

   async function cancel(id: OperationId): Promise<OperationCancelResult> {
      const record = operations.get(id);
      if (!record) {
         return {
            ok: true,
            status: 'noop',
            reason: 'not-found',
            id
         };
      }

      if (isOperationTerminalStatus(record.snapshot.status)) {
         return {
            ok: true,
            status: 'noop',
            reason: 'already-finished',
            id,
            operation: record.snapshot
         };
      }

      if (!record.snapshot.cancelable) {
         return {
            ok: true,
            status: 'noop',
            reason: 'not-cancelable',
            id,
            operation: record.snapshot
         };
      }

      const cancelOperation = record.cancel;
      if (cancelOperation) {
         const cancelResult = await Result.tryPromise({
            try: () => Promise.resolve(cancelOperation()),
            catch: (cause) => createOperationError('operations.cancel.failed', 'failed to cancel operation', cause)
         });

         if (Result.isError(cancelResult)) {
            return {
               ok: false,
               status: 'failed',
               id,
               operation: record.snapshot,
               error: cancelResult.error
            };
         }
      }

      const now = new Date().toISOString();
      const snapshot = replaceSnapshot(record, {
         ...record.snapshot,
         status: 'cancelled',
         cancelable: false,
         updatedAt: now,
         completedAt: now
      });

      return {
         ok: true,
         status: 'cancelled',
         operation: snapshot
      };
   }

   function list() {
      return [...operations.values()].map(({ snapshot }) => snapshot);
   }

   function subscribe(listener: OperationListener) {
      listeners.add(listener);
      return () => {
         listeners.delete(listener);
      };
   }

   function finish(id: OperationId, status: Extract<OperationStatus, 'completed' | 'failed'>, update: OperationUpdate) {
      const record = operations.get(id);
      if (!record || isOperationTerminalStatus(record.snapshot.status)) return record?.snapshot;

      const now = new Date().toISOString();
      return replaceSnapshot(record, {
         ...record.snapshot,
         ...update,
         status,
         updatedAt: now,
         completedAt: now
      });
   }

   function replaceSnapshot(record: OperationRecord, snapshot: OperationSnapshot) {
      record.snapshot = snapshot;
      emitSnapshot(snapshot);
      return snapshot;
   }

   function emitSnapshot(snapshot: OperationSnapshot) {
      const event: OperationEvent = {
         type: 'snapshot',
         snapshot
      };

      for (const listener of listeners) {
         listener(event);
      }
   }

   return {
      create,
      update,
      complete,
      fail,
      cancel,
      list,
      subscribe
   };
}

function createOperationId(): OperationId {
   nextOperationNumber += 1;
   return `op_${Date.now().toString(36)}_${nextOperationNumber.toString(36)}`;
}

function createOperationError(code: string, message: string, cause: unknown): OperationError {
   if (cause instanceof Error) {
      return {
         code,
         message: `${message}: ${cause.message}`
      };
   }

   return {
      code,
      message: `${message}: ${String(cause)}`
   };
}
