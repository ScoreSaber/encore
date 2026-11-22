import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import type { ProblemCode } from '@/lib/messages';

import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readlink, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type FilesystemPathKind = 'file' | 'directory' | 'link' | 'other';

type FilesystemProblemCode = Extract<ProblemCode, `filesystem.${string}`>;

export type FilesystemProblem = Problem<FilesystemProblemCode> & {
   path?: string;
   root?: string;
};

type ManagedPathPolicy = {
   root: string;
   path: string;
   allowRoot?: boolean;
};

export type ManagedPath = {
   root: string;
   path: string;
   relativePath: string;
};

type TempPathOptions = {
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

const maxUniquePathAttempts = 200;

export function resolveFilesystemPath(input: string, basePath = process.cwd()) {
   return resolve(basePath, input);
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
      return Result.err<ManagedPath, FilesystemProblem>(createProblem('filesystem.path.empty'));
   }

   if (!policy.path.trim()) {
      return Result.err<ManagedPath, FilesystemProblem>(createProblem('filesystem.path.empty', { root: resolveFilesystemPath(policy.root) }));
   }

   const root = resolveFilesystemPath(policy.root);
   const targetPath = resolveFilesystemPath(policy.path, root);
   const samePath = isSamePath(root, targetPath);

   if (samePath && !policy.allowRoot) {
      return Result.err<ManagedPath, FilesystemProblem>(createProblem('filesystem.path.root-target', { path: targetPath, root }));
   }

   if (!samePath && !isPathInside(root, targetPath)) {
      return Result.err<ManagedPath, FilesystemProblem>(createProblem('filesystem.path.outside-root', { path: targetPath, root }));
   }

   const physicalRoot = await readRealPath(root);
   if (Result.isError(physicalRoot)) return Result.err<ManagedPath, FilesystemProblem>(physicalRoot.error);

   if (!samePath) {
      const physicalParent = await readPhysicalParentPath(targetPath, root);
      if (Result.isError(physicalParent)) return Result.err<ManagedPath, FilesystemProblem>(physicalParent.error);

      if (!isSamePath(physicalRoot.value, physicalParent.value) && !isPathInside(physicalRoot.value, physicalParent.value)) {
         return Result.err<ManagedPath, FilesystemProblem>(createProblem('filesystem.path.outside-root', { path: targetPath, root }));
      }
   }

   return Result.ok<ManagedPath, FilesystemProblem>({
      root,
      path: targetPath,
      relativePath: relative(root, targetPath)
   });
}

export async function assertCanCopyToDestination(sourcePath: string, destinationPath: string): Promise<Result<void, FilesystemProblem>> {
   const source = resolveFilesystemPath(sourcePath);
   const destination = resolveFilesystemPath(destinationPath);

   if (pathsOverlap(source, destination)) {
      return Result.err(createProblem('filesystem.path.copy-into-self', { path: destination, root: source }));
   }

   const sourcePhysical = await readRealPath(source);
   const destinationPhysical = await readRealPath(destination);
   if (Result.isError(sourcePhysical) && sourcePhysical.error.detail !== 'ENOENT') return Result.err(sourcePhysical.error);
   if (Result.isError(destinationPhysical) && destinationPhysical.error.detail !== 'ENOENT') return Result.err(destinationPhysical.error);

   if (Result.isOk(sourcePhysical) && Result.isOk(destinationPhysical) && pathsOverlap(sourcePhysical.value, destinationPhysical.value)) {
      return Result.err(createProblem('filesystem.path.copy-into-self', { path: destination, root: source }));
   }

   return Result.ok();
}

export async function createUniquePath(desiredPath: string, extension = '') {
   const path = resolveFilesystemPath(desiredPath);
   const base = extension && path.endsWith(extension) ? path.slice(0, -extension.length) : path;
   const suffix = base === path ? '' : extension;

   for (let attempt = 0; attempt <= maxUniquePathAttempts; attempt += 1) {
      const candidate = attempt === 0 ? path : `${base} (${attempt})${suffix}`;
      const exists = await pathExists(candidate);
      if (Result.isError(exists)) return Result.err<string, FilesystemProblem>(exists.error);

      if (!exists.value) return Result.ok<string, FilesystemProblem>(candidate);
   }

   return Result.err<string, FilesystemProblem>(createProblem('filesystem.operation.destination-exists', { path }));
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
            catch: (cause) => createProblem('filesystem.path.inspect-failed', { path: normalizedPath, cause })
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
      catch: (cause) => createProblem('filesystem.path.inspect-failed', { path: normalizedPath, cause })
   });
}

export async function pathExists(targetPath: string) {
   const normalizedPath = resolveFilesystemPath(targetPath);
   const exists = await Result.tryPromise({
      try: async () => {
         await lstat(normalizedPath);
         return true;
      },
      catch: (cause) => createProblem('filesystem.path.exists-check-failed', { path: normalizedPath, cause })
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

export async function removeQuietly(targetPath: string) {
   await Result.tryPromise(() => rm(targetPath, { recursive: true, force: true }));
}

async function readRealPath(targetPath: string): Promise<Result<string, FilesystemProblem>> {
   return Result.tryPromise({
      try: async () => resolveFilesystemPath(await realpath(targetPath)),
      catch: (cause) => createProblem('filesystem.path.inspect-failed', { path: targetPath, cause })
   });
}

async function readPhysicalParentPath(targetPath: string, root: string) {
   let candidate = dirname(targetPath);

   for (;;) {
      const exists = await pathExists(candidate);
      if (Result.isError(exists)) return Result.err<string, FilesystemProblem>(exists.error);

      if (exists.value) return readRealPath(candidate);
      if (isSamePath(candidate, root)) return readRealPath(root);

      const nextCandidate = dirname(candidate);
      if (isSamePath(nextCandidate, candidate)) return readRealPath(root);
      candidate = nextCandidate;
   }
}

function pathsOverlap(firstPath: string, secondPath: string) {
   return isSamePath(firstPath, secondPath) || isPathInside(firstPath, secondPath) || isPathInside(secondPath, firstPath);
}

function pathKindFromStats(stats: Stats): FilesystemPathKind {
   if (stats.isFile()) return 'file';
   if (stats.isDirectory()) return 'directory';
   if (stats.isSymbolicLink()) return 'link';
   return 'other';
}

function pathKey(targetPath: string) {
   return process.platform === 'win32' || process.platform === 'darwin' ? targetPath.toLowerCase() : targetPath;
}
