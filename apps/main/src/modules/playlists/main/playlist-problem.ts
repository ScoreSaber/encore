import type { Err, Ok } from 'better-result';

import { causeCode } from '@/lib/errors';
import type { PlaylistProblem, PlaylistProblemCode } from '@/modules/playlists/contract';

export type PlaylistResult<T> = Ok<T, PlaylistProblem> | Err<T, PlaylistProblem>;

export function createPlaylistProblem(
   code: PlaylistProblemCode,
   message: string,
   options: { fileName?: string; cause?: unknown } = {}
): PlaylistProblem {
   return {
      code,
      message,
      ...(options.fileName ? { fileName: options.fileName } : {}),
      ...(options.cause === undefined ? {} : { detail: causeCode(options.cause) })
   };
}
