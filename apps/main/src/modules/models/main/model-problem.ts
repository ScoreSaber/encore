import type { Err, Ok } from 'better-result';

import { causeCode } from '@/lib/errors';
import type { ModelProblem, ModelProblemCode, ModelType } from '@/modules/models/contract';

export type ModelResult<T> = Ok<T, ModelProblem> | Err<T, ModelProblem>;

export type ModelProblemOptions = { type?: ModelType; fileName?: string; cause?: unknown };

export function createModelProblem(code: ModelProblemCode, message: string, options: ModelProblemOptions = {}): ModelProblem {
   const problem: ModelProblem = { code, message };
   if (options.type) problem.type = options.type;
   if (options.fileName) problem.fileName = options.fileName;
   if (options.cause !== undefined) problem.detail = causeCode(options.cause);
   return problem;
}
