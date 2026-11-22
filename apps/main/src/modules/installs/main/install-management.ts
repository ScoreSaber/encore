import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import { isSamePath } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import { translate } from '@/lib/messages';
import {
   installColorSchema,
   installNameSchema,
   type InstallActionIssue,
   type InstallActionProblem,
   type InstallDeletePreview,
   type InstallForgetPreview,
   type InstallUpdateRequest
} from '@/modules/installs/contract';
import { inspectInstallFolder } from '@/modules/installs/main/beat-saber-files';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { InstallRecordPatch } from '@/modules/installs/main/install-store';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { isRootInsideInstall, sharedRootPaths } from '@/modules/shared-content/main/shared-library';

import { dirname } from 'node:path';

type InstallManagementOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   settingsStore: SettingsStore;
};

type ReadyDeletePreview = Extract<InstallDeletePreview, { status: 'ok' }>;

export function createInstallManagementService(options: InstallManagementOptions) {
   async function update(request: Omit<InstallUpdateRequest, 'targetId'>) {
      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'not-found');

      const name = request.name === undefined ? null : installNameSchema.safeParse(request.name);
      if (name && !name.success) return failure(request.installId, 'invalid-name');

      const color = request.color === undefined || request.color === null ? null : installColorSchema.safeParse(request.color);
      if (color && !color.success) return failure(request.installId, 'invalid-color');

      let path = request.path?.trim();
      if (path !== undefined && isSamePath(path, install.path)) path = undefined;
      if (path !== undefined && install.source === 'store') return failure(request.installId, 'store-owned');

      if (path !== undefined) {
         const inspected = await inspectInstallFolder(path);
         if (inspected.status === 'invalid') {
            return Result.err(createProblem(`installs.import.${inspected.issue}`, { installId: request.installId, detail: inspected.detail }));
         }

         const installs = await options.registry.list();
         if (installs.installs.some((candidate) => candidate.id !== request.installId && isSamePath(candidate.path, inspected.path))) {
            return failure(request.installId, 'already-registered');
         }

         path = inspected.path;
      }

      const patch: InstallRecordPatch = {};
      if (name) patch.name = name.data;
      if (request.color !== undefined) patch.color = color ? color.data : null;
      if (path !== undefined) patch.path = path;

      const updated = await options.registry.update(request.installId, patch);
      if (Result.isError(updated)) return Result.err(updated.error);

      return updated.value ? Result.ok(updated.value) : failure(request.installId, 'not-found');
   }

   async function setPinned({ installId, pinned }: { installId: string; pinned: boolean }) {
      const updated = await options.registry.update(installId, { pinned });
      if (Result.isError(updated)) return Result.err(updated.error);
      if (!updated.value) return failure(installId, 'not-found');

      return Result.ok(await options.registry.list());
   }

   async function previewDelete({ installId }: { installId: string }): Promise<InstallDeletePreview> {
      const install = await options.registry.get(installId);
      if (!install) return invalid(installId, 'not-found');
      if (install.source === 'store') return invalid(installId, 'store-owned');

      const roots = sharedRootPaths((await options.settingsStore.getSnapshot()).library);
      const holdsRoot = await Promise.all(roots.map((root) => isRootInsideInstall(root, install.path)));
      if (holdsRoot.includes(true)) return invalid(installId, 'holds-shared-library');

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

   async function deleteInstall({ installId }: { installId: string }) {
      const previewed = await previewDelete({ installId });
      if (previewed.status === 'invalid') return failure(installId, previewed.issue, previewed.detail);

      const operation = options.operations.start(
         {
            kind: 'delete',
            title: translate('installs.manage.delete.operation', { name: previewed.name }),
            message: previewed.path,
            progress: { phase: 'preparing', current: 0, total: previewed.sizeBytes, percent: 0, unit: 'bytes' },
            metadata: { path: previewed.path }
         },
         (operationId, signal) => runDelete(operationId, previewed, signal)
      );

      return Result.ok(operation);
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

   async function forget({ installId }: { installId: string }) {
      const previewed = await previewForget({ installId });
      if (previewed.status === 'invalid') return failure(installId, previewed.issue, previewed.detail);

      const forgotten = await options.registry.forget(installId);
      if (Result.isError(forgotten)) return Result.err(forgotten.error);

      return Result.ok({ installId, name: previewed.name, path: previewed.path });
   }

   async function runDelete(operationId: string, previewed: ReadyDeletePreview, signal: AbortSignal) {
      const deleted = await deletePathWithProgress({
         targetPath: previewed.path,
         root: dirname(previewed.path),
         onProgress: (progress) => options.operations.update(operationId, { progress }),
         signal,
         allowMissing: true
      });

      // cancellation can leave a partial delete, so rescan before deciding whether to forget it
      if (Result.isError(deleted)) {
         await options.registry.rescan();
         return options.operations.fail(operationId, deleted.error);
      }

      const forgotten = await options.registry.forget(previewed.installId);
      if (Result.isError(forgotten)) return options.operations.fail(operationId, forgotten.error);

      options.operations.complete(operationId, {
         installId: previewed.installId,
         name: previewed.name,
         path: previewed.path,
         bytes: deleted.value.bytes,
         files: deleted.value.files
      });
   }

   function invalid(installId: string, issue: InstallActionIssue, detail?: string) {
      const problem: InstallActionProblem = { status: 'invalid', installId, issue };
      if (detail) problem.detail = detail;
      return problem;
   }

   function failure(installId: string, issue: InstallActionIssue | 'already-registered', detail?: string) {
      return Result.err(createProblem(`installs.manage.${issue}`, { installId, detail }));
   }

   return {
      list: options.registry.list,
      getDetail: ({ installId }: { installId: string }) => options.registry.get(installId),
      rescan: options.registry.rescan,
      update,
      setPinned,
      reorder: ({ installIds }: { installIds: string[] }) => options.registry.reorder(installIds),
      previewDelete,
      delete: deleteInstall,
      previewForget,
      forget
   };
}
