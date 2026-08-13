import type { Err, Ok } from 'better-result';

import { causeCode } from '@/lib/errors';
import type { PlaylistProblem, PlaylistProblemCode } from '@/modules/playlists/contract';

export type PlaylistResult<T> = Ok<T, PlaylistProblem> | Err<T, PlaylistProblem>;

export function createPlaylistProblem(
   code: PlaylistProblemCode,
   message: string,
   options: { fileName?: string; cause?: unknown } = {}
): PlaylistProblem {
   const problem: PlaylistProblem = { code, message };
   if (options.fileName) problem.fileName = options.fileName;
   if (options.cause !== undefined) problem.detail = causeCode(options.cause);
   return problem;
}
