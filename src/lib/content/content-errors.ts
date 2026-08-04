import type { Err, Ok } from 'better-result';

import type { IpcFailureResult } from '@/app/ipc/core';
import type { ContentProblem } from '@/lib/content/contract';
import type { FilesystemProblem } from '@/lib/filesystem/path';
import type { InstallId } from '@/modules/installs/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

export type ContentResult<T> = Ok<T, ContentProblem> | Err<T, ContentProblem>;

export function createContentFailure<Issue extends string>(domain: string, messages: Record<Issue, string>) {
   return (installId: InstallId, issue: Issue, detail?: string): IpcFailureResult => ({
      ok: false,
      error: {
         code: `${domain}.${issue}`,
         message: messages[issue],
         details: { installId, detail }
      }
   });
}

export function createOperationFailure(operations: OperationRegistry) {
   return (operationId: string, problem: FilesystemProblem) => {
      operations.fail(operationId, {
         code: problem.code,
         message: problem.message,
         details: { path: problem.path, detail: problem.detail }
      });
   };
}
