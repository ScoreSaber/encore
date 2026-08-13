import { Result } from 'better-result';
import { z } from 'zod';

import { abortableSleep } from '@/lib/async';
import { causeMessage } from '@/lib/errors';
import { createUniquePath, isPathInside, resolveManagedPath } from '@/lib/filesystem/path';
import {
   unavailableDownloadPreview,
   versionSupportsStore,
   type DownloadIssue,
   type DownloadOutcome,
   type DownloadResult,
   type DownloadWarning,
   type OculusDownloadPreview,
   type UnavailableDownloadPreview
} from '@/modules/downloads/contract';
import type { MetaAuthRequest } from '@/modules/downloads/main/meta-auth';
import {
   maxManifestEntryBytes,
   maxSegmentBytes,
   metaManifestUrl,
   metaSegmentUrl,
   parseOculusManifest,
   type OculusManifest,
   type OculusManifestFile
} from '@/modules/downloads/main/oculus-manifest';
import type { VersionCatalog } from '@/modules/downloads/main/version-catalog';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationError, OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

import { createHash, randomUUID, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflate, createInflateRaw, type Inflate } from 'node:zlib';

const oculusIssueMessages = new Map<DownloadIssue, string>([
   ['binary-unavailable', 'Meta does not serve an Oculus PC build of this Beat Saber version'],
   ['catalog-unavailable', 'the Beat Saber version list is unavailable'],
   ['inspect-failed', 'the download could not be prepared'],
   ['unknown-version', 'this Beat Saber version is not in the version list'],
   ['unsupported-platform', 'Oculus PC downloads need Windows']
]);

type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

type OculusDownloaderOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
   operations: OperationRegistry;
   catalog: VersionCatalog;
   requestToken: MetaAuthRequest;
   platform?: NodeJS.Platform;
   fetchBinary?: FetchLike;
   concurrency?: number;
   maxAttempts?: number;
};

type DownloadState = {
   binaryId: string;
   token: string;
   destinationPath: string;
   operationId: OperationId;
   signal: AbortSignal;
   totalBytes: number;
   bytes: number;
   files: number;
   totalFiles: number;
   lastReportAt: number;
};

// this token exists only for a download and is never persisted, logged, or returned
export type OculusDownloader = ReturnType<typeof createOculusDownloader>;

