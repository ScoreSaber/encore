import { Result } from 'better-result';

import { hashFile } from '@/lib/content/content-hash';
import { isPathInside, resolveFilesystemPath } from '@/lib/filesystem/path';
import type { ExternalMod } from '@/modules/mods/contract';
import type { ModCatalogService } from '@/modules/mods/main/mod-catalog';
import { fileHashKey, type ModIndex } from '@/modules/mods/main/mod-index';
import { bsipaInjectorPath, modFileExtensions, modScanFolders } from '@/modules/mods/main/mod-paths';

import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const maxScanDepth = 6;
const maxScanFiles = 4_000;
const hashConcurrency = 8;

export type InstalledMod = {
   modId: string;
   version: string;
};

export type ModScan = {
   installed: Map<string, InstalledMod>;
   external: ExternalMod[];
   bsipaInstalled: boolean;
};

type ScannedFile = {
   absolutePath: string;
   relativePath: string;
   sizeBytes: number;
   holdsUserMods: boolean;
};

type ModWalk = {
   installPath: string;
   rootPath: string;
   holdsUserMods: boolean;
   files: ScannedFile[];
   visitedDirectories: Set<string>;
   seenFiles: Set<string>;
};

export async function scanInstalledMods(input: {
   installPath: string;
   index: ModIndex;
   lookupHash: ModCatalogService['lookupHash'];
}): Promise<ModScan> {
   const files: ScannedFile[] = [];
   const visitedDirectories = new Set<string>();
   const seenFiles = new Set<string>();

   for (const folder of modScanFolders) {
      const folderPath = join(input.installPath, folder.path);
      const rootPath = await readRealPath(folderPath);
      if (!rootPath) continue;

      await walkModDirectory(
         { installPath: input.installPath, rootPath, holdsUserMods: folder.holdsUserMods, files, visitedDirectories, seenFiles },
         folderPath,
         0
      );
   }

   const installed = new Map<string, InstalledMod>();
   const external: ExternalMod[] = [];

   for (let index = 0; index < files.length; index += hashConcurrency) {
      const chunk = files.slice(index, index + hashConcurrency);
      const matches = await Promise.all(chunk.map((file) => matchModFile(file, input.index, input.lookupHash)));

      for (const [offset, match] of matches.entries()) {
         const file = chunk[offset];
         if (!file) continue;

         if (!match) {
            if (file.holdsUserMods && extname(file.relativePath).toLowerCase() !== '.manifest') {
               external.push({ id: file.relativePath, name: modNameFromPath(file.relativePath), path: file.relativePath, sizeBytes: file.sizeBytes });
            }
            continue;
         }

         if (!installed.has(match.modId)) installed.set(match.modId, match);
      }
   }

   const bsipa = await scanBsipa(input.installPath, input.index, input.lookupHash);
   if (bsipa.installed) installed.set(bsipa.installed.modId, bsipa.installed);

   return {
      installed,
      external: external.sort((first, second) => first.path.localeCompare(second.path)),
      bsipaInstalled: bsipa.present
   };
}

async function scanBsipa(installPath: string, index: ModIndex, lookupHash: ModCatalogService['lookupHash']) {
   const injectorPath = join(installPath, bsipaInjectorPath);
   const stats = await Result.tryPromise({ try: () => stat(injectorPath), catch: () => null });
   if (Result.isError(stats) || !stats.value.isFile()) return { present: false, installed: null };

   const file: ScannedFile = { absolutePath: injectorPath, relativePath: bsipaInjectorPath, sizeBytes: stats.value.size, holdsUserMods: true };

   return { present: true, installed: await matchModFile(file, index, lookupHash) };
}

async function matchModFile(file: ScannedFile, index: ModIndex, lookupHash: ModCatalogService['lookupHash']): Promise<InstalledMod | null> {
   const md5 = await hashFile(file.absolutePath, 'md5');
   if (Result.isError(md5)) return null;

   const md5Value = md5.value.toLowerCase();
   const byMd5 = index.byFileHash.get(fileHashKey({ algorithm: 'md5', value: md5Value }));
   if (byMd5) return { modId: byMd5.modId, version: byMd5.version };

   for (const algorithm of index.hashAlgorithms) {
      if (algorithm === 'md5') continue;

      const digest = await hashFile(file.absolutePath, algorithm);
      if (Result.isError(digest)) continue;

      const entry = index.byFileHash.get(fileHashKey({ algorithm, value: digest.value.toLowerCase() }));
      if (entry) return { modId: entry.modId, version: entry.version };
   }

   if (!file.holdsUserMods) return null;

   const looked = await lookupHash(md5Value);

   return looked && index.byModId.has(looked.modId) ? looked : null;
}

async function walkModDirectory(walk: ModWalk, directoryPath: string, depth: number) {
   const realDirectoryPath = await readRealPath(directoryPath);
   if (!realDirectoryPath || walk.visitedDirectories.has(realDirectoryPath)) return;

   walk.visitedDirectories.add(realDirectoryPath);
   await collectModFiles(walk, directoryPath, depth);
}

async function collectModFiles(walk: ModWalk, directoryPath: string, depth: number) {
   if (depth > maxScanDepth || walk.files.length >= maxScanFiles) return;

   const entries = await Result.tryPromise({ try: () => readdir(directoryPath, { withFileTypes: true }), catch: () => null });
   if (Result.isError(entries)) return;

   for (const entry of entries.value) {
      if (walk.files.length >= maxScanFiles) return;

      const entryPath = join(directoryPath, entry.name);

      if (entry.isDirectory()) {
         await walkModDirectory(walk, entryPath, depth + 1);
         continue;
      }

      if (entry.isSymbolicLink()) {
         const kind = await resolveLinkInside(walk.rootPath, entryPath);
         if (kind === 'directory') await walkModDirectory(walk, entryPath, depth + 1);
         if (kind === 'file') await addModFile(walk, entryPath);
         continue;
      }

      if (entry.isFile()) await addModFile(walk, entryPath);
   }
}

async function addModFile(walk: ModWalk, filePath: string) {
   if (!modFileExtensions.includes(extname(filePath).toLowerCase())) return;

   const relativePath = relative(walk.installPath, filePath).split(sep).join('/');
   if (walk.seenFiles.has(relativePath)) return;

   const stats = await Result.tryPromise({ try: () => stat(filePath), catch: () => null });
   if (Result.isError(stats) || !stats.value.isFile()) return;

   walk.seenFiles.add(relativePath);
   walk.files.push({ absolutePath: filePath, relativePath, sizeBytes: stats.value.size, holdsUserMods: walk.holdsUserMods });
}

async function resolveLinkInside(rootPath: string, linkPath: string) {
   const targetPath = await readRealPath(linkPath);
   if (!targetPath || !isPathInside(rootPath, targetPath)) return null;

   const stats = await Result.tryPromise({ try: () => lstat(targetPath), catch: () => null });
   if (Result.isError(stats)) return null;

   return stats.value.isDirectory() ? 'directory' : stats.value.isFile() ? 'file' : null;
}

async function readRealPath(targetPath: string) {
   const resolved = await Result.tryPromise({ try: () => realpath(targetPath), catch: () => null });

   return Result.isOk(resolved) ? resolveFilesystemPath(resolved.value) : null;
}

function modNameFromPath(relativePath: string) {
   const fileName = relativePath.split('/').at(-1) ?? relativePath;
   const extension = extname(fileName);

   return extension ? fileName.slice(0, -extension.length) : fileName;
}
