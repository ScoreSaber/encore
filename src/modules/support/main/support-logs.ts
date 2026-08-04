import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';
import { isPathInside, resolveFilesystemPath, readPathInfo, resolveManagedPath } from '@/lib/filesystem/path';
import {
   unavailableSupportLogExcerpt,
   type SupportAppLogGroup,
   type SupportLogExcerpt,
   type SupportLogFile,
   type SupportLogGroup,
   type SupportInstallLogFile,
   type SupportInstallLogGroup,
   type SupportInstallLogReadRequest,
   type SupportLogReadRequest
} from '@/modules/support/contract';
import { redactSupportText } from '@/modules/support/main/log-redaction';

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const maxListedFiles = 12;
const logFileExtensions = ['.log', '.txt'];
const installLogFolder = 'Logs';
const maxScanDepth = 2;

export type SupportLogService = ReturnType<typeof createSupportLogService>;

export function createSupportLogService(options: {
   logsPath: string;
   homePath: string;
   getInstall: (installId: string) => Promise<{ path: string } | null>;
   getInstalls: () => Promise<{ id: string; name: string; path: string }[]>;
}) {
   async function listAppLogs(): Promise<SupportAppLogGroup> {
      const root = resolveFilesystemPath(options.logsPath);
      const files = await collectLogFiles(root, root, 0);

      if (Result.isError(files)) return unavailableAppLogGroup(root, files.error);

      return {
         source: 'app',
         status: 'ready',
         rootPath: root,
         files: newestFiles(files.value)
      };
   }

   async function listInstallLogs(): Promise<SupportInstallLogGroup> {
      const installs = await options.getInstalls();
      if (installs.length === 0) return { source: 'install', status: 'missing', rootPath: null, files: [] };

      const scanned = await Promise.all(
         installs.map(async (install) => {
            const root = join(resolveFilesystemPath(install.path), installLogFolder);
            return { install, files: await collectLogFiles(root, root, 0) };
         })
      );
      const files: SupportInstallLogFile[] = scanned.flatMap(({ install, files }) =>
         Result.isOk(files) ? files.value.map((file) => ({ ...file, installId: install.id, installName: install.name })) : []
      );
      const readable = scanned.some(({ files }) => Result.isOk(files));

      if (!readable) {
         const detail = scanned.find(({ files }) => Result.isError(files))?.files;
         const issue = detail && Result.isError(detail) ? detail.error : 'ENOENT';
         return { source: 'install', status: issue === 'ENOENT' ? 'missing' : 'unreadable', rootPath: null, files: [], detail: issue };
      }

      return { source: 'install', status: 'ready', rootPath: null, files: newestFiles(files) };
   }

   async function readInstallLog(request: SupportInstallLogReadRequest): Promise<SupportLogExcerpt> {
      return readLog({ ...request, source: 'install' });
   }

   async function readLog(request: SupportLogReadRequest): Promise<SupportLogExcerpt> {
      const path = await resolveLogPath(request);
      if (Result.isError(path)) return unavailableSupportLogExcerpt(path.error.issue, path.error.detail);

      const contents = await Result.tryPromise({ try: () => readFile(path.value), catch: (cause) => causeCode(cause) });
      if (Result.isError(contents)) return unavailableSupportLogExcerpt('unreadable', contents.error);

      return {
         status: 'ready',
         text: redactSupportText(contents.value.toString('utf8'), { homePath: options.homePath })
      };
   }

   async function resolveLogPath(request: SupportLogReadRequest) {
      const root = request.source === 'app' ? Result.ok<string, SupportLogGroup>(options.logsPath) : await resolveInstallLogRoot(request.installId);
      if (Result.isError(root)) return Result.err<string, LogPathProblem>({ issue: 'not-found', detail: root.error.detail });

      const managed = await resolveManagedPath({ root: root.value, path: request.fileId });
      if (Result.isError(managed)) return Result.err<string, LogPathProblem>({ issue: 'invalid-path', detail: managed.error.code });

      const info = await readPathInfo(managed.value.path);
      if (Result.isError(info)) {
         return Result.err<string, LogPathProblem>({
            issue: info.error.detail === 'ENOENT' ? 'not-found' : 'unreadable',
            detail: info.error.detail
         });
      }
      if (info.value.kind !== 'file' || info.value.isLink) return Result.err<string, LogPathProblem>({ issue: 'invalid-path' });

      return Result.ok<string, LogPathProblem>(managed.value.path);
   }

   async function resolveInstallLogRoot(installId: string) {
      const install = await options.getInstall(installId);
      if (!install) {
         return Result.err<string, SupportLogGroup>({
            source: 'install',
            status: 'missing',
            rootPath: null,
            files: [],
            detail: 'install-not-found'
         });
      }

      return Result.ok<string, SupportLogGroup>(join(resolveFilesystemPath(install.path), installLogFolder));
   }

   return {
      listAppLogs,
      listInstallLogs,
      readInstallLog,
      readLog,
      resolveLogPath
   };
}

function newestFiles<File extends SupportLogFile>(files: File[]) {
   return sortNewestFirst(files).slice(0, maxListedFiles);
}

function sortNewestFirst<File extends SupportLogFile>(files: File[]) {
   return files.sort((first, second) => second.modifiedAt.localeCompare(first.modifiedAt) || second.id.localeCompare(first.id));
}

function unavailableAppLogGroup(rootPath: string, detail: string): SupportAppLogGroup {
   return {
      source: 'app',
      status: detail === 'ENOENT' ? 'missing' : 'unreadable',
      rootPath,
      files: [],
      detail
   };
}

async function collectLogFiles(root: string, folder: string, depth: number) {
   const entries = await Result.tryPromise({
      try: () => readdir(folder, { withFileTypes: true }),
      catch: (cause) => causeCode(cause)
   });
   if (Result.isError(entries)) return Result.err<SupportLogFile[], string>(entries.error);

   const files: SupportLogFile[] = [];

   for (const entry of entries.value) {
      const entryPath = join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
         if (depth >= maxScanDepth) continue;

         const nested = await collectLogFiles(root, entryPath, depth + 1);
         if (Result.isOk(nested)) files.push(...nested.value);
         continue;
      }

      if (!entry.isFile() || !logFileExtensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) continue;
      if (!isPathInside(root, entryPath)) continue;

      const stats = await Result.tryPromise({ try: () => stat(entryPath), catch: (cause) => causeCode(cause) });
      if (Result.isError(stats)) continue;

      files.push({
         id: relative(root, entryPath).split(sep).join('/'),
         sizeBytes: stats.value.size,
         modifiedAt: stats.value.mtime.toISOString()
      });
   }

   return Result.ok<SupportLogFile[], string>(files);
}

type LogPathProblem = { issue: 'invalid-path' | 'not-found' | 'unreadable'; detail?: string };
