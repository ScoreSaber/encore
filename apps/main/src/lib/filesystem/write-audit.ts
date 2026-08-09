import { randomUUID } from 'node:crypto';

export type FilesystemWriteAction = 'copy' | 'move' | 'delete' | 'link' | 'unlink' | 'json-write';
export type FilesystemWriteScope = 'install-root' | 'install' | 'content' | 'settings' | 'cache';
export type WriteAuditStatus = 'started' | 'completed' | 'failed' | 'cancelled';

export type WriteAuditError = {
   code: string;
   message: string;
   details?: string | object | null;
};

export type WriteAuditEntry = {
   id: string;
   action: FilesystemWriteAction;
   scope: FilesystemWriteScope;
   status: WriteAuditStatus;
   targetPath: string;
   sourcePath?: string;
   operationId?: string;
   startedAt: string;
   completedAt?: string;
   bytes?: number;
   files?: number;
   error?: WriteAuditError;
};

export type WriteAuditSink = (entry: WriteAuditEntry) => void | Promise<void>;

export type WriteAuditStartInput = {
   action: FilesystemWriteAction;
   scope: FilesystemWriteScope;
   targetPath: string;
   sourcePath?: string;
   operationId?: string;
};

export type WriteAuditFinishInput = {
   status: Exclude<WriteAuditStatus, 'started'>;
   bytes?: number;
   files?: number;
   error?: WriteAuditError;
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