export function createOculusDownloader(options: OculusDownloaderOptions) {
   const platform = options.platform ?? process.platform;
   const fetchBinary = options.fetchBinary ?? ((url, init) => fetch(url, init));
   const concurrency = options.concurrency ?? 2;
   const maxAttempts = options.maxAttempts ?? 3;

   async function getCatalog() {
      return options.catalog.get();
   }

   async function refreshCatalog() {
      return options.catalog.refresh();
   }

   async function preview(version: string): Promise<OculusDownloadPreview | UnavailableDownloadPreview> {
      if (platform !== 'win32') return unavailable(version, 'unsupported-platform');

      const catalog = await options.catalog.get();
      if (catalog.status !== 'ready') return unavailable(version, 'catalog-unavailable', catalog.problem?.code);

      const entry = catalog.versions.find((candidate) => candidate.version === version);
      if (!entry) return unavailable(version, 'unknown-version');
      if (!versionSupportsStore(entry, 'oculus') || !entry.oculusBinaryId) return unavailable(entry.version, 'binary-unavailable');

      const settings = await options.settingsStore.getSnapshot();
      const installRoot = settings.library.installRoot;
      const desiredPath = join(installRoot, `Beat Saber ${entry.version}`);
      const destination = await createUniquePath(desiredPath);
      if (Result.isError(destination)) return unavailable(version, 'inspect-failed', destination.error.detail);

      const warnings: DownloadWarning[] = ['meta-sign-in-opens'];
      if (destination.value !== desiredPath) warnings.push('name-conflict');

      return {
         status: 'ok',
         store: 'oculus',
         version: entry.version,
         binaryId: entry.oculusBinaryId,
         name: basename(destination.value),
         installRoot,
         destinationPath: destination.value,
         warnings
      };
   }

   async function start(version: string): Promise<DownloadResult> {
      const previewed = await preview(version);

      if (previewed.status === 'unavailable') {
         return {
            ok: false,
            error: {
               code: `downloads.oculus.${previewed.issue}`,
               message: oculusIssueMessages.get(previewed.issue) ?? 'the download could not be prepared',
               details: { version: previewed.version, detail: previewed.detail }
            }
         };
      }

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: `Download Beat Saber ${previewed.version}`,
         message: previewed.destinationPath,
         progress: { phase: 'preparing', current: 0, percent: 0, unit: 'bytes' },
         metadata: {
            version: previewed.version,
            store: 'oculus',
            destinationPath: previewed.destinationPath
         },
         cancel: () => controller.abort()
      });

      void runDownload(operation.id, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runDownload(operationId: OperationId, previewed: OculusDownloadPreview, signal: AbortSignal) {
      const managed = await resolveManagedPath({ root: previewed.installRoot, path: previewed.destinationPath });
      if (Result.isError(managed)) {
         return options.operations.fail(operationId, {
            code: 'downloads.oculus.destination-rejected',
            message: 'the download destination is outside the install root',
            details: { path: previewed.destinationPath }
         });
      }

      options.operations.update(operationId, { progress: { phase: 'authenticating', percent: 0, unit: 'bytes' } });

      const token = await options.requestToken({ signal });
      if (Result.isError(token)) {
         return options.operations.fail(operationId, { code: token.error.code, message: token.error.message });
      }

      const manifest = await readManifest(previewed.binaryId, token.value, signal);
      if (Result.isError(manifest)) return options.operations.fail(operationId, manifest.error);

      const reserved = await reserveDestination(previewed.installRoot, managed.value.path);
      if (Result.isError(reserved)) return options.operations.fail(operationId, reserved.error);

      const files = Object.entries(manifest.value.files);
      const state: DownloadState = {
         binaryId: previewed.binaryId,
         token: token.value,
         destinationPath: managed.value.path,
         operationId,
         signal,
         totalBytes: files.reduce((total, [, file]) => total + file.size, 0),
         bytes: 0,
         files: 0,
         totalFiles: files.length,
         lastReportAt: 0
      };

      const downloaded = await downloadFiles(files, state);
      if (Result.isError(downloaded)) {
         await discardPartialDownload(state.destinationPath);
         return options.operations.fail(operationId, downloaded.error);
      }

      const registered = await options.registry.register({
         source: 'library',
         path: state.destinationPath,
         store: 'oculus'
      });
      if (Result.isError(registered)) {
         return options.operations.fail(operationId, {
            code: registered.error.code,
            message: registered.error.message,
            details: { path: registered.error.path, detail: registered.error.detail }
         });
      }

      const outcome: DownloadOutcome = {
         installId: registered.value.id,
         store: 'oculus',
         name: registered.value.name,
         path: state.destinationPath,
         version: previewed.version,
         bytes: state.bytes,
         files: state.files
      };
      options.operations.complete(operationId, outcome);
   }

   async function readManifest(binaryId: string, token: string, signal: AbortSignal) {
      const payload = await fetchBinaryPayload(
         metaManifestUrl(binaryId, token),
         signal,
         'downloads.oculus.manifest-unavailable',
         'the Oculus PC build could not be requested from Meta',
         maxManifestEntryBytes
      );
      if (Result.isError(payload)) return Result.err<OculusManifest, OperationError>(payload.error);

      const manifest = parseOculusManifest(Buffer.from(payload.value));
      if (Result.isError(manifest)) {
         return Result.err<OculusManifest, OperationError>({
            code: 'downloads.oculus.manifest-invalid',
            message: 'Meta did not return a usable file list for this build',
            details: { detail: manifest.error }
         });
      }

      return Result.ok<OculusManifest, OperationError>(manifest.value);
   }

   async function downloadFiles(files: [string, OculusManifestFile][], state: DownloadState) {
      let next = 0;
      let failure: OperationError | null = null;

      const worker = async () => {
         for (;;) {
            const index = next;
            next += 1;
            const entry = files[index];
            if (!entry || failure) return;

            const written = await downloadFile(entry[0], entry[1], state);
            if (Result.isError(written)) {
               failure ??= written.error;
               return;
            }
         }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

      return failure ? Result.err<void, OperationError>(failure) : Result.ok<void, OperationError>(undefined);
   }

   async function downloadFile(name: string, file: OculusManifestFile, state: DownloadState) {
      const filePath = join(state.destinationPath, name);
      if (!isPathInside(state.destinationPath, filePath)) {
         return Result.err<void, OperationError>({
            code: 'downloads.oculus.file-rejected',
            message: 'the Meta file list pointed outside the install folder',
            details: { name }
         });
      }

      const prepared = await Result.tryPromise({
         try: () => mkdir(dirname(filePath), { recursive: true }),
         catch: (cause): OperationError => ({
            code: 'downloads.oculus.write-failed',
            message: 'the download folder could not be created',
            details: { path: dirname(filePath), detail: String(cause) }
         })
      });
      if (Result.isError(prepared)) return Result.err<void, OperationError>(prepared.error);

      const handle = await Result.tryPromise({
         try: () => open(filePath, 'w'),
         catch: (cause): OperationError => ({
            code: 'downloads.oculus.write-failed',
            message: 'a downloaded file could not be written',
            details: { path: filePath, detail: String(cause) }
         })
      });
      if (Result.isError(handle)) return Result.err<void, OperationError>(handle.error);

      let hash = createHash('sha256');
      let fileBytes = 0;
      let written: Result<void, OperationError> = Result.ok<void, OperationError>(undefined);

      for (const segment of file.segments) {
         const remainingBytes = file.size - fileBytes;
         if (remainingBytes < 0) {
            written = Result.err<void, OperationError>({
               code: 'downloads.oculus.integrity-failed',
               message: 'a downloaded file was larger than the size Meta published',
               details: { name }
            });
            break;
         }

         const segmentWritten = await writeSegment(handle.value, hash, fileBytes, segment, Math.min(maxSegmentBytes, remainingBytes), state);
         if (Result.isError(segmentWritten)) {
            written = Result.err<void, OperationError>(segmentWritten.error);
            break;
         }

         hash = segmentWritten.value.hash;
         fileBytes += segmentWritten.value.bytes;
         state.bytes += segmentWritten.value.bytes;
         reportProgress(state);
      }

      if (Result.isOk(written) && fileBytes !== file.size) {
         written = Result.err<void, OperationError>({
            code: 'downloads.oculus.integrity-failed',
            message: 'a downloaded file did not match the size Meta published',
            details: { name }
         });
      }

      const closed = await Result.tryPromise({
         try: () => handle.value.close(),
         catch: (cause): OperationError => ({
            code: 'downloads.oculus.write-failed',
            message: 'a downloaded file could not be closed',
            details: { path: filePath, detail: String(cause) }
         })
      });
      if (Result.isOk(written) && Result.isError(closed)) written = Result.err<void, OperationError>(closed.error);
      if (Result.isError(written)) return written;

      if (hash.digest('hex') !== file.sha256) {
         return Result.err<void, OperationError>({
            code: 'downloads.oculus.integrity-failed',
            message: 'a downloaded file did not match the checksum Meta published',
            details: { name }
         });
      }

      state.files += 1;
      reportProgress(state);
      return Result.ok<void, OperationError>(undefined);
   }

   async function writeSegment(
      handle: FileHandle,
      hash: Hash,
      offset: number,
      segment: OculusManifestFile['segments'][number],
      maxInflatedBytes: number,
      state: DownloadState
   ) {
      const [, segmentSha256, compressedBytes] = segment;
      const temporaryPath = join(state.destinationPath, `.encore-oculus-${randomUUID()}.segment`);
      const payload = await fetchBinaryFile(
         metaSegmentUrl(state.binaryId, state.token, segmentSha256),
         temporaryPath,
         state.signal,
         'downloads.oculus.segment-failed',
         'part of the download could not be fetched from Meta',
         Math.min(maxSegmentBytes, compressedBytes)
      );
      if (Result.isError(payload)) {
         await discardTemporarySegment(temporaryPath);
         return Result.err<InflatedSegment, OperationError>(payload.error);
      }

      if (payload.value !== compressedBytes) {
         await discardTemporarySegment(temporaryPath);
         return Result.err<InflatedSegment, OperationError>({
            code: 'downloads.oculus.segment-failed',
            message: 'part of the download did not match the size Meta published',
            details: { expectedBytes: compressedBytes, receivedBytes: payload.value }
         });
      }

      const inflated = await inflateSegmentToFile({
         compressedPath: temporaryPath,
         destination: handle,
         hash,
         offset,
         maxBytes: maxInflatedBytes,
         signal: state.signal
      });
      const removed = await removeTemporarySegment(temporaryPath);

      if (Result.isError(inflated)) {
         return Result.err<InflatedSegment, OperationError>(segmentFailureError(inflated.error));
      }
      if (Result.isError(removed)) return Result.err<InflatedSegment, OperationError>(removed.error);

      return Result.ok<InflatedSegment, OperationError>(inflated.value);
   }

   async function fetchBinaryFile(url: string, destinationPath: string, signal: AbortSignal, code: string, message: string, maxBytes: number) {
      let detail = 'no response';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
         if (signal.aborted) return Result.err<number, OperationError>(cancelledError());

         const response = await Result.tryPromise({
            try: () => fetchBinary(url, { signal }),
            catch: (cause) => describeCause(cause)
         });

         if (Result.isOk(response) && response.value.ok) {
            const body = await Result.tryPromise({
               try: () => writeBodyBounded(response.value, destinationPath, maxBytes, signal),
               catch: (cause) => describeCause(cause)
            });
            if (Result.isOk(body)) {
               if (body.value === null) {
                  return Result.err<number, OperationError>({ code, message, details: { detail: 'the response is too large' } });
               }

               return Result.ok<number, OperationError>(body.value);
            }

            await discardResponseBody(response.value);
            detail = body.error;
         } else {
            if (Result.isOk(response)) await discardResponseBody(response.value);
            detail = Result.isOk(response) ? `HTTP ${response.value.status}` : response.error;
         }

         if (attempt < maxAttempts) await abortableSleep(attempt * 500, signal);
      }

      if (signal.aborted) return Result.err<number, OperationError>(cancelledError());

      return Result.err<number, OperationError>({ code, message, details: { detail } });
   }

   async function fetchBinaryPayload(url: string, signal: AbortSignal, code: string, message: string, maxBytes: number) {
      let detail = 'no response';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
         if (signal.aborted) return Result.err<ArrayBuffer, OperationError>(cancelledError());

         const response = await Result.tryPromise({
            try: () => fetchBinary(url, { signal }),
            catch: (cause) => describeCause(cause)
         });

         if (Result.isOk(response) && response.value.ok) {
            const body = await Result.tryPromise({
               try: () => readBodyBounded(response.value, maxBytes),
               catch: (cause) => describeCause(cause)
            });
            if (Result.isOk(body)) {
               if (body.value === null) {
                  return Result.err<ArrayBuffer, OperationError>({ code, message, details: { detail: 'the response is too large' } });
               }

               return Result.ok<ArrayBuffer, OperationError>(body.value);
            }

            await discardResponseBody(response.value);
            detail = body.error;
         } else {
            if (Result.isOk(response)) await discardResponseBody(response.value);
            detail = Result.isOk(response) ? `HTTP ${response.value.status}` : response.error;
         }

         if (attempt < maxAttempts) await abortableSleep(attempt * 500, signal);
      }

      if (signal.aborted) return Result.err<ArrayBuffer, OperationError>(cancelledError());

      return Result.err<ArrayBuffer, OperationError>({ code, message, details: { detail } });
   }

   function reportProgress(state: DownloadState) {
      const now = Date.now();
      if (now - state.lastReportAt < 200) return;
      state.lastReportAt = now;

      options.operations.update(state.operationId, {
         progress: {
            phase: 'downloading',
            current: state.bytes,
            total: state.totalBytes,
            percent: state.totalBytes > 0 ? Math.min(100, Math.round((state.bytes / state.totalBytes) * 100)) : 0,
            unit: 'bytes',
            label: `${state.files}/${state.totalFiles} files`
         }
      });
   }

   function unavailable(version: string | null, issue: DownloadIssue, detail?: string) {
      return unavailableDownloadPreview({ store: 'oculus', version, issue, detail });
   }

   return { getCatalog, refreshCatalog, preview, start };
}

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

