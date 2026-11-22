import { Result } from 'better-result';

import type { TargetUploadFailure } from '@/lib/api';
import { zipFiles } from '@/lib/archive/zip-write';
import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { isPathInside, isSamePath } from '@/lib/filesystem/path';
import {
   mirrorPageSize,
   type MirrorBatchRequest,
   type MirrorEntry,
   type MirrorFileRequest,
   type MirrorLink,
   type MirrorManifestPage,
   type MirrorManifestRequest,
   type MirrorSection
} from '@/modules/install-mirror/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const walkCacheMs = 10 * 60_000;
const maxDepth = 32;
const skippedSuffixes = ['.encore-backup', '.encore-conflicts', '.encore-part'];
const skippedPrefixes = ['.encore-staging-', '.encore-backup-'];

type Walk = { entries: MirrorEntry[]; links: MirrorLink[] };

export function beatSaberAppDataPath(input: { platform: NodeJS.Platform; homePath: string; dataPath: string }) {
   const localLow = ['AppData', 'LocalLow', 'Hyperbolic Magnetism', 'Beat Saber'];
   return input.platform === 'win32'
      ? join(input.homePath, ...localLow)
      : join(input.dataPath, 'compatdata', 'pfx', 'drive_c', 'users', 'steamuser', ...localLow);
}

export function toMirrorPath(root: string, path: string) {
   return relative(root, path).split(sep).join('/');
}

export function fromMirrorPath(root: string, path: string) {
   return join(root, ...path.split('/'));
}

export function createMirrorSource(options: { installs: Pick<InstallRegistry, 'get'>; sharedRoots: () => Promise<string[]>; appDataPath: string }) {
   const walks = new Map<string, { at: number; scope: string; walk: Promise<Result<Walk, Problem>> }>();

   async function sectionRoot(installId: string, section: MirrorSection): Promise<Result<string, Problem>> {
      if (section.kind === 'appdata') return Result.ok(options.appDataPath);

      const install = await options.installs.get(installId);
      if (!install) return Result.err(createProblem('mirror.install-missing'));
      if (section.kind === 'install') return Result.ok(install.path);

      const linkPath = fromMirrorPath(install.path, section.path);
      const [target, roots] = await Promise.all([
         Result.tryPromise(async () => ((await lstat(linkPath)).isSymbolicLink() ? realpath(linkPath) : null)),
         options.sharedRoots()
      ]);
      const shared = Result.isOk(target) && target.value && isPathInside(install.path, linkPath) ? target.value : null;
      return shared && roots.some((root) => isPathInside(root, shared))
         ? Result.ok(shared)
         : Result.err(createProblem('mirror.link-missing', { path: section.path }));
   }

   async function manifest(request: MirrorManifestRequest): Promise<Result<MirrorManifestPage, Problem>> {
      for (const [id, cached] of walks) if (Date.now() - cached.at > walkCacheMs) walks.delete(id);

      if (request.offset > 0 && !request.walkId) return Result.err(createProblem('mirror.manifest-expired'));
      const scope = JSON.stringify([request.installId, request.section]);
      const walkId = request.walkId ?? randomUUID();
      if (!request.walkId) {
         const walk = sectionRoot(request.installId, request.section).then(async (root) => {
            if (Result.isError(root)) return Result.err<Walk, Problem>(root.error);
            return walkTree(root.value, request.section.kind === 'install' ? await options.sharedRoots() : [], request.section.kind === 'appdata');
         });
         walks.set(walkId, { at: Date.now(), scope, walk });
      }
      const cached = walks.get(walkId);
      if (!cached || cached.scope !== scope) return Result.err(createProblem('mirror.manifest-expired'));
      cached.at = Date.now();
      const walked = await cached.walk;
      if (Result.isError(walked)) {
         walks.delete(walkId);
         return Result.err(walked.error);
      }

      const { entries, links } = walked.value;
      const end = request.offset + mirrorPageSize;
      if (end >= entries.length) walks.delete(walkId);
      else cached.at = Date.now();
      return Result.ok({
         walkId,
         entries: entries.slice(request.offset, end),
         links: request.offset === 0 ? links : [],
         next: end < entries.length ? end : null
      });
   }

   async function readFile(request: MirrorFileRequest): Promise<Result<AsyncIterable<Uint8Array>, TargetUploadFailure>> {
      const root = await sectionRoot(request.installId, request.section);
      if (Result.isError(root)) return Result.err({ kind: 'not-found', ...root.error });

      const path = await physicalPath(root.value, request.path);
      const file = path ? await Result.tryPromise(() => stat(path)) : null;
      if (!path || !file || Result.isError(file) || !file.value.isFile()) {
         return Result.err({ kind: 'not-found', ...createProblem('mirror.file-missing', { path: request.path }) });
      }
      return Result.ok(createReadStream(path));
   }

   async function readBatch(request: MirrorBatchRequest): Promise<Result<AsyncIterable<Uint8Array>, TargetUploadFailure>> {
      const root = await sectionRoot(request.installId, request.section);
      if (Result.isError(root)) return Result.err({ kind: 'not-found', ...root.error });

      const files: { archivePath: string; sourcePath: string }[] = [];
      for (const path of request.paths) {
         const sourcePath = await physicalPath(root.value, path);
         if (!sourcePath) return Result.err({ kind: 'invalid', ...createProblem('mirror.file-missing', { path }) });
         files.push({ archivePath: path, sourcePath });
      }
      return Result.ok(zipFiles(files, { compression: 'store' }));
   }

   return { manifest, readFile, readBatch };
}

