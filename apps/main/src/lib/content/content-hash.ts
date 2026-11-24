import { Result } from 'better-result';

import type { ContentHash, ContentHashAlgorithm, ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function hashFile(filePath: string, algorithm: ContentHashAlgorithm = 'sha256', end?: number) {
   return Result.tryPromise({
      try: async () => {
         const hash = createHash(algorithm);

         for await (const chunk of createReadStream(filePath, { end })) {
            if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected binary chunk');
            hash.update(chunk);
         }

         return hash.digest('hex');
      },
      catch: (cause): ContentProblem => createProblem('content.hash.read-failed', { path: filePath, cause })
   });
}

export async function verifyFileHash(input: { path: string; expected: ContentHash }) {
   const digest = await hashFile(input.path, input.expected.algorithm);
   if (Result.isError(digest)) return Result.err<string, ContentProblem>(digest.error);

   if (digest.value.toLowerCase() !== input.expected.value.trim().toLowerCase()) {
      return Result.err<string, ContentProblem>(
         createProblem('content.hash.mismatch', { path: input.path, detail: `${input.expected.algorithm} ${digest.value}` })
      );
   }

   return Result.ok<string, ContentProblem>(digest.value);
}
