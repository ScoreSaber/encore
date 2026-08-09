import { Result } from 'better-result';

import type { ContentProblem } from '@/lib/content/contract';
import { resolveFilesystemPath } from '@/lib/filesystem/path';

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const contentStagingDirectoryName = 'staging';

export type StagingArea = {
   path: string;
   dispose: () => Promise<void>;
};

export type ContentStaging = ReturnType<typeof createContentStaging>;

export function createContentStaging(options: { dataPath: string; directoryName?: string }) {
   const root = resolveFilesystemPath(join(options.dataPath, options.directoryName ?? contentStagingDirectoryName));
   const liveAreas = new Set<string>();

   async function create(prefix: string) {
      const path = join(root, `${prefix}-${randomUUID()}`);

      const created = await Result.tryPromise({
         try: async () => {
            await mkdir(root, { recursive: true });
            await mkdir(path);
         },
         catch: (cause): ContentProblem => ({
            code: 'content.staging.failed',
            message: 'the staging folder could not be created',
            path,
            detail: String(cause)
         })
      });

      if (Result.isError(created)) return Result.err<StagingArea, ContentProblem>(created.error);

      liveAreas.add(path);

      return Result.ok<StagingArea, ContentProblem>({
         path,
         dispose: async () => {
            liveAreas.delete(path);
            await discard(path);
         }
      });
   }

   async function purge() {
      const entries = await Result.tryPromise({
         try: () => readdir(root),
         catch: (cause) => String(cause)
      });

      if (Result.isError(entries)) return;

      const stale = entries.value.map((entry) => join(root, entry)).filter((path) => !liveAreas.has(path));
      await Promise.all(stale.map((path) => discard(path)));
   }

   async function dispose() {
      const open = [...liveAreas];
      liveAreas.clear();
      await Promise.all(open.map((path) => discard(path)));
   }

   return { root, create, purge, dispose };
}

async function discard(path: string) {
   await Result.tryPromise({
      try: () => rm(path, { recursive: true, force: true }),
      catch: (cause) => String(cause)
   });
}
