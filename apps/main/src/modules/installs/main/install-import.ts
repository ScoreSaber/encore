import { Result } from 'better-result';

import { isPathInside, isSamePath } from '@/lib/filesystem/path';
import type { InstallImportIssue, InstallImportPreview, InstallImportResult } from '@/modules/installs/contract';
import { inspectInstallFolder, installFolderIssueMessages } from '@/modules/installs/main/install-folder';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { localTargetId } from '@/modules/targets/contract';

const importIssueMessages = {
   'already-registered': 'the selected folder is already registered with Encore',
   ...installFolderIssueMessages
};

type InstallImportOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
};

export type InstallImportService = ReturnType<typeof createInstallImportService>;

export function createInstallImportService(options: InstallImportOptions) {
   async function preview(sourcePath: string): Promise<InstallImportPreview> {
      const inspected = await inspectInstallFolder(sourcePath);
      if (inspected.status === 'invalid') return invalid(inspected.path, inspected.issue, inspected.detail);
      const path = inspected.path;

      const snapshot = await options.registry.list();
      if (snapshot.installs.some((install) => isSamePath(install.path, path))) return invalid(path, 'already-registered');

      const settings = await options.settingsStore.getSnapshot();

      return {
         status: 'ok',
         targetId: localTargetId,
         sourcePath: path,
         version: inspected.version,
         source: isPathInside(settings.library.installRoot, path) ? 'library' : 'imported'
      };
   }

   async function start(sourcePath: string): Promise<InstallImportResult> {
      const previewed = await preview(sourcePath);

      if (previewed.status === 'invalid') {
         return {
            ok: false,
            error: {
               code: `installs.import.${previewed.issue}`,
               message: importIssueMessages[previewed.issue],
               details: { path: previewed.sourcePath, detail: previewed.detail }
            }
         };
      }

      const registered = await options.registry.register({ source: previewed.source, path: previewed.sourcePath });

      if (Result.isError(registered)) {
         return {
            ok: false,
            error: {
               code: registered.error.code,
               message: registered.error.message,
               details: { path: registered.error.path, detail: registered.error.detail }
            }
         };
      }

      return { ok: true, value: registered.value };
   }

   function invalid(sourcePath: string, issue: InstallImportIssue, detail?: string): InstallImportPreview {
      const preview: InstallImportPreview = { status: 'invalid', targetId: localTargetId, sourcePath, issue };
      if (detail) preview.detail = detail;
      return preview;
   }

   return { preview, start };
}
