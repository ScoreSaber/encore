import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import type { ModelHash, ModelProblem, ModelType } from '@/modules/models/contract';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export async function computeModelHash(input: { path: string; fileName: string; type: ModelType }): Promise<Result<ModelHash, ModelProblem>> {
   return Result.tryPromise({
      try: async () => {
         const hash = createHash('md5');
         await pipeline(createReadStream(input.path), hash);

         return hash.digest('hex');
      },
      catch: (cause): ModelProblem => createProblem('models.hash.failed', { fileName: input.fileName, type: input.type, cause })
   });
}
