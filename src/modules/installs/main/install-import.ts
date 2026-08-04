import { Result } from 'better-result';

import { createFilesystemProblem, isPathInside, isSamePath, resolveFilesystemPath, pathExists, readPathInfo } from '@/lib/filesystem/path';
import type { InstallImportIssue, InstallImportPreview, InstallImportResult } from '@/modules/installs/contract';
import { beatSaberVersionFilePath, readBeatSaberVersion } from '@/modules/installs/main/beat-saber-version';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { localTargetId } from '@/modules/targets/contract';

import { readdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const beatSaberExecutableName = 'beat saber.exe';

const importIssueMessages: Record<InstallImportIssue, string> = {
   'already-registered': 'the selected folder is already registered with Encore',
   'inspect-failed': 'the selected folder could not be inspected',
   'missing-executable': 'the selected folder has no Beat Saber executable',
   'missing-game-data': 'the selected folder has no Beat Saber game data',
   'not-a-directory': 'the selected path is not a folder',
   'not-absolute': 'the selected path is not a full folder path',
   'not-found': 'the selected folder does not exist',
   'unknown-version': 'the Beat Saber version could not be detected'
};

type InstallImportOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
};

export type InstallImportService = ReturnType<typeof createInstallImportService>;

export function createInstallImportService(options: InstallImportOptions) {
   async function preview(sourcePath: string): Promise<InstallImportPreview> {
      const trimmed = sourcePath.trim();
      if (!trimmed || !isAbsolute(trimmed)) return invalid(trimmed, 'not-absolute');

      const path = resolveFilesystemPath(trimmed);

      const info = await readPathInfo(path);
      if (Result.isError(info)) {
         return invalid(path, info.error.detail === 'ENOENT' ? 'not-found' : 'inspect-failed', info.error.detail);
      }
      if (info.value.kind !== 'directory') return invalid(path, 'not-a-directory');

      const snapshot = await options.registry.list();
      if (snapshot.installs.some((install) => isSamePath(install.path, path))) return invalid(path, 'already-registered');

      const entries = await Result.tryPromise({
         try: () => readdir(path),
         catch: (cause) => createFilesystemProblem('filesystem.path.inspect-failed', 'failed to read the selected folder', path, cause)
      });
      if (Result.isError(entries)) return invalid(path, 'inspect-failed', entries.error.detail);
      if (!entries.value.some((entry) => entry.toLowerCase() === beatSaberExecutableName)) return invalid(path, 'missing-executable');

      const gameData = await pathExists(beatSaberVersionFilePath(path));
      if (Result.isError(gameData)) return invalid(path, 'inspect-failed', gameData.error.detail);
      if (!gameData.value) return invalid(path, 'missing-game-data');

      const version = await readBeatSaberVersion(path);
      if (!version) return invalid(path, 'unknown-version');

      const settings = await options.settingsStore.getSnapshot();

      return {
         status: 'ok',
         targetId: localTargetId,
         sourcePath: path,
         version,
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
      return {
         status: 'invalid',
         targetId: localTargetId,
         sourcePath,
         issue,
         ...(detail ? { detail } : {})
      };
   }

   return { preview, start };
}
