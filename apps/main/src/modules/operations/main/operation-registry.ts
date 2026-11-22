import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import type {
   OperationCancelResult,
   OperationError,
   OperationId,
   OperationKind,
   OperationProgress,
   OperationSerializable,
   OperationSnapshot,
   OperationStatus
} from '@/modules/operations/contract';
import { isOperationTerminalStatus } from '@/modules/operations/contract';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

type OperationCancelHandler = () => void | Promise<void>;
type OperationListener = (snapshot: OperationSnapshot) => void;
type TargetOperationListener = (targetId: TargetId, snapshot: OperationSnapshot) => void;

type OperationPhase =
   | { status: 'running'; cancel?: OperationCancelHandler }
   | { status: 'cancelling'; settled: Promise<OperationCancelResult> }
   | { status: 'terminal' };

type OperationRecord = {
   targetId: TargetId;
   snapshot: OperationSnapshot;
   phase: OperationPhase;
};

export type CreateOperationInput = {
   id?: OperationId;
   kind: OperationKind;
   targetId?: TargetId;
   title: string;
   message?: string;
   progress?: OperationProgress;
   cancelable?: boolean;
   metadata?: OperationSerializable;
   cancel?: OperationCancelHandler;
};

type OperationJob = {
   signal: AbortSignal;
   cancel: OperationCancelHandler;
   release?: () => void;
};

type OperationFailure = Problem & { readonly [field: string]: OperationSerializable | undefined };

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

const maxTerminalOperations = 200;
let nextOperationNumber = 0;

