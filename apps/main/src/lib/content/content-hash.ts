import { Result } from 'better-result';

import type { ContentHash, ContentHashAlgorithm, ContentProblem } from '@/lib/content/contract';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function hashFile(filePath: string, algorithm: ContentHashAlgorithm = 'sha256') {
   const digest = await Result.tryPromise({
      try: async () => {
         const hash = createHash(algorithm);

         for await (const chunk of createReadStream(filePath)) {
            hash.update(chunk);
         }

         return hash.digest('hex');
      },
      catch: (cause): ContentProblem => ({
         code: 'content.hash.read-failed',
         message: 'the staged file could not be hashed',
         path: filePath,
         detail: String(cause)
      })
   });

   return Result.isError(digest) ? Result.err<string, ContentProblem>(digest.error) : Result.ok<string, ContentProblem>(digest.value);
}

export async function verifyFileHash(input: { path: string; expected: ContentHash }) {
   const digest = await hashFile(input.path, input.expected.algorithm);
   if (Result.isError(digest)) return Result.err<string, ContentProblem>(digest.error);

   if (digest.value.toLowerCase() !== input.expected.value.trim().toLowerCase()) {
      return Result.err<string, ContentProblem>({
         code: 'content.hash.mismatch',
         message: 'the downloaded file did not match the expected checksum',
         path: input.path,
         detail: `${input.expected.algorithm} ${digest.value}`
      });
   }

   return Result.ok<string, ContentProblem>(digest.value);
}
