import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';

import { randomUUID } from 'node:crypto';
import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type FilesystemPathKind = 'file' | 'directory' | 'link' | 'other';

export type FilesystemProblemCode =
   | 'filesystem.path.empty'
   | 'filesystem.path.outside-root'
   | 'filesystem.path.root-target'
   | 'filesystem.path.not-found'
   | 'filesystem.path.copy-into-self'
   | 'filesystem.path.exists-check-failed'
   | 'filesystem.path.inspect-failed'
   | 'filesystem.size.failed'
   | 'filesystem.json.read-failed'
   | 'filesystem.json.write-failed'
   | 'filesystem.json.invalid'
   | 'filesystem.operation.cancelled'
   | 'filesystem.operation.destination-exists'
   | 'filesystem.operation.copy-failed'
   | 'filesystem.operation.move-failed'
   | 'filesystem.operation.delete-failed'
   | 'filesystem.operation.write-failed';

export type FilesystemProblem = {
   code: FilesystemProblemCode;
   message: string;
   path?: string;
   root?: string;
   detail?: string;
};

export type ManagedPathPolicy = {
   root: string;
   path: string;
   allowRoot?: boolean;
};

export type ManagedPath = {
   root: string;
   path: string;
   relativePath: string;
};

export type TempPathOptions = {
   parentPath: string;
   prefix: string;
   suffix?: string;
};

export type PathInfo = {
   path: string;
   kind: FilesystemPathKind;
   isLink: boolean;
   sizeBytes: number;
   targetPath?: string;
   targetKind?: FilesystemPathKind;
};

export function resolveFilesystemPath(input: string, basePath = process.cwd()) {
   return isAbsolute(input) ? resolve(input) : resolve(basePath, input);
}

export function isSamePath(firstPath: string, secondPath: string) {
   return pathKey(resolveFilesystemPath(firstPath)) === pathKey(resolveFilesystemPath(secondPath));
}

export function isPathInside(parentPath: string, childPath: string) {
   const normalizedParent = resolveFilesystemPath(parentPath);
   const normalizedChild = resolveFilesystemPath(childPath);
   const relativePath = relative(pathKey(normalizedParent), pathKey(normalizedChild));

   return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

export async function resolveManagedPath(policy: ManagedPathPolicy) {
   if (!policy.root.trim()) {
      return Result.err<ManagedPath, FilesystemProblem>({
         code: 'filesystem.path.empty',
         message: 'managed root path is empty'
      });
   }

   if (!policy.path.trim()) {
      return Result.err<ManagedPath, FilesystemProblem>({
         code: 'filesystem.path.empty',
         message: 'managed target path is empty',
         root: resolveFilesystemPath(policy.root)
      });
   }

   const root = resolveFilesystemPath(policy.root);
   const targetPath = resolveFilesystemPath(policy.path, root);
   const samePath = isSamePath(root, targetPath);

   if (samePath && !policy.allowRoot) {
      return Result.err<ManagedPath, FilesystemProblem>({
         code: 'filesystem.path.root-target',
         message: 'managed write cannot target the root path',
         path: targetPath,
         root
      });
   }

   if (!samePath && !isPathInside(root, targetPath)) {
      return Result.err<ManagedPath, FilesystemProblem>({
         code: 'filesystem.path.outside-root',
         message: 'managed write path is outside the expected root',
         path: targetPath,
         root
      });
   }

   const physicalRoot = await readRealPath(root);
   if (Result.isError(physicalRoot)) return Result.err<ManagedPath, FilesystemProblem>(physicalRoot.error);

   if (!samePath) {
      const physicalParent = await readPhysicalParentPath(targetPath, root);
      if (Result.isError(physicalParent)) return Result.err<ManagedPath, FilesystemProblem>(physicalParent.error);

      if (!isSamePath(physicalRoot.value, physicalParent.value) && !isPathInside(physicalRoot.value, physicalParent.value)) {
         return Result.err<ManagedPath, FilesystemProblem>({
            code: 'filesystem.path.outside-root',
            message: 'managed write path escapes the expected root through a filesystem link',
            path: targetPath,
            root
         });
      }
   }

   return Result.ok<ManagedPath, FilesystemProblem>({
      root,
      path: targetPath,
      relativePath: relative(root, targetPath)
   });
}

export async function assertCanCopyToDestination(sourcePath: string, destinationPath: string) {
   const source = resolveFilesystemPath(sourcePath);
   const destination = resolveFilesystemPath(destinationPath);

   if (pathsOverlap(source, destination)) {
      return Result.err<{ source: string; destination: string }, FilesystemProblem>({
         code: 'filesystem.path.copy-into-self',
         message: 'copy source and destination cannot contain each other',
         path: destination,
         root: source
      });
   }

   const sourcePhysical = await readRealPath(source);
   const destinationPhysical = await readRealPath(destination);
   if (Result.isError(sourcePhysical) && sourcePhysical.error.detail !== 'ENOENT') {
      return Result.err<{ source: string; destination: string }, FilesystemProblem>(sourcePhysical.error);
   }
   if (Result.isError(destinationPhysical) && destinationPhysical.error.detail !== 'ENOENT') {
      return Result.err<{ source: string; destination: string }, FilesystemProblem>(destinationPhysical.error);
   }

   if (Result.isOk(sourcePhysical) && Result.isOk(destinationPhysical) && pathsOverlap(sourcePhysical.value, destinationPhysical.value)) {
      return Result.err<{ source: string; destination: string }, FilesystemProblem>({
         code: 'filesystem.path.copy-into-self',
         message: 'copy source and destination resolve to overlapping filesystem paths',
         path: destination,
         root: source
      });
   }

   return Result.ok<{ source: string; destination: string }, FilesystemProblem>({
      source,
      destination
   });
}

export async function createUniquePath(desiredPath: string, maxAttempts = 200) {
   const path = resolveFilesystemPath(desiredPath);

   for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      const candidate = attempt === 0 ? path : `${path} (${attempt})`;
      const exists = await pathExists(candidate);
      if (Result.isError(exists)) return Result.err<string, FilesystemProblem>(exists.error);

      if (!exists.value) return Result.ok<string, FilesystemProblem>(candidate);
   }

   return Result.err<string, FilesystemProblem>({
      code: 'filesystem.operation.destination-exists',
      message: 'could not find a free destination name',
      path
   });
}

