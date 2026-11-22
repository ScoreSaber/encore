import { Result } from 'better-result';

import { extname } from 'node:path';

type ArchivePathRejection = 'empty' | 'absolute' | 'drive' | 'traversal' | 'reservedName' | 'invalidCharacter';

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

export function parseArchiveEntryPath(rawName: string): Result<ArchiveEntryPath, ArchivePathRejection> {
   if (!rawName.trim()) return Result.err('empty');
   if (/\p{Cc}/u.test(rawName)) return Result.err('invalidCharacter');

   const unified = rawName.replaceAll('\\', '/');
   if (unified.startsWith('/')) return Result.err('absolute');
   if (/^[a-zA-Z]:/.test(unified)) return Result.err('drive');
   if (invalidWindowsCharacters.test(unified)) return Result.err('invalidCharacter');

   const segments: string[] = [];
   for (const rawSegment of unified.split('/')) {
      const segment = rawSegment.normalize('NFC');
      if (segment === '' || segment === '.') continue;
      if (segment === '..') return Result.err('traversal');
      if (segment.endsWith('.') || segment.endsWith(' ')) return Result.err('reservedName');
      if (reservedWindowsNames.has(segment.split('.')[0]?.toUpperCase() ?? '')) {
         return Result.err('reservedName');
      }

      segments.push(segment);
   }

   if (segments.length === 0) return Result.err('empty');

   return Result.ok({
      path: segments.join('/'),
      segments,
      endsWithSeparator: unified.endsWith('/')
   });
}

export function claimUniqueArchiveEntryName(name: string, usedNames: Set<string>) {
   const extension = extname(name);
   const base = name.slice(0, name.length - extension.length);
   let candidate = name;
   let attempt = 1;

   while (usedNames.has(candidate.toLowerCase())) {
      attempt += 1;
      candidate = `${base} (${attempt})${extension}`;
   }

   usedNames.add(candidate.toLowerCase());

   return candidate;
}
