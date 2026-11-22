import { Result } from 'better-result';

import { adbEndpointSchema } from '@/lib/android/adb-endpoint';
import { findEndOfCentralDirectory, maxEndOfDirectoryTailBytes, parseCentralDirectory } from '@/lib/android/apk-archive';
import { createProblem, type Problem } from '@/lib/errors';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const shellTimeoutMs = 30_000;
const pairTimeoutMs = 20_000;
const transferTimeoutMs = 10 * 60_000;
const maxOutputBytes = 8 * 1024 * 1024;
const maxApkDirectoryBytes = 4 * 1024 * 1024;

export type AdbExec = (input: { adbPath: string; args: string[]; timeoutMs: number }) => Promise<Result<{ stdout: string; stderr: string }, Problem>>;

export type AdbDeviceState = 'device' | 'unauthorized' | 'offline' | 'unknown';

export type AdbDevice = {
   serial: string;
   state: AdbDeviceState;
   model: string | null;
   product: string | null;
};

type AdbClientOptions = {
   adbPath: string;
   exec?: AdbExec;
   installViaShell?: boolean;
};

export type AdbClient = ReturnType<typeof createAdbClient>;

function invalidApkDirectory(): Result<never, Problem> {
   return Result.err(createProblem('android.adb.invalid-apk'));
}

