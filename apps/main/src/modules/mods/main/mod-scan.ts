import { Result } from 'better-result';

import { hashFile } from '@/lib/content/content-hash';
import { isPathInside, resolveFilesystemPath } from '@/lib/filesystem/path';
import type { ExternalMod } from '@/modules/mods/contract';
import type { ModCatalogService } from '@/modules/mods/main/mod-catalog';
import { fileHashKey, type ModIndex } from '@/modules/mods/main/mod-index';
import { readEmbeddedManifest } from '@/modules/mods/main/mod-manifest';
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

export type LocalModScan = ModScan & { installedFiles: Map<string, string[]> };

export function withoutInstalledMods(scan: ModScan, modIds: string[]): ModScan {
   const removed = new Set(modIds);
   return { ...scan, installed: new Map([...scan.installed].filter(([modId]) => !removed.has(modId))) };
}

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
}): Promise<LocalModScan> {
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
   const installedFiles = new Map<string, string[]>();
   const unmatched: ScannedFile[] = [];
   const unknown: { file: ScannedFile; md5: string }[] = [];
   const record = (file: ScannedFile, match: InstalledMod | null) => {
      if (!match) {
         if (file.holdsUserMods && extname(file.relativePath).toLowerCase() !== '.manifest') unmatched.push(file);
         return;
      }

      if (!installed.has(match.modId)) installed.set(match.modId, match);
      installedFiles.set(match.modId, [...(installedFiles.get(match.modId) ?? []), file.absolutePath]);
   };

   for (let index = 0; index < files.length; index += hashConcurrency) {
      const chunk = files.slice(index, index + hashConcurrency);
      const hashed = await Promise.all(chunk.map(async (file) => ({ file, local: await matchLocally(file, input.index) })));
      for (const { file, local } of hashed) {
         if ('lookup' in local) unknown.push({ file, md5: local.lookup });
         else record(file, local.match);
      }
   }

   for (let index = 0; index < unknown.length; index += hashConcurrency) {
      const chunk = unknown.slice(index, index + hashConcurrency);
      const looked = await Promise.all(chunk.map(async ({ file, md5 }) => ({ file, match: await lookupMatch(md5, input.index, input.lookupHash) })));
      for (const { file, match } of looked) record(file, match);
   }

   const external: ExternalMod[] = [];
   for (let index = 0; index < unmatched.length; index += hashConcurrency) {
      external.push(...(await Promise.all(unmatched.slice(index, index + hashConcurrency).map(describeExternal))));
   }

   const bsipa = await scanBsipa(input.installPath, input.index, input.lookupHash);
   if (bsipa.installed) installed.set(bsipa.installed.modId, bsipa.installed);

   return {
      installed,
      installedFiles,
      external: external.sort((first, second) => first.path.localeCompare(second.path)),
      bsipaInstalled: bsipa.present
   };
}

async function describeExternal(file: ScannedFile): Promise<ExternalMod> {
   const details = extname(file.relativePath).toLowerCase() === '.dll' ? await readEmbeddedManifest(file.absolutePath) : null;
   return {
      id: file.relativePath,
      name: details?.name ?? modNameFromPath(file.relativePath),
      path: file.relativePath,
      sizeBytes: file.sizeBytes,
      details
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
   const local = await matchLocally(file, index);

   return 'lookup' in local ? lookupMatch(local.lookup, index, lookupHash) : local.match;
}

async function matchLocally(file: ScannedFile, index: ModIndex): Promise<{ match: InstalledMod | null } | { lookup: string }> {
   const md5 = await hashFile(file.absolutePath, 'md5');
   if (Result.isError(md5)) return { match: null };

   const md5Value = md5.value.toLowerCase();
   const byMd5 = index.byFileHash.get(fileHashKey({ algorithm: 'md5', value: md5Value }));
   if (byMd5) return { match: { modId: byMd5.modId, version: byMd5.version } };

   for (const algorithm of index.hashAlgorithms) {
      if (algorithm === 'md5') continue;

      const digest = await hashFile(file.absolutePath, algorithm);
      if (Result.isError(digest)) continue;

      const entry = index.byFileHash.get(fileHashKey({ algorithm, value: digest.value.toLowerCase() }));
      if (entry) return { match: { modId: entry.modId, version: entry.version } };
   }

   return file.holdsUserMods ? { lookup: md5Value } : { match: null };
}

async function lookupMatch(md5: string, index: ModIndex, lookupHash: ModCatalogService['lookupHash']) {
   const looked = await lookupHash(md5);

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
