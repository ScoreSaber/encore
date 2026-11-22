import { Result } from 'better-result';
import { app, channel } from 'bridge';
import { z } from 'zod';

import appPackage from '../../main/package.json';
import type { createQuestDaemon } from './daemon';
import { createEncoreIpcHost, type EncoreIpcHost } from './ipc-host';
import { createMobileCore } from './mobile-core';
import { createDaemonSecretProtection } from './secret-protection';

import { IpcInvokeError, ipcTransportValueSchema, type IpcTransportValue } from '@/ipc/core';
import { createPendingCalls, nativeFileChoiceSchema, type WebNativeRequest } from '@/ipc/mobile-bridge';
import type { AdbPairingIdentity } from '@/lib/android/android-adb';
import { createProblem, type Problem } from '@/lib/errors';
import { createSecretStore } from '@/lib/security/secret-store';
import { questWirelessSettingsPageSchema } from '@/modules/quest/contract';

import { randomUUID, webcrypto } from 'node:crypto';

const appVersion = appPackage.version;
const nativeErrorSchema = z.object({
   code: z
      .enum([
         'mobile.native-unavailable',
         'mobile.wireless-debugging',
         'mobile.wireless-settings',
         'mobile.wireless-pairing',
         'mobile.wireless-pairing-window',
         'mobile.file-unsupported',
         'mobile.file-too-large',
         'mobile.file-picker',
         'mobile.open-link',
         'mobile.native-failed'
      ])
      .catch('mobile.native-failed'),
   detail: z.string().optional()
});
const bootstrapSchema = z.object({ key: z.string(), backend: z.enum(['android_keystore', 'keychain']) });
const invokeSchema = z.object({ id: z.string(), channel: z.string(), args: z.array(ipcTransportValueSchema) });
const invokeIdSchema = z.object({ id: z.string() });
const nativeResponseSchema = z.object({
   id: z.string(),
   value: ipcTransportValueSchema.optional(),
   error: nativeErrorSchema.optional()
});
const openedLinkSchema = z.object({ status: z.enum(['opened', 'blocked']) });
const wirelessDebuggingSchema = z.object({ port: z.number().int().min(1).max(65_535) });
type NativeRequestArgs = {
   [Request in WebNativeRequest as Request['method']]: Request['args'];
} & {
   findWirelessDebuggingPort: null;
   openWirelessDebuggingSettings: null;
   pairWirelessDebugging: AdbPairingIdentity;
};
type ReadyInfo = { platform: NodeJS.Platform; version: string };
type BootState =
   | { status: 'awaiting-bootstrap' }
   | { status: 'booting' }
   | { status: 'ready'; info: ReadyInfo; host: EncoreIpcHost }
   | { status: 'failed'; error: Problem };

const pendingNative = createPendingCalls();
let bootState: BootState = { status: 'awaiting-bootstrap' };

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true, configurable: true });

function reportFatal(cause: unknown) {
   console.error(cause);
   if (bootState.status === 'awaiting-bootstrap' || bootState.status === 'booting') {
      const error = createProblem('mobile.start-failed', { cause });
      bootState = { status: 'failed', error };
      channel.post('encore:startup-error', error);
   }
}
process.on('uncaughtException', reportFatal);
process.on('unhandledRejection', reportFatal);

channel.on('encore:native-response', (message) => {
   const parsed = nativeResponseSchema.safeParse(message);
   if (!parsed.success) return;
   const { id, error, value } = parsed.data;
   pendingNative.resolve(id, error ? Result.err(createProblem(error.code, { cause: error.detail })) : Result.ok(value));
});

function callNative<Method extends keyof NativeRequestArgs>(method: Method, args: NativeRequestArgs[Method], timeoutMs = 5 * 60_000) {
   const id = randomUUID();
   const result = pendingNative.track(id, timeoutMs, () => createProblem('mobile.native-timeout'));
   channel.post('encore:native', { id, method, args });
   return result;
}

