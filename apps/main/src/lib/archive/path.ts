import { Result } from 'better-result';

import { extname } from 'node:path';

type ArchivePathRejection = 'empty' | 'absolute' | 'drive' | 'traversal' | 'reserved-name' | 'invalid-character';

type ArchiveEntryPath = {
   path: string;
   segments: string[];
   endsWithSeparator: boolean;
};

// ZIP entries can be created anywhere, but every extracted name must remain valid on Windows too
const reservedWindowsNames = new Set([
   'CON',
   'PRN',
   'AUX',
   'NUL',
   ...Array.from({ length: 10 }, (_value, index) => `COM${index}`),
   ...Array.from({ length: 10 }, (_value, index) => `LPT${index}`)
]);
const invalidWindowsCharacters = /[<>:"|?*]/;

export function parseArchiveEntryPath(rawName: string) {
   if (!rawName.trim()) return Result.err<ArchiveEntryPath, ArchivePathRejection>('empty');
   if (hasControlCharacter(rawName)) return Result.err<ArchiveEntryPath, ArchivePathRejection>('invalid-character');

   const unified = rawName.replaceAll('\\', '/');
   if (unified.startsWith('/')) return Result.err<ArchiveEntryPath, ArchivePathRejection>('absolute');
   if (/^[a-zA-Z]:/.test(unified)) return Result.err<ArchiveEntryPath, ArchivePathRejection>('drive');
   if (invalidWindowsCharacters.test(unified)) return Result.err<ArchiveEntryPath, ArchivePathRejection>('invalid-character');

   const segments: string[] = [];
   for (const rawSegment of unified.split('/')) {
      const segment = rawSegment.normalize('NFC');
      if (segment === '' || segment === '.') continue;
      if (segment === '..') return Result.err<ArchiveEntryPath, ArchivePathRejection>('traversal');
      if (segment.endsWith('.') || segment.endsWith(' ')) return Result.err<ArchiveEntryPath, ArchivePathRejection>('reserved-name');
      if (reservedWindowsNames.has(segment.split('.')[0]?.toUpperCase() ?? '')) {
         return Result.err<ArchiveEntryPath, ArchivePathRejection>('reserved-name');
      }

      segments.push(segment);
   }

   if (segments.length === 0) return Result.err<ArchiveEntryPath, ArchivePathRejection>('empty');

   return Result.ok<ArchiveEntryPath, ArchivePathRejection>({
      path: segments.join('/'),
      segments,
      endsWithSeparator: unified.endsWith('/')
   });
}

export function archivePathKey(path: string) {
   return path.toLowerCase();
}

export function claimUniqueArchiveEntryName(name: string, usedNames: Set<string>) {
   const extension = extname(name);
   const base = name.slice(0, name.length - extension.length);
   let candidate = name;
   let attempt = 1;

   while (usedNames.has(archivePathKey(candidate))) {
      attempt += 1;
      candidate = `${base} (${attempt})${extension}`;
   }

   usedNames.add(archivePathKey(candidate));

   return candidate;
}

export function describeArchivePathRejection(rejection: ArchivePathRejection) {
   switch (rejection) {
      case 'empty':
         return 'an archive entry has no usable name';
      case 'absolute':
         return 'an archive entry uses an absolute path';
      case 'drive':
         return 'an archive entry uses a drive letter path';
      case 'traversal':
         return 'an archive entry points outside the archive';
      case 'reserved-name':
         return 'an archive entry uses a name Windows reserves';
      case 'invalid-character':
         return 'an archive entry name uses characters a path cannot hold';
   }
}

function hasControlCharacter(rawName: string) {
   for (let index = 0; index < rawName.length; index += 1) {
      const code = rawName.charCodeAt(index);
      if (code < 0x20 || code === 0x7f) return true;
   }

   return false;
}
