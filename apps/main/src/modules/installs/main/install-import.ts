import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { isPathInside, isSamePath } from '@/lib/filesystem/path';
import type { InstallImportIssue, InstallImportPreview } from '@/modules/installs/contract';
import { inspectInstallFolder } from '@/modules/installs/main/beat-saber-files';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

type InstallImportOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
};

export function createInstallImportService(options: InstallImportOptions) {
   async function previewImport({ sourcePath }: { sourcePath: string }): Promise<InstallImportPreview> {
      const inspected = await inspectInstallFolder(sourcePath);
      if (inspected.status === 'invalid') return invalid(inspected.path, inspected.issue, inspected.detail);
      const path = inspected.path;

      const snapshot = await options.registry.list();
      if (snapshot.installs.some((install) => isSamePath(install.path, path))) return invalid(path, 'already-registered');

      const settings = await options.settingsStore.getSnapshot();

      return {
         status: 'ok',
         sourcePath: path,
         version: inspected.version,
         source: isPathInside(settings.library.installRoot, path) ? 'library' : 'imported'
      };
   }

   async function importFolder({ sourcePath }: { sourcePath: string }) {
      const previewed = await previewImport({ sourcePath });
      if (previewed.status === 'invalid') {
         return Result.err(createProblem(`installs.import.${previewed.issue}`, { path: previewed.sourcePath, detail: previewed.detail }));
      }

      return options.registry.register({ source: previewed.source, path: previewed.sourcePath });
   }

   function invalid(sourcePath: string, issue: InstallImportIssue, detail?: string): InstallImportPreview {
      const preview: InstallImportPreview = { status: 'invalid', sourcePath, issue };
      if (detail) preview.detail = detail;
      return preview;
   }

   return { previewImport, importFolder };
}
