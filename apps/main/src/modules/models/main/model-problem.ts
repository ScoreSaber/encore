import type { Err, Ok } from 'better-result';

import { causeCode } from '@/lib/errors';
import type { ModelProblem, ModelProblemCode, ModelType } from '@/modules/models/contract';

export type ModelResult<T> = Ok<T, ModelProblem> | Err<T, ModelProblem>;

export function createModelProblem(
   code: ModelProblemCode,
   message: string,
   options: { type?: ModelType; fileName?: string; cause?: unknown } = {}
): ModelProblem {
   return {
      code,
      message,
      ...(options.type ? { type: options.type } : {}),
      ...(options.fileName ? { fileName: options.fileName } : {}),
      ...(options.cause === undefined ? {} : { detail: causeCode(options.cause) })
   };
}
