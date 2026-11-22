import { Result } from 'better-result';

import { abortableSleep } from '@/lib/async';
import { causeMessage, createProblem, type Problem } from '@/lib/errors';

import { open, type FileHandle } from 'node:fs/promises';

export type MetaFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export type MetaRequest = {
   fetch: MetaFetch;
   maxAttempts: number;
   signal: AbortSignal;
   failure: Problem;
};

export function fetchMetaPayload(url: string, request: MetaRequest, maxBytes: number) {
   return fetchWithRetries(url, request, async (response) => {
      const chunks: Uint8Array[] = [];
      const size = await readBounded(response, maxBytes, request.signal, (chunk) => {
         chunks.push(chunk);
      });

      return size === null ? null : Buffer.concat(chunks);
   });
}

export function fetchMetaFile(url: string, request: MetaRequest, destinationPath: string, maxBytes: number) {
   return fetchWithRetries(url, request, async (response) => {
      const handle = await open(destinationPath, 'w');

      try {
         return await readBounded(response, maxBytes, request.signal, (chunk) => writeAll(handle, chunk));
      } finally {
         await handle.close();
      }
   });
}

async function fetchWithRetries<T>(url: string, request: MetaRequest, read: (response: Response) => Promise<T | null>): Promise<Result<T, Problem>> {
   let detail = 'no response';

   for (let attempt = 1; attempt <= request.maxAttempts; attempt += 1) {
      if (request.signal.aborted) return Result.err(createProblem('downloads.oculus.cancelled'));

      const response = await Result.tryPromise({
         try: () => request.fetch(url, { signal: request.signal }),
         catch: describeCause
      });

      if (Result.isOk(response) && response.value.ok) {
         const body = await Result.tryPromise({
            try: () => read(response.value),
            catch: describeCause
         });
         if (Result.isOk(body)) {
            return body.value === null ? Result.err({ ...request.failure, detail: 'the response is too large' }) : Result.ok(body.value);
         }

         await discardResponseBody(response.value);
         detail = body.error;
      } else {
         if (Result.isOk(response)) {
            await discardResponseBody(response.value);
            detail = `HTTP ${response.value.status}`;
            if (response.value.status === 400 || response.value.status === 401 || response.value.status === 403 || response.value.status === 404) {
               return Result.err({ ...request.failure, detail });
            }
         } else {
            detail = response.error;
         }
      }

      if (attempt < request.maxAttempts) await abortableSleep(attempt * 500, request.signal);
   }

   if (request.signal.aborted) return Result.err(createProblem('downloads.oculus.cancelled'));

   return Result.err({ ...request.failure, detail });
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal, onChunk: (chunk: Uint8Array) => void | Promise<void>) {
   const declaredBytes = Number(response.headers.get('content-length') ?? Number.NaN);
   if (declaredBytes > maxBytes) {
      await discardResponseBody(response);
      return null;
   }

   if (!response.body) return 0;

   const reader = response.body.getReader();
   let size = 0;
   let complete = false;

   try {
      for (;;) {
         signal.throwIfAborted();
         const { done, value } = await reader.read();
         if (done) {
            complete = true;
            return size;
         }

         size += value.byteLength;
         if (size > maxBytes) return null;

         await onChunk(value);
      }
   } finally {
      if (!complete) {
         await Result.tryPromise({
            try: () => reader.cancel(),
            catch: () => undefined
         });
      }
   }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array) {
   let offset = 0;

   while (offset < chunk.byteLength) {
      const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
      if (bytesWritten === 0) throw new Error('the segment staging file stopped accepting data');
      offset += bytesWritten;
   }
}

async function discardResponseBody(response: Response) {
   const body = response.body;
   if (!body) return;

   await Result.tryPromise({
      try: () => body.cancel(),
      catch: () => undefined
   });
}

function describeCause(cause: unknown) {
   const detail = causeMessage(cause);

   return detail.includes('access_token') ? 'the request to Meta failed' : detail;
}