export function toSafeFileName(name: string, fallback: string, maxLength = 120) {
   const cleaned = name
      .normalize('NFC')
      .replaceAll(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .replaceAll(/\.+$/g, '')
      .slice(0, maxLength)
      .trim();

   return cleaned || fallback;
}

export function isSafeFileName(name: string) {
   const trimmed = name.trim();
   return trimmed !== '' && trimmed !== '.' && trimmed !== '..' && !/[/\\:]/.test(trimmed) && !trimmed.includes(String.fromCodePoint(0));
}

export function createTempPath(options: TempPathOptions) {
   const suffix = options.suffix ?? '.tmp';
   return resolveFilesystemPath(join(options.parentPath, `.${options.prefix}-${randomUUID()}${suffix}`));
}

export async function readPathInfo(targetPath: string) {
   const normalizedPath = resolveFilesystemPath(targetPath);

   return Result.tryPromise({
      try: async (): Promise<PathInfo> => {
         const stats = await lstat(normalizedPath);

         if (!stats.isSymbolicLink()) {
            return {
               path: normalizedPath,
               kind: pathKindFromStats(stats),
               isLink: false,
               sizeBytes: stats.size
            };
         }

         const target = await readlink(normalizedPath);
         const targetStats = await Result.tryPromise({
            try: () => stat(normalizedPath),
            catch: (cause) =>
               createFilesystemProblem('filesystem.path.inspect-failed', 'failed to inspect filesystem link target', normalizedPath, cause)
         });

         const info: PathInfo = {
            path: normalizedPath,
            kind: 'link',
            isLink: true,
            sizeBytes: 0,
            targetPath: resolveFilesystemPath(target, dirname(normalizedPath))
         };
         if (Result.isOk(targetStats)) info.targetKind = pathKindFromStats(targetStats.value);
         return info;
      },
      catch: (cause) => createFilesystemProblem('filesystem.path.inspect-failed', 'failed to inspect filesystem path', normalizedPath, cause)
   });
}

export async function pathExists(targetPath: string) {
   const normalizedPath = resolveFilesystemPath(targetPath);
   const exists = await Result.tryPromise({
      try: async () => {
         await lstat(normalizedPath);
         return true;
      },
      catch: (cause) => createFilesystemProblem('filesystem.path.exists-check-failed', 'failed to check whether path exists', normalizedPath, cause)
   });

   if (Result.isOk(exists)) return Result.ok<boolean, FilesystemProblem>(true);
   if (exists.error.detail === 'ENOENT') return Result.ok<boolean, FilesystemProblem>(false);
   return Result.err<boolean, FilesystemProblem>(exists.error);
}

// existence as a plain boolean, treating unreadable paths as missing
export async function pathExistsSafely(targetPath: string) {
   const exists = await pathExists(targetPath);

   return Result.isOk(exists) && exists.value;
}

export function createFilesystemProblem(code: FilesystemProblemCode, message: string, targetPath?: string, cause?: unknown): FilesystemProblem {
   const problem: FilesystemProblem = { code, message };
   if (targetPath) problem.path = targetPath;
   if (cause) problem.detail = causeCode(cause);
   return problem;
}

async function readRealPath(targetPath: string) {
   const normalizedPath = resolveFilesystemPath(targetPath);

   return Result.tryPromise({
      try: async () => resolveFilesystemPath(await realpath(normalizedPath)),
      catch: (cause) => createFilesystemProblem('filesystem.path.inspect-failed', 'failed to resolve filesystem path', normalizedPath, cause)
   });
}

async function readPhysicalParentPath(targetPath: string, root: string) {
   let candidate = dirname(targetPath);
   const normalizedRoot = resolveFilesystemPath(root);

   for (;;) {
      const exists = await pathExists(candidate);
      if (Result.isError(exists)) return Result.err<string, FilesystemProblem>(exists.error);

      if (exists.value) return readRealPath(candidate);
      if (isSamePath(candidate, normalizedRoot)) return readRealPath(normalizedRoot);

      const nextCandidate = dirname(candidate);
      if (isSamePath(nextCandidate, candidate)) return readRealPath(normalizedRoot);
      candidate = nextCandidate;
   }
}

function pathsOverlap(firstPath: string, secondPath: string) {
   return isSamePath(firstPath, secondPath) || isPathInside(firstPath, secondPath) || isPathInside(secondPath, firstPath);
}

function pathKindFromStats(stats: Awaited<ReturnType<typeof lstat>>): FilesystemPathKind {
   if (stats.isFile()) return 'file';
   if (stats.isDirectory()) return 'directory';
   if (stats.isSymbolicLink()) return 'link';
   return 'other';
}

function pathKey(targetPath: string) {
   return process.platform === 'win32' || process.platform === 'darwin' ? targetPath.toLowerCase() : targetPath;
}
