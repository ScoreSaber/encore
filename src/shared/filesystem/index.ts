import type { OperationError, OperationId } from '@/shared/operations';

export type FilesystemWriteAction = 'copy' | 'move' | 'delete' | 'link' | 'unlink' | 'json-write';

export type FilesystemWriteScope = 'install-root' | 'install' | 'content' | 'settings' | 'cache';

export type FilesystemPathKind = 'file' | 'directory' | 'link' | 'other';

export type WriteAuditStatus = 'started' | 'completed' | 'failed' | 'cancelled';

export type WriteAuditEntry = {
   id: string;
   action: FilesystemWriteAction;
   scope: FilesystemWriteScope;
   status: WriteAuditStatus;
   targetPath: string;
   sourcePath?: string;
   operationId?: OperationId;
   startedAt: string;
   completedAt?: string;
   bytes?: number;
   files?: number;
   error?: OperationError;
};
