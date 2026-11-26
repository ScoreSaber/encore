import { Result } from 'better-result';

import { readCpioFiles } from '@/lib/archive/cpio-read';
import { parseArchiveEntryPath } from '@/lib/archive/path';
import { readTarGzFiles } from '@/lib/archive/tar-read';
import { createProblem, type Problem } from '@/lib/errors';
import { pathExistsSafely, removeQuietly } from '@/lib/filesystem/path';
import { combineSignals, discardBody, fetchHttps } from '@/lib/http/fetch';
import { bytesProgress, throttleReports } from '@/lib/progress';
import { arm64Pins } from '@/modules/arm64/main/arm64-pins';
import type { OperationProgress } from '@/modules/operations/contract';

import { createHash, verify } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const runtimeTimeoutMs = 20_000;

type AssetOptions = { cacheRoot: string; signal: AbortSignal; onProgress: (progress: OperationProgress) => void };

export type Arm64Assets = { unity: string; runtime: string };

export async function ensureArm64Assets(proton: string, options: AssetOptions): Promise<Result<Arm64Assets | null, Problem>> {
   return Result.gen(async function* () {
      const runtime = yield* Result.await(ensureRuntime(proton, options));
      if (!runtime) return Result.ok(null);

      const unity = yield* Result.await(ensureUnity(options));
      return Result.ok({ unity, runtime });
   });
}

async function ensureRuntime(proton: string, { cacheRoot, signal }: AssetOptions): Promise<Result<string | null, Problem>> {
   const name = `armonica-${proton}-${arm64Pins.armonica.commit}`;
   const directory = join(cacheRoot, name);
   if (await pathExistsSafely(directory)) return Result.ok(directory);

   const url = `https://github.com/ScoreSaber/armonica/releases/download/${name}/${name}.tar.gz`;
   const timeout = combineSignals(runtimeTimeoutMs, signal);
   const [archive, signature] = await Promise.all([download(url, timeout), download(`${url}.sig`, timeout)]);
   if (!archive || !signature) return Result.ok(null);
   if (!verify('sha256', archive, arm64Pins.armonica.publicKey, signature)) return verifyFailed(url);

   return publish(directory, async (staging) => {
      for (const { name, data } of readTarGzFiles(archive)) {
         const entry = parseArchiveEntryPath(name);
         if (Result.isOk(entry)) await writeAsset(join(staging, entry.value.path), data);
      }
      return Result.ok();
   });
}

async function ensureUnity(options: AssetOptions): Promise<Result<string, Problem>> {
   const directory = join(options.cacheRoot, `unity-${arm64Pins.unityVersion}`);
   if (await pathExistsSafely(directory)) return Result.ok(directory);

   return publish(directory, async (staging) => {
      const player = await fetchUnityPlayer(staging, options);
      return Result.isError(player) ? player : fetchUnityOpenXR(staging, options.signal);
   });
}

async function fetchUnityPlayer(staging: string, { signal, onProgress }: AssetOptions): Promise<Result<void, Problem>> {
   const { url, range, directory, files } = arm64Pins.unityPlayer;
   const response = await request(url, signal, { Range: range });
   if (!response?.body) return downloadFailed(url);

   const total = Number(response.headers.get('content-length'));
   const report = throttleReports(onProgress);
   const payload = createGunzip();
   const body = readBody(response.body, (received) => report(bytesProgress('arm64-download', received, total)));
   void pipeline(Readable.from(body), payload).catch(() => undefined);

   const pinned = new Map(Object.entries(files).map(([name, pin]) => [`${directory}${name}`, pin]));
   try {
      for await (const file of readCpioFiles(payload)) {
         const pin = pinned.get(file.name);
         if (!pin) continue;

         const data = await file.read();
         if (createHash('sha256').update(data).digest('hex') !== pin.sha256) return verifyFailed(file.name);

         await writeAsset(join(staging, pin.target), data);
         pinned.delete(file.name);
         if (pinned.size === 0) return Result.ok();
      }
      return verifyFailed(url);
   } finally {
      payload.destroy();
   }
}

async function fetchUnityOpenXR(staging: string, signal: AbortSignal): Promise<Result<void, Problem>> {
   const { url, entry, target, patches, sha256 } = arm64Pins.unityOpenXR;
   const archive = await download(url, signal);
   if (!archive) return downloadFailed(url);

   for (const { name, data } of readTarGzFiles(archive)) {
      if (name !== entry) continue;

      const dll = Buffer.from(data);
      for (const { offset, from, to } of patches) dll.fill(0, offset, offset + from.length).write(to, offset, 'latin1');
      if (createHash('sha256').update(dll).digest('hex') !== sha256) break;

      await writeAsset(join(staging, target), dll);
      return Result.ok();
   }
   return verifyFailed(entry);
}

async function publish(directory: string, fill: (staging: string) => Promise<Result<void, Problem>>): Promise<Result<string, Problem>> {
   const staging = `${directory}.partial`;
   await removeQuietly(staging);

   const filled = await Result.tryPromise({
      try: async () => {
         const result = await fill(staging);
         if (Result.isOk(result)) await rename(staging, directory);
         return result;
      },
      catch: (cause) => createProblem('arm64.download-failed', { cause })
   }).then(Result.flatten);
   return filled.map(() => directory);
}

async function download(url: string, signal: AbortSignal) {
   const response = await request(url, signal);
   if (!response) return null;

   const body = await Result.tryPromise(() => response.arrayBuffer());
   return Result.isOk(body) ? Buffer.from(body.value) : null;
}

async function request(url: string, signal: AbortSignal, headers: Record<string, string> = {}) {
   const fetched = await fetchHttps({ url, maxRedirects: 4, send: (target) => fetch(target, { signal, headers, redirect: 'manual' }) });
   if (Result.isError(fetched)) return null;
   if (fetched.value.response.ok) return fetched.value.response;

   await discardBody(fetched.value.response);
   return null;
}

async function* readBody(body: ReadableStream<Uint8Array>, onReceived: (bytes: number) => void) {
   const reader = body.getReader();
   let received = 0;
   try {
      for (;;) {
         const chunk = await reader.read();
         if (chunk.done) return;

         received += chunk.value.byteLength;
         onReceived(received);
         yield chunk.value;
      }
   } finally {
      await Result.tryPromise(() => reader.cancel());
   }
}

async function writeAsset(path: string, data: Uint8Array) {
   await mkdir(dirname(path), { recursive: true });
   await writeFile(path, data);
}

function downloadFailed(detail: string) {
   return Result.err<never, Problem>(createProblem('arm64.download-failed', { detail }));
}

function verifyFailed(detail: string) {
   return Result.err<never, Problem>(createProblem('arm64.verify-failed', { detail }));
}
