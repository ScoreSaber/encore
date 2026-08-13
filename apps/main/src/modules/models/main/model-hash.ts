import { Result } from 'better-result';

import type { ModelHash, ModelProblem, ModelType } from '@/modules/models/contract';
import { createModelProblem, type ModelProblemOptions, type ModelResult } from '@/modules/models/main/model-problem';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export async function computeModelHash(input: { path: string; fileName?: string; type?: ModelType }): Promise<ModelResult<ModelHash>> {
   return Result.tryPromise({
      try: async () => {
         const hash = createHash('md5');
         await pipeline(createReadStream(input.path), hash);

         return hash.digest('hex');
      },
      catch: (cause): ModelProblem => {
         const options: ModelProblemOptions = { cause };
         if (input.fileName) options.fileName = input.fileName;
         if (input.type) options.type = input.type;
         return createModelProblem('models.hash.failed', 'this model file could not be read', options);
      }
   });
}
