import { Result } from 'better-result';

import type { IpcError, IpcFailureResult } from '@/app/ipc/core';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import type { FilesystemProblem } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import {
   installColorSchema,
   installNameSchema,
   invalidInstallAction,
   type InstallActionIssue,
   type InstallDeletePreview,
   type InstallForgetPreview,
   type InstallForgetResult,
   type InstallOperationResult,
   type InstallUpdateRequest,
   type InstallUpdateResult
} from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

import { dirname } from 'node:path';

const actionIssueMessages: Record<InstallActionIssue, string> = {
   'inspect-failed': 'the install folder could not be inspected',
   'invalid-color': 'the colour is not a hex colour Encore can store',
   'invalid-name': 'the name has to be between 1 and 60 characters',
   'not-found': 'the install is not in the registry anymore',
   'store-detected': 'Steam and Oculus installs stay in the list while the store still has them',
   'store-owned': 'Steam and Oculus own these files, remove the install from the store instead',
   'unsupported-target': 'this target cannot manage installs'
};

type InstallManagementOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
};

type ReadyDeletePreview = Extract<InstallDeletePreview, { status: 'ok' }>;

export type InstallManagementService = ReturnType<typeof createInstallManagementService>;

export function createInstallManagementService(options: InstallManagementOptions) {
   const list = options.registry.list;
   const getDetail = ({ installId }: { installId: string }) => options.registry.get(installId);
   const rescan = options.registry.rescan;

   async function update(request: Omit<InstallUpdateRequest, 'targetId'>): Promise<InstallUpdateResult> {
      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'not-found');

      const name = request.name === undefined ? null : installNameSchema.safeParse(request.name);
      if (name && !name.success) return failure(request.installId, 'invalid-name');

      const color = request.color === undefined || request.color === null ? null : installColorSchema.safeParse(request.color);
      if (color && !color.success) return failure(request.installId, 'invalid-color');

      const updated = await options.registry.update(request.installId, {
         ...(name ? { name: name.data } : {}),
         ...(request.color === undefined ? {} : { color: color ? color.data : null })
      });
      if (Result.isError(updated)) return { ok: false, error: toIpcError(updated.error) };

      return updated.value ? { ok: true, value: updated.value } : failure(request.installId, 'not-found');
   }

   async function previewDelete({ installId }: { installId: string }): Promise<InstallDeletePreview> {
      const install = await options.registry.get(installId);
      if (!install) return invalid(installId, 'not-found');
      if (install.source === 'store') return invalid(installId, 'store-owned');

      const size = await getDirectorySize(install.path);
      if (Result.isError(size) && size.error.detail !== 'ENOENT') return invalid(installId, 'inspect-failed', size.error.detail);

      return {
         status: 'ok',
         installId,
         name: install.name,
         path: install.path,
         source: install.source,
         sizeBytes: Result.isOk(size) ? size.value.bytes : 0,
         fileCount: Result.isOk(size) ? size.value.files : 0
      };
   }

   async function deleteInstall({ installId }: { installId: string }): Promise<InstallOperationResult> {
      const previewed = await previewDelete({ installId });
      if (previewed.status === 'invalid') return failure(installId, previewed.issue, previewed.detail);

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'delete',
         title: `Delete ${previewed.name}`,
         message: previewed.path,
         progress: { phase: 'preparing', current: 0, total: previewed.sizeBytes, percent: 0, unit: 'bytes' },
         metadata: { path: previewed.path },
         cancel: () => controller.abort()
      });

      void runDelete(operation.id, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function previewForget({ installId }: { installId: string }): Promise<InstallForgetPreview> {
      const install = await options.registry.get(installId);
      if (!install) return invalid(installId, 'not-found');
      if (install.source === 'store') return invalid(installId, 'store-detected');

      return {
         status: 'ok',
         installId,
         name: install.name,
         path: install.path,
         source: install.source
      };
   }

   async function forget({ installId }: { installId: string }): Promise<InstallForgetResult> {
      const previewed = await previewForget({ installId });
      if (previewed.status === 'invalid') return failure(installId, previewed.issue, previewed.detail);

      const forgotten = await options.registry.forget(installId);
      if (Result.isError(forgotten)) return { ok: false, error: toIpcError(forgotten.error) };

      return { ok: true, value: { installId, name: previewed.name, path: previewed.path } };
   }

   async function runDelete(operationId: string, previewed: ReadyDeletePreview, signal: AbortSignal) {
      const deleted = await deletePathWithProgress({
         targetPath: previewed.path,
         root: dirname(previewed.path),
         scope: 'install',
         operationId,
         onProgress: (progress) => options.operations.update(operationId, { progress }),
         signal,
         allowMissing: true
      });

      // cancellation can leave a partial delete, so rescan before deciding whether to forget it
      if (Result.isError(deleted)) {
         await options.registry.rescan();
         return failOperation(operationId, deleted.error);
      }

      const forgotten = await options.registry.forget(previewed.installId);
      if (Result.isError(forgotten)) return failOperation(operationId, forgotten.error);

      options.operations.complete(operationId, {
         installId: previewed.installId,
         name: previewed.name,
         path: previewed.path,
         bytes: deleted.value.bytes,
         files: deleted.value.files
      });
   }

   function failOperation(operationId: string, problem: FilesystemProblem) {
      options.operations.fail(operationId, {
         code: problem.code,
         message: problem.message,
         details: { path: problem.path, detail: problem.detail }
      });
   }

   function invalid(installId: string, issue: InstallActionIssue, detail?: string) {
      return invalidInstallAction({ installId }, issue, detail);
   }

   function failure(installId: string, issue: InstallActionIssue, detail?: string): IpcFailureResult {
      return {
         ok: false,
         error: {
            code: `installs.manage.${issue}`,
            message: actionIssueMessages[issue],
            details: { installId, detail }
         }
      };
   }

   return { list, getDetail, rescan, update, previewDelete, delete: deleteInstall, previewForget, forget };
}

function toIpcError(problem: FilesystemProblem): IpcError {
   return {
      code: problem.code,
      message: problem.message,
      details: { path: problem.path, detail: problem.detail }
   };
}
