import { Result } from 'better-result';

import type { ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { removeQuietly, resolveFilesystemPath } from '@/lib/filesystem/path';

import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type StagingArea = {
   path: string;
   dispose: () => Promise<void>;
};

export type ContentStaging = ReturnType<typeof createContentStaging>;

export function createContentStaging(options: { dataPath: string }) {
   const root = resolveFilesystemPath(join(options.dataPath, 'staging'));
   const liveAreas = new Set<string>();
   let disposed = false;

   async function create(prefix: string) {
      const path = join(root, `${prefix}-${randomUUID()}`);
      if (disposed) {
         return Result.err<StagingArea, ContentProblem>(createProblem('content.staging.failed', { path }));
      }

      liveAreas.add(path);

      const created = await Result.tryPromise({
         try: async () => {
            await mkdir(root, { recursive: true });
            await mkdir(path);
         },
         catch: (cause): ContentProblem => createProblem('content.staging.failed', { path, cause })
      });

      if (Result.isError(created)) {
         liveAreas.delete(path);
         return Result.err<StagingArea, ContentProblem>(created.error);
      }

      if (disposed) {
         liveAreas.delete(path);
         await removeQuietly(path);
         return Result.err<StagingArea, ContentProblem>(createProblem('content.staging.failed', { path }));
      }

      return Result.ok<StagingArea, ContentProblem>({
         path,
         dispose: async () => {
            liveAreas.delete(path);
            await removeQuietly(path);
         }
      });
   }

   async function purge() {
      const entries = await Result.tryPromise(() => readdir(root));
      if (Result.isError(entries)) return;

      const stale = entries.value.map((entry) => join(root, entry)).filter((path) => !liveAreas.has(path));
      await Promise.all(stale.map((path) => removeQuietly(path)));
   }

   async function dispose() {
      disposed = true;
      const open = [...liveAreas];
      liveAreas.clear();
      await Promise.all(open.map((path) => removeQuietly(path)));
   }

   return { root, create, purge, dispose };
}
