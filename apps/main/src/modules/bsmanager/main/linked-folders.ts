import { Result } from 'better-result';

import { readPathInfo } from '@/lib/filesystem/path';
import { relativeFolderPathSchema } from '@/modules/shared-content/contract';

import { readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

type LinkedInstallFolder = {
   installRelativePath: string;
   linkTargetPath: string;
};

const skippedDescendants = new Set(['beat saber_data/customlevels', 'beat saber_data/customwiplevels']);

export async function findLinkedInstallFolders(installPath: string) {
   const folders: LinkedInstallFolder[] = [];

   async function scan(parentPath: string) {
      const entries = await Result.tryPromise({
         try: () => readdir(parentPath, { withFileTypes: true }),
         catch: (cause) => cause
      });
      if (Result.isError(entries)) return;

      for (const entry of entries.value) {
         const path = join(parentPath, entry.name);
         const parsedRelativePath = relativeFolderPathSchema.safeParse(relative(installPath, path).split(sep).join('/'));
         if (!parsedRelativePath.success) continue;

         const installRelativePath = parsedRelativePath.data;
         if (entry.isSymbolicLink()) {
            const info = await readPathInfo(path);
            if (
               Result.isOk(info) &&
               info.value.targetPath &&
               (info.value.targetKind === 'directory' || (info.value.targetKind === undefined && extname(entry.name) === ''))
            ) {
               folders.push({ installRelativePath, linkTargetPath: info.value.targetPath });
            }
            continue;
         }

         if (!entry.isDirectory() || skippedDescendants.has(installRelativePath.toLowerCase())) continue;
         if (entry.name.endsWith('.encore-backup') || entry.name.endsWith('.encore-conflicts')) continue;

         await scan(path);
      }
   }

   await scan(installPath);
   return folders;
}
