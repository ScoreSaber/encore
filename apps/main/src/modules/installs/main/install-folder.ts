import { Result } from 'better-result';

import { createFilesystemProblem, resolveFilesystemPath, pathExists, readPathInfo } from '@/lib/filesystem/path';
import type { InstallFolderIssue } from '@/modules/installs/contract';
import { beatSaberVersionFilePath, readBeatSaberVersion } from '@/modules/installs/main/beat-saber-version';

import { readdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const beatSaberExecutableName = 'beat saber.exe';

export const installFolderIssueMessages: Record<InstallFolderIssue, string> = {
   'inspect-failed': 'the selected folder could not be inspected',
   'missing-executable': 'the selected folder has no Beat Saber executable',
   'missing-game-data': 'the selected folder has no Beat Saber game data',
   'not-a-directory': 'the selected path is not a folder',
   'not-absolute': 'the selected path is not a full folder path',
   'not-found': 'the selected folder does not exist',
   'unknown-version': 'the Beat Saber version could not be detected'
};

export type InstallFolderInspection =
   | { status: 'invalid'; path: string; issue: InstallFolderIssue; detail?: string }
   | { status: 'ok'; path: string; version: string };

export async function inspectInstallFolder(sourcePath: string): Promise<InstallFolderInspection> {
   const trimmed = sourcePath.trim();
   if (!trimmed || !isAbsolute(trimmed)) return invalid(trimmed, 'not-absolute');

   const path = resolveFilesystemPath(trimmed);
   const info = await readPathInfo(path);
   if (Result.isError(info)) return invalid(path, info.error.detail === 'ENOENT' ? 'not-found' : 'inspect-failed', info.error.detail);
   if (info.value.kind !== 'directory') return invalid(path, 'not-a-directory');

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
   return version ? { status: 'ok', path, version } : invalid(path, 'unknown-version');
}

function invalid(path: string, issue: InstallFolderIssue, detail?: string): InstallFolderInspection {
   return { status: 'invalid', path, issue, ...(detail ? { detail } : {}) };
}
