import { Result } from 'better-result';

import { resolveManagedPath } from '@/lib/filesystem/path';

import { mkdir } from 'node:fs/promises';

type ResolvedEntries<Entry> = { status: 'invalid'; issue: 'not-found' } | { status: 'ok'; entries: Entry[] };

export async function resolveManagedEntries<Entry>(input: {
   ids: readonly string[];
   entries: readonly Entry[];
   idOf: (entry: Entry) => string;
   pathOf: (entry: Entry) => string;
   rootOf: (entry: Entry) => string;
}): Promise<ResolvedEntries<Entry>> {
   const wanted = new Set(input.ids);
   const entries = input.entries.filter((entry) => wanted.has(input.idOf(entry)));
   if (entries.length !== wanted.size) return { status: 'invalid', issue: 'not-found' };

   for (const entry of entries) {
      if (!(await isManagedPath(input.rootOf(entry), input.pathOf(entry)))) return { status: 'invalid', issue: 'not-found' };
   }

   return { status: 'ok', entries };
}

export async function isManagedPath(root: string, path: string) {
   const resolved = await resolveManagedPath({ root, path });

   return Result.isOk(resolved);
}

export async function ensureContentFolder(folderPath: string) {
   const created = await Result.tryPromise({
      try: () => mkdir(folderPath, { recursive: true }),
      catch: (cause) => cause
   });

   return Result.isError(created) ? null : folderPath;
}