async function inflateSegmentToFile(options: InflateSegmentOptions) {
   const zlib = await inflateAttempt(options, createInflate);
   if (Result.isOk(zlib) || zlib.error.kind !== 'compression') return zlib;

   const truncated = await truncateSegmentDestination(options.destination, options.offset);
   if (Result.isError(truncated)) return Result.err<InflatedSegment, SegmentFailure>(truncated.error);

   return inflateAttempt(options, createInflateRaw);
}

async function inflateAttempt(options: InflateSegmentOptions, createDecoder: () => Inflate) {
   const hash = options.hash.copy();
   let bytes = 0;
   const meter = new Transform({
      transform(chunk, _encoding, callback) {
         const payload = z.instanceof(Uint8Array).parse(chunk);
         bytes += payload.byteLength;
         if (bytes > options.maxBytes) {
            callback(new SegmentOutputLimitError('the inflated segment is too large'));
            return;
         }

         hash.update(payload);
         callback(null, payload);
      }
   });

   const streamed = await Result.tryPromise({
      try: () =>
         pipeline(createReadStream(options.compressedPath), createDecoder(), meter, createSegmentWriter(options.destination, options.offset), {
            signal: options.signal
         }),
      catch: (cause) => classifySegmentFailure(cause, options.signal)
   });
   if (Result.isError(streamed)) return Result.err<InflatedSegment, SegmentFailure>(streamed.error);

   return Result.ok<InflatedSegment, SegmentFailure>({ bytes, hash });
}

