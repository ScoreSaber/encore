import { Result } from 'better-result';
import { z } from 'zod';

import { causeMessage, createProblem, type Problem } from '@/lib/errors';
import { fetchMetaFile, type MetaRequest } from '@/modules/downloads/main/meta-fetch';
import { maxSegmentBytes } from '@/modules/downloads/main/oculus-manifest';

import { randomUUID, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInflate, createInflateRaw, type Inflate } from 'node:zlib';

type InflatedSegment = {
   bytes: number;
   hash: Hash;
};

type SegmentFailure = {
   kind: 'cancelled' | 'compression' | 'too-large' | 'write';
   detail: string;
};

type InflateSegmentOptions = {
   compressedPath: string;
   destination: FileHandle;
   hash: Hash;
   offset: number;
   maxBytes: number;
   signal: AbortSignal;
};

class SegmentOutputLimitError extends Error {}

export async function writeSegment(input: {
   url: string;
   request: Omit<MetaRequest, 'failure'>;
   stagingPath: string;
   compressedBytes: number;
   destination: FileHandle;
   hash: Hash;
   offset: number;
   maxInflatedBytes: number;
}): Promise<Result<InflatedSegment, Problem>> {
   const temporaryPath = join(input.stagingPath, `.encore-oculus-${randomUUID()}.segment`);
   const fetched = await fetchMetaFile(
      input.url,
      { ...input.request, failure: createProblem('downloads.oculus.segment-failed') },
      temporaryPath,
      Math.min(maxSegmentBytes, input.compressedBytes)
   );
   if (Result.isError(fetched) || fetched.value !== input.compressedBytes) {
      await Result.tryPromise({ try: () => rm(temporaryPath, { force: true }), catch: () => undefined });

      return Result.isError(fetched)
         ? Result.err(fetched.error)
         : Result.err(createProblem('downloads.oculus.segment-failed', { detail: `${fetched.value} of ${input.compressedBytes} bytes` }));
   }

   const inflated = await inflateSegmentToFile({
      compressedPath: temporaryPath,
      destination: input.destination,
      hash: input.hash,
      offset: input.offset,
      maxBytes: input.maxInflatedBytes,
      signal: input.request.signal
   });
   const removed = await Result.tryPromise({
      try: () => rm(temporaryPath, { force: true }),
      catch: (cause) => createProblem('downloads.oculus.write-failed', { path: temporaryPath, cause })
   });

   if (Result.isError(inflated)) return Result.err(segmentFailureError(inflated.error));
   if (Result.isError(removed)) return Result.err(removed.error);

   return Result.ok(inflated.value);
}

async function inflateSegmentToFile(options: InflateSegmentOptions) {
   const zlib = await inflateAttempt(options, createInflate);
   if (Result.isOk(zlib) || zlib.error.kind !== 'compression') return zlib;

   const truncated = await Result.tryPromise({
      try: () => options.destination.truncate(options.offset),
      catch: (cause): SegmentFailure => ({ kind: 'write', detail: causeMessage(cause) })
   });
   if (Result.isError(truncated)) return Result.err<InflatedSegment, SegmentFailure>(truncated.error);

   return inflateAttempt(options, createInflateRaw);
}

async function inflateAttempt(options: InflateSegmentOptions, createDecoder: () => Inflate) {
   const hash = options.hash.copy();
   let bytes = 0;

   const streamed = await Result.tryPromise({
      try: () =>
         pipeline(
            createReadStream(options.compressedPath),
            createDecoder(),
            async (inflated: AsyncIterable<Buffer>) => {
               for await (const chunk of inflated) {
                  const position = options.offset + bytes;
                  bytes += chunk.byteLength;
                  if (bytes > options.maxBytes) throw new SegmentOutputLimitError('the inflated segment is too large');

                  hash.update(chunk);
                  await writeChunkAt(options.destination, chunk, position);
               }
            },
            { signal: options.signal }
         ),
      catch: (cause) => classifySegmentFailure(cause, options.signal)
   });
   if (Result.isError(streamed)) return Result.err<InflatedSegment, SegmentFailure>(streamed.error);

   return Result.ok<InflatedSegment, SegmentFailure>({ bytes, hash });
}

async function writeChunkAt(destination: FileHandle, chunk: Buffer, position: number) {
   let offset = 0;
   while (offset < chunk.byteLength) {
      const { bytesWritten } = await destination.write(chunk, offset, chunk.byteLength - offset, position + offset);
      if (bytesWritten === 0) throw new Error('the destination file stopped accepting data');
      offset += bytesWritten;
   }
}

function classifySegmentFailure(cause: unknown, signal: AbortSignal): SegmentFailure {
   if (signal.aborted) return { kind: 'cancelled', detail: 'the download was cancelled' };
   if (cause instanceof SegmentOutputLimitError) return { kind: 'too-large', detail: cause.message };

   const coded = z.object({ code: z.string() }).safeParse(cause);
   if (coded.success && coded.data.code.startsWith('Z_')) return { kind: 'compression', detail: causeMessage(cause) };

   return { kind: 'write', detail: causeMessage(cause) };
}

function segmentFailureError(failure: SegmentFailure) {
   if (failure.kind === 'cancelled') return createProblem('downloads.oculus.cancelled');
   if (failure.kind === 'write') return createProblem('downloads.oculus.write-failed', { detail: failure.detail });

   return createProblem('downloads.oculus.segment-invalid', { detail: failure.detail });
}