export function createAdbClient(options: AdbClientOptions) {
   const exec = options.exec ?? execAdb;

   function run(args: string[], timeoutMs = shellTimeoutMs) {
      return exec({ adbPath: options.adbPath, args, timeoutMs });
   }

   async function listDevices() {
      return Result.map(await run(['devices', '-l']), (ran) => parseAdbDevices(ran.stdout));
   }

   async function connect(endpoint: string) {
      return runWireless('connect', endpoint);
   }

   async function disconnect(endpoint: string) {
      return runWireless('disconnect', endpoint);
   }

   async function runWireless(command: 'connect' | 'disconnect', endpoint: string) {
      const parsed = adbEndpointSchema.safeParse(endpoint);
      if (!parsed.success) {
         return Result.err<void, Problem>(createProblem('android.adb.invalid-endpoint'));
      }
      const ran = await run([command, parsed.data]);
      if (Result.isError(ran)) return Result.err<void, Problem>(ran.error);

      const output = `${ran.value.stdout}\n${ran.value.stderr}`.trim();
      const succeeded = command === 'connect' ? /(?:already )?connected to /i.test(output) : /disconnected/i.test(output);
      if (!succeeded) {
         return Result.err<void, Problem>(
            createProblem(command === 'connect' ? 'android.adb.connect-failed' : 'android.adb.disconnect-failed', { cause: output })
         );
      }
      return Result.ok<void, Problem>(undefined);
   }

   async function pair(endpoint: string, code: string) {
      const parsed = adbEndpointSchema.safeParse(endpoint);
      if (!parsed.success || !/^\d{6}$/.test(code)) {
         return Result.err<void, Problem>(createProblem('android.adb.invalid-pairing'));
      }
      const ran = await run(['pair', parsed.data, code], pairTimeoutMs);
      const output = Result.isOk(ran) ? `${ran.value.stdout}\n${ran.value.stderr}`.trim().replaceAll(code, '[redacted]') : '';
      if (/successfully paired/i.test(output)) return Result.ok<void, Problem>(undefined);
      return Result.err<void, Problem>(createProblem('android.adb.pair-failed', { cause: Result.isError(ran) ? ran.error.detail : output }));
   }

   async function killServer() {
      return Result.map(await run(['kill-server']), () => undefined);
   }

   async function mdnsConnectPort(host: string) {
      const ran = await run(['mdns', 'services']);
      if (Result.isError(ran)) return null;
      const escaped = host.replaceAll('.', '\\.');
      const port = new RegExp(`_adb-tls-connect\\._tcp\\.?\\s+${escaped}:(\\d+)`).exec(ran.value.stdout)?.[1];
      return port ? Number(port) : null;
   }

   async function tcpip(serial: string, port: number) {
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
         return Result.err<void, Problem>(createProblem('android.adb.invalid-port'));
      }
      const ran = await run(['-s', serial, 'tcpip', String(port)]);
      if (Result.isError(ran)) return Result.err<void, Problem>(ran.error);
      return /restarting in TCP mode/i.test(ran.value.stdout)
         ? Result.ok<void, Problem>(undefined)
         : Result.err<void, Problem>(createProblem('android.adb.tcpip-failed', { cause: ran.value.stderr.trim() || ran.value.stdout.trim() }));
   }

   async function wirelessAddress(serial: string) {
      const read = await shell(serial, 'ip -4 addr show wlan0');
      if (Result.isError(read)) return Result.err<string, Problem>(read.error);
      const address = /\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//.exec(read.value)?.[1];
      return address ? Result.ok<string, Problem>(address) : Result.err<string, Problem>(createProblem('android.adb.wifi-unavailable'));
   }

   async function shell(serial: string, command: string, timeoutMs = shellTimeoutMs): Promise<Result<string, Problem>> {
      return Result.map(await run(['-s', serial, 'shell', command], timeoutMs), (ran) => ran.stdout);
   }

   async function push(serial: string, localPath: string, remotePath: string): Promise<Result<void, Problem>> {
      return Result.map(await run(['-s', serial, 'push', localPath, remotePath], transferTimeoutMs), () => undefined);
   }

   async function pull(serial: string, remotePath: string, localPath: string): Promise<Result<void, Problem>> {
      return Result.map(await run(['-s', serial, 'pull', remotePath, localPath], transferTimeoutMs), () => undefined);
   }

   async function mkdirs(serial: string, remotePath: string): Promise<Result<void, Problem>> {
      return Result.map(await shell(serial, `mkdir -p ${quoteShellArg(remotePath)}`), () => undefined);
   }

   async function removePath(serial: string, remotePath: string): Promise<Result<void, Problem>> {
      return Result.map(await shell(serial, `rm -rf ${quoteShellArg(remotePath)}`), () => undefined);
   }

   async function removeFile(serial: string, remotePath: string): Promise<Result<void, Problem>> {
      return Result.map(await shell(serial, `rm -f -- ${quoteShellArg(remotePath)}`), () => undefined);
   }

   async function listFiles(serial: string, remoteDirectory: string): Promise<Result<string[], Problem>> {
      const listed = await shell(serial, `ls -1 ${quoteShellArg(remoteDirectory)} 2>/dev/null || true`);
      if (Result.isError(listed)) return Result.err<string[], Problem>(listed.error);

      return Result.ok<string[], Problem>(
         listed.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
      );
   }

   async function listModified(serial: string, remoteDirectory: string): Promise<Result<{ name: string; modifiedAt: number }[], Problem>> {
      const listed = await shell(serial, `cd ${quoteShellArg(remoteDirectory)} 2>/dev/null && stat -c '%Y %n' -- * 2>/dev/null; true`);
      if (Result.isError(listed)) return Result.err<{ name: string; modifiedAt: number }[], Problem>(listed.error);

      return Result.ok<{ name: string; modifiedAt: number }[], Problem>(
         listed.value.split('\n').flatMap((line) => {
            const match = /^(\d+) (.+)$/.exec(line.trimEnd());
            return match?.[1] && match[2] ? [{ name: match[2], modifiedAt: Number(match[1]) * 1000 }] : [];
         })
      );
   }

   async function modifiedAt(serial: string, remotePath: string): Promise<Result<number, Problem>> {
      const read = await shell(serial, `stat -c '%Y' -- ${quoteShellArg(remotePath)}`);
      if (Result.isError(read)) return Result.err<number, Problem>(read.error);
      const seconds = Number(read.value.trim());
      return Number.isFinite(seconds) && seconds > 0
         ? Result.ok<number, Problem>(seconds * 1000)
         : Result.err<number, Problem>(createProblem('android.adb.stat-failed'));
   }

   async function fileExists(serial: string, remotePath: string): Promise<Result<boolean, Problem>> {
      const checked = await shell(serial, `test -e ${quoteShellArg(remotePath)} && echo yes || echo no`);
      if (Result.isError(checked)) return Result.err<boolean, Problem>(checked.error);

      return Result.ok<boolean, Problem>(checked.value.trim().endsWith('yes'));
   }

   async function readTextFile(serial: string, remotePath: string): Promise<Result<string, Problem>> {
      return shell(serial, `cat ${quoteShellArg(remotePath)}`);
   }

   async function sha1Files(serial: string, remotePaths: string[]) {
      if (remotePaths.length === 0) return Result.err<string, Problem>(createProblem('android.adb.hash-empty'));
      const hashed = await shell(serial, `set -o pipefail; cat ${remotePaths.map(quoteShellArg).join(' ')} | sha1sum`);
      if (Result.isError(hashed)) return Result.err<string, Problem>(hashed.error);
      const hash = /^[a-f\d]{40}\b/i.exec(hashed.value.trim())?.[0];
      return hash ? Result.ok<string, Problem>(hash.toLowerCase()) : Result.err<string, Problem>(createProblem('android.adb.hash-failed'));
   }

   async function directoryStats(serial: string, remotePath: string) {
      const listed = await shell(serial, `find ${quoteShellArg(remotePath)} -type f -exec stat -c '%s' '{}' ';'`);
      if (Result.isError(listed)) return Result.err<{ bytes: number; files: number }, Problem>(listed.error);
      const sizes = listed.value
         .trim()
         .split(/\s+/)
         .filter((value) => /^\d+$/.test(value))
         .map(Number);
      return Result.ok<{ bytes: number; files: number }, Problem>({
         bytes: sizes.reduce((total, size) => total + size, 0),
         files: sizes.length
      });
   }

   async function packageVersionName(serial: string, packageId: string): Promise<Result<string | null, Problem>> {
      const dumped = await shell(serial, `dumpsys package ${quoteShellArg(packageId)}`);
      if (Result.isError(dumped)) return Result.err<string | null, Problem>(dumped.error);

      const match = /versionName=([^\s]+)/.exec(dumped.value);
      return Result.ok<string | null, Problem>(match?.[1] ?? null);
   }

   async function deviceModel(serial: string): Promise<Result<string | null, Problem>> {
      const read = await shell(serial, 'getprop ro.product.model');
      if (Result.isError(read)) return Result.err<string | null, Problem>(read.error);

      const model = read.value.trim();
      return Result.ok<string | null, Problem>(model.length > 0 ? model : null);
   }

   async function deviceProduct(serial: string): Promise<Result<string | null, Problem>> {
      const read = await shell(serial, 'getprop ro.product.device');
      if (Result.isError(read)) return Result.err<string | null, Problem>(read.error);
      return Result.ok<string | null, Problem>(read.value.trim() || null);
   }

   async function hardwareSerial(serial: string): Promise<Result<string | null, Problem>> {
      const read = await shell(serial, 'getprop ro.serialno');
      if (Result.isError(read)) return Result.err<string | null, Problem>(read.error);
      const identity = read.value.trim();
      return Result.ok<string | null, Problem>(
         identity.length <= 128 && /^[A-Za-z\d._-]+$/.test(identity) && identity.toLowerCase() !== 'unknown' ? identity : null
      );
   }

   async function sdkVersion(serial: string): Promise<Result<number | null, Problem>> {
      const read = await shell(serial, 'getprop ro.build.version.sdk');
      if (Result.isError(read)) return Result.err<number | null, Problem>(read.error);

      const parsed = Number.parseInt(read.value.trim(), 10);
      return Result.ok<number | null, Problem>(Number.isFinite(parsed) ? parsed : null);
   }

   async function packageApkPath(serial: string, packageId: string): Promise<Result<string | null, Problem>> {
      const listed = await shell(serial, `pm path ${quoteShellArg(packageId)}`);
      if (Result.isError(listed)) return Result.err<string | null, Problem>(listed.error);

      const paths = listed.value
         .split('\n')
         .map((line) => line.trim())
         .filter((line) => line.startsWith('package:'))
         .map((line) => line.slice('package:'.length));

      return Result.ok<string | null, Problem>(paths.find((path) => path.endsWith('base.apk')) ?? paths[0] ?? null);
   }

   async function copyPath(serial: string, from: string, to: string): Promise<Result<void, Problem>> {
      return Result.map(await shell(serial, `cp -r ${quoteShellArg(from)} ${quoteShellArg(to)}`, transferTimeoutMs), () => undefined);
   }

   async function overwriteFile(serial: string, from: string, to: string): Promise<Result<void, Problem>> {
      const written = await shell(serial, `test -f ${quoteShellArg(to)} && cat ${quoteShellArg(from)} > ${quoteShellArg(to)}`);
      return Result.map(written, () => undefined);
   }

   async function fileOwner(serial: string, remotePath: string): Promise<Result<string, Problem>> {
      return Result.map(await shell(serial, `stat -c %u ${quoteShellArg(remotePath)}`), (output) => output.trim());
   }

   async function packagePatched(serial: string, packageId: string) {
      const path = await packageApkPath(serial, packageId);
      if (Result.isError(path)) return Result.err<boolean, Problem>(path.error);
      if (!path.value) return Result.ok<boolean, Problem>(false);
      const listed = await shell(serial, `unzip -l ${quoteShellArg(path.value)} 'modded.json'`);
      if (Result.isError(listed)) return packagePatchedFromDirectory(serial, path.value);
      return Result.ok<boolean, Problem>(/^\s*\d+\s+\S+\s+\S+\s+modded\.json\s*$/m.test(listed.value));
   }

   async function packagePatchedFromDirectory(serial: string, apkPath: string): Promise<Result<boolean, Problem>> {
      const tailRead = await readApkTail(serial, apkPath, maxEndOfDirectoryTailBytes);
      if (Result.isError(tailRead)) return Result.err(tailRead.error);
      const { contents: tail, fileBytes } = tailRead.value;
      const eocd = findEndOfCentralDirectory(tail);
      if (
         !eocd ||
         eocd.zip64 ||
         eocd.diskInfo !== 0 ||
         eocd.diskEntries !== eocd.count ||
         eocd.count === 0xffff ||
         eocd.size > maxApkDirectoryBytes ||
         eocd.offset !== fileBytes - tail.length + eocd.offsetInTail - eocd.size
      ) {
         return invalidApkDirectory();
      }

      const directoryTailBytes = eocd.size + tail.length - eocd.offsetInTail;
      let directory: Buffer;
      if (directoryTailBytes <= tail.length) {
         directory = tail.subarray(tail.length - directoryTailBytes, eocd.offsetInTail);
      } else {
         const read = await readApkTail(serial, apkPath, directoryTailBytes);
         if (Result.isError(read)) return Result.err(read.error);
         if (
            read.value.fileBytes !== fileBytes ||
            read.value.contents.length !== directoryTailBytes ||
            !read.value.contents.subarray(eocd.size).equals(tail.subarray(eocd.offsetInTail))
         ) {
            return invalidApkDirectory();
         }
         directory = read.value.contents.subarray(0, eocd.size);
      }

      const entries = parseCentralDirectory(directory, eocd.count);
      return Result.isOk(entries) ? Result.ok(entries.value.some((entry) => entry.name === 'modded.json')) : invalidApkDirectory();
   }

   async function readApkTail(serial: string, apkPath: string, bytes: number): Promise<Result<{ contents: Buffer; fileBytes: number }, Problem>> {
      const path = quoteShellArg(apkPath);
      const read = await shell(serial, `set -o pipefail; stat -c %s ${path} && tail -c ${bytes} ${path} | base64`);
      if (Result.isError(read)) return Result.err(read.error);
      const separator = read.value.indexOf('\n');
      const size = read.value.slice(0, separator).trim();
      const fileBytes = Number(size);
      if (separator < 0 || !/^\d+$/.test(size) || !Number.isSafeInteger(fileBytes)) return invalidApkDirectory();
      const encoded = read.value.slice(separator + 1).replaceAll(/\s/g, '');
      if (encoded.length > Math.ceil(bytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return invalidApkDirectory();
      const contents = Buffer.from(encoded, 'base64');
      return contents.length === Math.min(bytes, fileBytes) && contents.toString('base64') === encoded
         ? Result.ok({ contents, fileBytes })
         : invalidApkDirectory();
   }

   async function forceStop(serial: string, packageId: string): Promise<Result<void, Problem>> {
      return Result.map(await shell(serial, `am force-stop ${quoteShellArg(packageId)}`), () => undefined);
   }

   async function startPackage(serial: string, packageId: string) {
      const resolved = await shell(serial, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${quoteShellArg(packageId)}`);
      if (Result.isError(resolved)) return Result.err<void, Problem>(resolved.error);
      const activity = resolved.value
         .trim()
         .split('\n')
         .findLast((line) => line.startsWith(`${packageId}/`));
      if (!activity) return Result.err<void, Problem>(createProblem('android.adb.launch-unavailable'));
      const started = await shell(serial, `am start -W -n ${quoteShellArg(activity)}`);
      if (Result.isError(started)) return Result.err<void, Problem>(started.error);
      if (/Error:|Exception|Status:\s*(?!ok\b)\w+/i.test(started.value)) {
         return Result.err<void, Problem>(createProblem('android.adb.launch-failed', { cause: started.value.trim() }));
      }
      return Result.ok<void, Problem>(undefined);
   }

   async function packageRunning(serial: string, packageId: string) {
      return Result.map(await shell(serial, `pidof ${quoteShellArg(packageId)} || true`), (output) => /\d/.test(output));
   }

   async function movePath(serial: string, from: string, to: string): Promise<Result<void, Problem>> {
      const moved = await shell(serial, `mv -nT ${quoteShellArg(from)} ${quoteShellArg(to)} && test ! -e ${quoteShellArg(from)}`);
      return Result.map(moved, () => undefined);
   }

   async function uninstallPackage(serial: string, packageId: string) {
      const removed = await shell(serial, `pm uninstall ${quoteShellArg(packageId)}`, transferTimeoutMs);
      if (Result.isError(removed)) return Result.err<void, Problem>(removed.error);
      if (!removed.value.includes('Success')) {
         return Result.err<void, Problem>(createProblem('android.adb.uninstall-failed', { cause: removed.value.trim() }));
      }

      return Result.ok<void, Problem>(undefined);
   }

   async function installApk(serial: string, localPath: string) {
      if (options.installViaShell) {
         const remotePath = `/data/local/tmp/encore-${randomUUID()}.apk`;
         const pushed = await push(serial, localPath, remotePath);
         if (Result.isError(pushed)) return pushed;
         const installed = await shell(serial, `pm install -r ${quoteShellArg(remotePath)}`, transferTimeoutMs);
         await removePath(serial, remotePath);
         if (Result.isError(installed)) return Result.err<void, Problem>(installed.error);
         return installed.value.includes('Success')
            ? Result.ok<void, Problem>(undefined)
            : Result.err<void, Problem>(createProblem('android.adb.install-failed', { cause: installed.value.trim() }));
      }
      const installed = await run(['-s', serial, 'install', localPath], transferTimeoutMs);
      if (Result.isError(installed)) return Result.err<void, Problem>(installed.error);
      if (!installed.value.stdout.includes('Success')) {
         return Result.err<void, Problem>(
            createProblem('android.adb.install-failed', { cause: (installed.value.stderr || installed.value.stdout).trim() })
         );
      }

      return Result.ok<void, Problem>(undefined);
   }

   async function installCompanion(serial: string, localPath: string) {
      const installed = await run(['-s', serial, 'install', '-r', localPath], transferTimeoutMs);
      if (Result.isError(installed)) return Result.err<void, Problem>(installed.error);
      return installed.value.stdout.includes('Success')
         ? Result.ok<void, Problem>(undefined)
         : Result.err<void, Problem>(
              createProblem('android.adb.companion-install-failed', { cause: installed.value.stderr.trim() || installed.value.stdout.trim() })
           );
   }

   return {
      listDevices,
      connect,
      disconnect,
      pair,
      killServer,
      mdnsConnectPort,
      tcpip,
      wirelessAddress,
      shell,
      push,
      pull,
      mkdirs,
      removePath,
      removeFile,
      listFiles,
      listModified,
      modifiedAt,
      fileExists,
      readTextFile,
      sha1Files,
      directoryStats,
      packageVersionName,
      deviceModel,
      deviceProduct,
      hardwareSerial,
      sdkVersion,
      packageApkPath,
      packagePatched,
      copyPath,
      overwriteFile,
      fileOwner,
      forceStop,
      startPackage,
      packageRunning,
      movePath,
      uninstallPackage,
      installApk,
      installCompanion
   };
}

function parseAdbDevices(output: string): AdbDevice[] {
   const devices: AdbDevice[] = [];

   for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('*')) continue;

      const tokens = trimmed.split(/\s+/);
      const [serial, state] = tokens;
      if (!serial || !state) continue;

      devices.push({
         serial,
         state:
            state === 'device' || state === 'unauthorized' || state === 'offline'
               ? state
               : state === 'authorizing' || state === 'connecting'
                 ? 'unauthorized'
                 : 'unknown',
         model: readDeviceToken(tokens, 'model'),
         product: readDeviceToken(tokens, 'product')
      });
   }

   return devices;
}

export function quoteShellArg(value: string) {
   return `'${value.replaceAll("'", `'\\''`)}'`;
}

function readDeviceToken(tokens: string[], key: string) {
   const token = tokens.find((candidate) => candidate.startsWith(`${key}:`));
   return token ? token.slice(key.length + 1) : null;
}

export function execAdb(input: { adbPath: string; args: string[]; timeoutMs: number }) {
   return new Promise<Result<{ stdout: string; stderr: string }, Problem>>((resolve) => {
      execFile(
         input.adbPath,
         input.args,
         { timeout: input.timeoutMs, maxBuffer: maxOutputBytes, windowsHide: true, encoding: 'utf8' },
         (error, stdout, stderr) => {
            if (!error) {
               resolve(Result.ok<{ stdout: string; stderr: string }, Problem>({ stdout, stderr }));
               return;
            }

            const output = (stderr.trim() || stdout.trim() || error.message).split('\n').at(-1) ?? '';
            const code = input.args[0] === 'pair' ? input.args[2] : undefined;
            const cause = `${code ? 'pair' : input.args.join(' ')}: ${code ? output.replaceAll(code, '[redacted]') : output}`;
            resolve(
               Result.err<{ stdout: string; stderr: string }, Problem>(
                  createProblem(error.killed ? 'android.adb.timed-out' : 'android.adb.failed', { cause })
               )
            );
         }
      );
   });
}