function createSegmentWriter(destination: FileHandle, offset: number) {
   let position = offset;

   return new Writable({
      write(chunk, _encoding, callback) {
         const payload = Buffer.from(z.instanceof(Uint8Array).parse(chunk));
         void writeChunkAt(destination, payload, position, callback);
         position += payload.byteLength;
      }
   });
}

async function writeChunkAt(destination: FileHandle, chunk: Buffer, position: number, callback: (error?: Error | null) => void) {
   const stored = await Result.tryPromise({
      try: async () => {
         let offset = 0;
         while (offset < chunk.byteLength) {
            const { bytesWritten } = await destination.write(chunk, offset, chunk.byteLength - offset, position + offset);
            if (bytesWritten === 0) throw new Error('the destination file stopped accepting data');
            offset += bytesWritten;
         }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(causeMessage(cause)))
   });

   callback(Result.isError(stored) ? stored.error : null);
}

async function truncateSegmentDestination(destination: FileHandle, offset: number) {
   return Result.tryPromise({
      try: () => destination.truncate(offset),
      catch: (cause): SegmentFailure => ({ kind: 'write', detail: causeMessage(cause) })
   });
}

function classifySegmentFailure(cause: unknown, signal: AbortSignal): SegmentFailure {
   if (signal.aborted) return { kind: 'cancelled', detail: 'the download was cancelled' };
   if (cause instanceof SegmentOutputLimitError) return { kind: 'too-large', detail: cause.message };

   const coded = z.object({ code: z.string() }).safeParse(cause);
   if (coded.success && coded.data.code.startsWith('Z_')) return { kind: 'compression', detail: causeMessage(cause) };

   return { kind: 'write', detail: causeMessage(cause) };
}