export function createOperationRegistry() {
   const operations = new Map<OperationId, OperationRecord>();
   const listeners = new Set<TargetOperationListener>();
   let disposed = false;

   function create(input: CreateOperationInput): OperationSnapshot {
      const now = new Date().toISOString();
      const { id: inputId, targetId = localTargetId, cancel, cancelable = Boolean(cancel), ...details } = input;
      let id = inputId;
      if (!id) {
         nextOperationNumber += 1;
         id = `op_${Date.now().toString(36)}_${nextOperationNumber.toString(36)}`;
      }

      if (operations.has(id)) {
         throw new Error(`Duplicate operation id "${id}"`);
      }

      if (disposed) {
         return {
            ...details,
            id,
            status: 'cancelled',
            cancelable: false,
            createdAt: now,
            updatedAt: now,
            completedAt: now
         };
      }

      const snapshot: OperationSnapshot = {
         ...details,
         id,
         status: 'running',
         cancelable,
         createdAt: now,
         updatedAt: now
      };

      operations.set(id, { targetId, snapshot, phase: { status: 'running', cancel } });
      emitSnapshot(targetId, snapshot);
      return snapshot;
   }

   function start<Settled>(
      input: Omit<CreateOperationInput, 'cancel'>,
      run: (id: OperationId, signal: AbortSignal) => Promise<Settled>,
      job?: OperationJob
   ) {
      const controller = new AbortController();
      const { signal, cancel, release } = job ?? { signal: controller.signal, cancel: () => controller.abort() };
      if (disposed) {
         release?.();
         return create({ ...input, cancelable: false });
      }
      const operation = create({ ...input, cancel });
      void Result.tryPromise({ try: () => run(operation.id, signal), catch: (cause) => createProblem('operations.failed', { cause }) })
         .then((ran) => {
            if (Result.isError(ran)) fail(operation.id, ran.error);
         })
         .finally(release);
      return operation;
   }

   function update(id: OperationId, update: OperationUpdate) {
      const record = operations.get(id);
      if (!record || record.phase.status === 'terminal') return record?.snapshot;

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

   function fail(id: OperationId, { code, message, ...details }: OperationFailure) {
      const error: OperationError = { code, message };
      if (Object.keys(details).length > 0) error.details = details;

      return finish(id, 'failed', {
         error,
         cancelable: false
      });
   }

   function cancel(request: { id: OperationId }) {
      return cancelForTarget(localTargetId, request);
   }

   async function cancelForTarget(targetId: TargetId, { id }: { id: OperationId }): Promise<OperationCancelResult> {
      const record = operations.get(id);
      if (!record || record.targetId !== targetId) {
         return {
            ok: true,
            status: 'noop',
            reason: 'not-found',
            id
         };
      }

      if (record.phase.status === 'terminal') {
         return {
            ok: true,
            status: 'noop',
            reason: 'already-finished',
            id,
            operation: record.snapshot
         };
      }

      if (record.phase.status === 'cancelling') {
         return record.phase.settled;
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

      const cancelOperation = record.phase.cancel;
      const settled = (async (): Promise<OperationCancelResult> => {
         if (cancelOperation) {
            const cancelResult = await Result.tryPromise({
               try: () => Promise.resolve(cancelOperation()),
               catch: (cause) => createProblem('operations.cancel.failed', { cause })
            });

            if (Result.isError(cancelResult)) {
               if (record.phase.status === 'cancelling') {
                  record.phase = { status: 'running', cancel: cancelOperation };
               }
               return {
                  ok: false,
                  status: 'failed',
                  id,
                  operation: record.snapshot,
                  error: cancelResult.error
               };
            }
         }

         if (record.phase.status === 'terminal' || isOperationTerminalStatus(record.snapshot.status)) {
            return {
               ok: true,
               status: 'noop',
               reason: 'already-finished',
               id,
               operation: record.snapshot
            };
         }

         const now = new Date().toISOString();
         const snapshot = replaceSnapshot(record, {
            ...record.snapshot,
            status: 'cancelled',
            cancelable: false,
            updatedAt: now,
            completedAt: now
         });
         pruneTerminalOperations();

         return {
            ok: true,
            status: 'cancelled',
            operation: snapshot
         };
      })();

      record.phase = { status: 'cancelling', settled };
      return settled;
   }

   function list() {
      return listForTarget(localTargetId);
   }

   function listForTarget(targetId: TargetId) {
      return [...operations.values()].filter((record) => record.targetId === targetId).map(({ snapshot }) => snapshot);
   }

   function uncancelable() {
      return [...operations.values()]
         .map(({ snapshot }) => snapshot)
         .filter((snapshot) => !snapshot.cancelable && !isOperationTerminalStatus(snapshot.status));
   }

   async function dispose() {
      disposed = true;
      const running = [...operations.values()].filter((record) => record.snapshot.cancelable && record.phase.status !== 'terminal');

      await Promise.all(
         running.map(async (record) => {
            const cancelOperation = record.phase.status === 'running' ? record.phase.cancel : undefined;
            if (cancelOperation) {
               await Result.tryPromise({
                  try: () => Promise.resolve(cancelOperation()),
                  catch: (cause) => cause
               });
            }

            if (record.phase.status === 'terminal') return;

            const now = new Date().toISOString();
            record.phase = { status: 'terminal' };
            record.snapshot = {
               ...record.snapshot,
               status: 'cancelled',
               cancelable: false,
               updatedAt: now,
               completedAt: now
            };
         })
      );

      listeners.clear();
      operations.clear();
   }

   function subscribe(listener: OperationListener) {
      return subscribeTargets((targetId, snapshot) => {
         if (targetId === localTargetId) listener(snapshot);
      });
   }

   function subscribeTargets(listener: TargetOperationListener) {
      listeners.add(listener);
      return () => {
         listeners.delete(listener);
      };
   }

   function finish(id: OperationId, status: Extract<OperationStatus, 'completed' | 'failed'>, update: OperationUpdate) {
      const record = operations.get(id);
      if (!record || record.phase.status === 'terminal') return record?.snapshot;

      const now = new Date().toISOString();
      const snapshot = replaceSnapshot(record, {
         ...record.snapshot,
         ...update,
         status,
         updatedAt: now,
         completedAt: now
      });
      pruneTerminalOperations();
      return snapshot;
   }

   function replaceSnapshot(record: OperationRecord, snapshot: OperationSnapshot) {
      record.snapshot = snapshot;
      if (isOperationTerminalStatus(snapshot.status)) {
         record.phase = { status: 'terminal' };
         operations.delete(snapshot.id);
         operations.set(snapshot.id, record);
      }
      emitSnapshot(record.targetId, snapshot);
      return snapshot;
   }

   function pruneTerminalOperations() {
      const terminal = [...operations.entries()].filter(([, record]) => isOperationTerminalStatus(record.snapshot.status)).map(([id]) => id);

      for (const id of terminal.slice(0, -maxTerminalOperations)) {
         operations.delete(id);
      }
   }

   function emitSnapshot(targetId: TargetId, snapshot: OperationSnapshot) {
      for (const listener of listeners) {
         listener(targetId, snapshot);
      }
   }

   return {
      create,
      start,
      update,
      complete,
      fail,
      cancel,
      cancelForTarget,
      list,
      listForTarget,
      subscribe,
      subscribeTargets,
      uncancelable,
      dispose
   };
}