export function runMobileDaemon(platform: 'android' | 'darwin', createQuest?: typeof createQuestDaemon) {
   channel.on('encore:invoke', (message) => {
      const parsed = invokeSchema.safeParse(message);
      if (!parsed.success) {
         const fallback = invokeIdSchema.safeParse(message);
         if (fallback.success) {
            channel.post('encore:response', { id: fallback.data.id, error: createProblem('mobile.request-failed') });
         }
         return;
      }
      if (bootState.status !== 'ready') {
         channel.post('encore:response', { id: parsed.data.id, error: createProblem('mobile.request-failed') });
         return;
      }
      const { host } = bootState;
      void Result.tryPromise({
         try: () => host.invoke(parsed.data.channel, ...parsed.data.args),
         catch: (cause): Problem =>
            IpcInvokeError.is(cause) ? { code: cause.code, message: cause.message } : createProblem('mobile.request-failed', { cause })
      }).then((result) => {
         channel.post(
            'encore:response',
            Result.isOk(result) ? { id: parsed.data.id, value: result.value } : { id: parsed.data.id, error: result.error }
         );
      });
   });
   channel.on('encore:bootstrap', (message) => {
      if (bootState.status === 'booting' || bootState.status === 'ready') return;
      const parsed = bootstrapSchema.safeParse(message);
      if (!parsed.success) {
         const error = createProblem('mobile.secure-storage-unavailable');
         bootState = { status: 'failed', error };
         channel.post('encore:startup-error', error);
         return;
      }
      bootState = { status: 'booting' };
      void Result.tryPromise({
         try: () => start(platform, parsed.data, createQuest),
         catch: (cause) => createProblem('mobile.start-failed', { cause })
      }).then((result) => {
         const started = Result.flatten(result);
         if (Result.isError(started)) {
            bootState = { status: 'failed', error: started.error };
            channel.post('encore:startup-error', started.error);
            return;
         }
         bootState = { status: 'ready', info: started.value.info, host: started.value.host };
         channel.post('encore:ready', started.value.info);
      });
   });
   channel.on('encore:attach', () => {
      if (bootState.status === 'ready') {
         channel.post('encore:ready', bootState.info);
         return;
      }
      if (bootState.status === 'booting') return;
      bootState = { status: 'awaiting-bootstrap' };
      channel.post('encore:bootstrap-required');
   });
   channel.post('encore:bootstrap-required');
}

async function start(platform: 'android' | 'darwin', bootstrap: z.infer<typeof bootstrapSchema>, createQuest?: typeof createQuestDaemon) {
   const dataPath = app.datadir();
   const secretStore = createSecretStore({
      dataPath,
      platform,
      protection: createDaemonSecretProtection(Buffer.from(bootstrap.key, 'base64'), bootstrap.backend)
   });
   const core = createMobileCore({ dataPath, appVersion, platform, secretStore });
   const quest = createQuest?.(core, {
      findWirelessDebuggingPort: async () =>
         (await callNative('findWirelessDebuggingPort', null, 15_000))
            .andThen((value) => readNative(wirelessDebuggingSchema, value))
            .map(({ port }) => port),
      openWirelessDebuggingSettings: async () =>
         (await callNative('openWirelessDebuggingSettings', null, 5_000)).andThen((value) => readNative(questWirelessSettingsPageSchema, value)),
      pairWirelessDebugging: async (input) => (await callNative('pairWirelessDebugging', input, 20_000)).map(() => undefined)
   });
   const host = createEncoreIpcHost({
      core,
      quest,
      platform,
      native: {
         chooseFile: async (extensions) =>
            (await callNative('chooseFile', { extensions })).andThen((value) => readNative(nativeFileChoiceSchema, value)),
         copyText: async (text) => (await callNative('copyText', { text })).map(() => undefined),
         openLink: async (url) => (await callNative('openLink', { url })).andThen((value) => readNative(openedLinkSchema, value))
      }
   });
   const [daemonStarted, hostRestored] = await Promise.all([
      Result.tryPromise({ try: async () => quest?.start(), catch: (cause) => createProblem('mobile.start-failed', { cause }) }),
      Result.tryPromise({ try: () => host.ready, catch: (cause) => createProblem('mobile.start-failed', { cause }) })
   ]);
   const started = daemonStarted.andThen(() => hostRestored);
   if (Result.isError(started)) {
      host.dispose();
      await Result.tryPromise({ try: async () => quest?.stop(), catch: (cause) => cause });
      return Result.err(started.error);
   }
   host.subscribeAll((eventChannel, payload) => channel.post('encore:event', { channel: eventChannel, payload }));
   quest?.receiver.subscribe((state) => void callNative('setDaemonEnabled', { enabled: state.enabled }));
   if (quest) void callNative('setDaemonEnabled', { enabled: quest.receiver.getState().enabled });
   const info: ReadyInfo = { platform, version: appVersion };
   return Result.ok({ info, host });
}

function readNative<Schema extends z.ZodType>(schema: Schema, value: IpcTransportValue): Result<z.output<Schema>, Problem> {
   const parsed = schema.safeParse(value);
   return parsed.success ? Result.ok(parsed.data) : Result.err(createProblem('mobile.native-invalid'));
}
