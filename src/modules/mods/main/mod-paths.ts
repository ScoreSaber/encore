import { Result } from 'better-result';

import { parseArchiveEntryPath } from '@/lib/archive/path';
import { beatSaberDataDirectoryName } from '@/modules/installs/main/install-root';

import { join } from 'node:path';

export const modFolders = {
   plugins: 'Plugins',
   libs: 'Libs',
   ipa: 'IPA',
   pending: join('IPA', 'Pending'),
   pluginsPending: join('IPA', 'Pending', 'Plugins'),
   libsPending: join('IPA', 'Pending', 'Libs')
};

export const modScanFolders = [
   { path: modFolders.pluginsPending, holdsUserMods: true },
   { path: modFolders.libsPending, holdsUserMods: true },
   { path: modFolders.plugins, holdsUserMods: true },
   { path: modFolders.libs, holdsUserMods: true },
   { path: modFolders.ipa, holdsUserMods: false }
];

export const modRemovableFolders = [modFolders.plugins, modFolders.libs, modFolders.ipa];

export const modFileExtensions = ['.dll', '.exe', '.manifest'];

export const bsipaInjectorPath = join(beatSaberDataDirectoryName, 'Managed', 'IPA.Injector.dll');
export const bsipaPatcherName = 'IPA.exe';
export const bsipaLoaderName = 'winhttp.dll';

export type ModFilePath = {
   relativePath: string;
   absolutePath: string;
};

export function resolveModContentPath(installPath: string, contentPath: string): ModFilePath | null {
   const parsed = parseArchiveEntryPath(contentPath);
   if (Result.isError(parsed)) return null;

   return { relativePath: parsed.value.segments.join('/'), absolutePath: join(installPath, ...parsed.value.segments) };
}

export function modFileCandidates(installPath: string, contentPath: string, isBsipa: boolean): ModFilePath[] {
   const candidates = isBsipa ? [contentPath, bsipaContentPath(contentPath)] : [contentPath, `${modFolders.pending}/${contentPath}`];
   const resolved = new Map<string, ModFilePath>();

   for (const candidate of candidates) {
      const path = resolveModContentPath(installPath, candidate);
      if (path) resolved.set(path.relativePath, path);
   }

   return [...resolved.values()];
}

export function bsipaContentPath(contentPath: string) {
   const segments = contentPath.replaceAll('\\', '/').split('/');
   const withoutIpa = segments[0] === modFolders.ipa ? segments.slice(1) : segments;

   return [withoutIpa[0] === 'Data' ? beatSaberDataDirectoryName : withoutIpa[0], ...withoutIpa.slice(1)].join('/');
}