function segmentFailureError(failure: SegmentFailure): OperationError {
   if (failure.kind === 'cancelled') return cancelledError();
   if (failure.kind === 'write') {
      return {
         code: 'downloads.oculus.write-failed',
         message: 'a downloaded file could not be written',
         details: { detail: failure.detail }
      };
   }

   return {
      code: 'downloads.oculus.segment-failed',
      message: 'part of the download could not be unpacked',
      details: { detail: failure.kind === 'too-large' ? 'the inflated segment is too large' : 'the segment compression is invalid' }
   };
}

async function writeBodyBounded(response: Response, destinationPath: string, maxBytes: number, signal: AbortSignal) {
   const declaredBytes = Number(response.headers.get('content-length') ?? Number.NaN);
   if (declaredBytes > maxBytes) {
      await discardResponseBody(response);
      return null;
   }

   const handle = await open(destinationPath, 'w');
   if (!response.body) {
      await handle.close();
      return 0;
   }

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

         await writeAll(handle, value);
      }
   } finally {
      if (!complete) await cancelReader(reader);
      await handle.close();
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

async function removeTemporarySegment(path: string) {
   return Result.tryPromise({
      try: () => rm(path, { force: true }),
      catch: (cause): OperationError => ({
         code: 'downloads.oculus.write-failed',
         message: 'a temporary download file could not be removed',
         details: { path, detail: String(cause) }
      })
   });
}

async function discardTemporarySegment(path: string) {
   await Result.tryPromise({
      try: () => rm(path, { force: true }),
      catch: () => undefined
   });
}

async function discardResponseBody(response: Response) {
   const body = response.body;
   if (!body) return;

   await Result.tryPromise({
      try: () => body.cancel(),
      catch: () => undefined
   });
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
   await Result.tryPromise({
      try: () => reader.cancel(),
      catch: () => undefined
   });
}

async function reserveDestination(installRoot: string, destinationPath: string) {
   return Result.tryPromise({
      try: async () => {
         await mkdir(installRoot, { recursive: true });
         await mkdir(destinationPath);
      },
      catch: (cause): OperationError => ({
         code: 'downloads.oculus.destination-unavailable',
         message: 'the download folder could not be created',
         details: { path: destinationPath, detail: String(cause) }
      })
   });
}

async function discardPartialDownload(destinationPath: string) {
   await Result.tryPromise({
      try: () => rm(destinationPath, { recursive: true, force: true }),
      catch: () => null
   });
}

function cancelledError(): OperationError {
   return { code: 'downloads.oculus.cancelled', message: 'the download was cancelled' };
}

async function readBodyBounded(response: Response, maxBytes: number): Promise<ArrayBuffer | null> {
   // chunked responses omit a trustworthy size, so enforce the cap while reading too
   const declaredBytes = Number(response.headers.get('content-length') ?? Number.NaN);
   if (declaredBytes > maxBytes) {
      await discardResponseBody(response);
      return null;
   }

   if (!response.body) return new ArrayBuffer(0);

   const reader = response.body.getReader();
   const chunks: Uint8Array[] = [];
   let size = 0;
   let complete = false;

   try {
      for (;;) {
         const { done, value } = await reader.read();
         if (done) {
            complete = true;
            break;
         }

         size += value.byteLength;
         if (size > maxBytes) return null;

         chunks.push(value);
      }
   } finally {
      if (!complete) await cancelReader(reader);
   }

   const merged = new Uint8Array(size);
   let offset = 0;
   for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
   }

   return merged.buffer;
}

function describeCause(cause: unknown) {
   const detail = causeMessage(cause);

   // Meta URLs contain the access token and must not leak through an error
   return detail.includes('access_token') ? 'the request to Meta failed' : detail;
}
