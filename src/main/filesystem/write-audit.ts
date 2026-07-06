import type { FilesystemWriteAction, FilesystemWriteScope, WriteAuditEntry, WriteAuditStatus } from '@/shared/filesystem';
import type { OperationError, OperationId } from '@/shared/operations';

import { randomUUID } from 'node:crypto';

export type WriteAuditSink = (entry: WriteAuditEntry) => void | Promise<void>;

export type WriteAuditStartInput = {
   action: FilesystemWriteAction;
   scope: FilesystemWriteScope;
   targetPath: string;
   sourcePath?: string;
   operationId?: OperationId;
};

export type WriteAuditFinishInput = {
   status: Exclude<WriteAuditStatus, 'started'>;
   bytes?: number;
   files?: number;
   error?: OperationError;
};

export function createWriteAuditEntry(input: WriteAuditStartInput): WriteAuditEntry {
   return {
      id: `fs_audit_${randomUUID()}`,
      action: input.action,
      scope: input.scope,
      status: 'started',
      targetPath: input.targetPath,
      sourcePath: input.sourcePath,
      operationId: input.operationId,
      startedAt: new Date().toISOString()
   };
}

export function finishWriteAuditEntry(entry: WriteAuditEntry, input: WriteAuditFinishInput): WriteAuditEntry {
   return {
      ...entry,
      status: input.status,
      completedAt: new Date().toISOString(),
      bytes: input.bytes,
      files: input.files,
      error: input.error
   };
}

export function createMemoryWriteAuditLog() {
   const entries: WriteAuditEntry[] = [];

   return {
      write: (entry: WriteAuditEntry) => {
         entries.push(entry);
      },
      list: () => [...entries]
   };
}
