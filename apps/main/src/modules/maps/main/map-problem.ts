import type { Err, Ok } from 'better-result';

import { causeCode } from '@/lib/errors';
import type { MapProblem, MapProblemCode } from '@/modules/maps/contract';

export type MapResult<T> = Ok<T, MapProblem> | Err<T, MapProblem>;

export function createMapProblem(code: MapProblemCode, message: string, options: { folderName?: string; cause?: unknown } = {}): MapProblem {
   return {
      code,
      message,
      ...(options.folderName ? { folderName: options.folderName } : {}),
      ...(options.cause === undefined ? {} : { detail: causeCode(options.cause) })
   };
}