async function physicalPath(root: string, path: string) {
   const real = await Result.tryPromise(async () => {
      const realRoot = await realpath(root);
      return { realRoot, path: await realpath(fromMirrorPath(realRoot, path)) };
   });
   return Result.isOk(real) && isPathInside(real.value.realRoot, real.value.path) ? real.value.path : null;
}

async function walkTree(root: string, sharedRoots: string[], mayBeMissing: boolean): Promise<Result<Walk, Problem>> {
   const entries: MirrorEntry[] = [];
   const links: MirrorLink[] = [];
   let unreadable: string | null = null;

   const resolved = await Result.tryPromise({ try: () => realpath(root), catch: causeCode });
   if (Result.isError(resolved)) {
      return mayBeMissing && resolved.error === 'ENOENT'
         ? Result.ok({ entries, links })
         : Result.err(createProblem('mirror.source-unreadable', { path: root }));
   }
   const realRoot = resolved.value;

   const file = async (path: string, name: string) => {
      const info = await Result.tryPromise(() => stat(path));
      if (Result.isError(info)) unreadable ??= path;
      else entries.push({ path: name, size: info.value.size, mtimeMs: info.value.mtimeMs });
   };

   async function visit(directory: string, prefix: string, ancestors: Set<string>, followed: boolean) {
      const listed = await Result.tryPromise(() => readdir(directory, { withFileTypes: true }));
      if (Result.isError(listed) || ancestors.size > maxDepth) {
         unreadable ??= directory;
         return;
      }

      for (const dirent of listed.value) {
         if (unreadable) return;
         if (skippedSuffixes.some((suffix) => dirent.name.endsWith(suffix)) || skippedPrefixes.some((prefix) => dirent.name.startsWith(prefix)))
            continue;
         const path = join(directory, dirent.name);
         const name = prefix ? `${prefix}/${dirent.name}` : dirent.name;

         if (dirent.isSymbolicLink()) {
            const target = await Result.tryPromise(() => realpath(path));
            const info = Result.isOk(target) ? await Result.tryPromise(() => stat(target.value)) : null;
            if (!info || Result.isError(info) || Result.isError(target)) {
               unreadable ??= path;
               return;
            }
            const sharedRoot = sharedRoots.find((candidate) => isPathInside(candidate, target.value));
            if (sharedRoot && info.value.isDirectory() && !followed) {
               links.push({ path: name, sharedPath: toMirrorPath(sharedRoot, target.value) });
            } else if (!isSamePath(realRoot, target.value) && !isPathInside(realRoot, target.value)) {
               unreadable ??= path;
               return;
            } else if (info.value.isDirectory()) {
               if (ancestors.has(target.value)) continue;
               await visit(target.value, name, new Set([...ancestors, target.value]), true);
            } else if (info.value.isFile()) {
               entries.push({ path: name, size: info.value.size, mtimeMs: info.value.mtimeMs });
            }
            continue;
         }

         if (dirent.isDirectory()) await visit(path, name, new Set([...ancestors, path]), followed);
         else if (dirent.isFile()) await file(path, name);
      }
   }

   await visit(realRoot, '', new Set([realRoot]), false);
   if (unreadable) return Result.err(createProblem('mirror.source-unreadable', { path: unreadable }));
   entries.sort((first, second) => (first.path < second.path ? -1 : first.path > second.path ? 1 : 0));
   return Result.ok({ entries, links });
}
