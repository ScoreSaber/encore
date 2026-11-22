import { Capacitor } from '@capacitor/core';
import { Nodejs, type MessageArg } from '@capawesome/capacitor-nodejs';
import { Result } from 'better-result';
import { z } from 'zod';

import { EncoreDevice } from './native';

import { createEncoreApi } from '@/ipc/api';
import { IpcInvokeError, ipcTransportValueSchema, type IpcTransportValue } from '@/ipc/core';
import { createPendingCalls, webNativeRequestSchema, type WebNativeRequest } from '@/ipc/mobile-bridge';
import { causeCode, causeMessage, createProblem, type Problem } from '@/lib/errors';

const messageArgSchema = z.custom<MessageArg>();

const bridgeErrorSchema = z.object({ code: z.string(), message: z.string() });
const responseSchema = z.object({
   id: z.string(),
   value: ipcTransportValueSchema.optional(),
   error: bridgeErrorSchema.optional()
});
const eventSchema = z.object({ channel: z.string(), payload: ipcTransportValueSchema.optional() });
const jsNativeRequestHeaderSchema = z.object({
   id: z.string(),
   method: z.enum(['chooseFile', 'copyText', 'openLink', 'setDaemonEnabled'])
});

type BridgeBootState = 'waiting' | 'bootstrapping' | 'settled';

export async function initialiseMobileBridge() {
   const platform = Capacitor.getPlatform();
   if (platform !== 'android' && platform !== 'ios') {
      return Result.err(createProblem('mobile.native-required'));
   }
   await Nodejs.removeAllListeners();

   const pending = createPendingCalls();
   const subscriptions = new Map<string, Set<(payload: IpcTransportValue) => void>>();
   let bootState: BridgeBootState = 'waiting';
   let settleReady = (_result: Result<void, Problem>) => {};
   const ready = new Promise<Result<void, Problem>>((resolve) => {
      const timer = setTimeout(() => settleReady(Result.err(createProblem('mobile.start-timeout'))), 60_000);
      settleReady = (result) => {
         if (bootState === 'settled') return;
         bootState = 'settled';
         clearTimeout(timer);
         resolve(result);
      };
   });

   const readyHandle = await Nodejs.addListener('message', (message) => {
      if (message.eventName === 'encore:bootstrap-required') {
         if (bootState !== 'waiting') return;
         bootState = 'bootstrapping';
         void Result.tryPromise({
            try: async () => Nodejs.send({ eventName: 'encore:bootstrap', args: [await EncoreDevice.getSecretKey()] }),
            catch: (cause) => createProblem('mobile.secure-storage', { cause: causeMessage(cause) })
         }).then((bootstrapped) => {
            if (Result.isError(bootstrapped)) settleReady(bootstrapped);
         });
      }
      if (message.eventName === 'encore:ready') {
         settleReady(Result.ok(undefined));
      }
      if (message.eventName === 'encore:startup-error') {
         const error = bridgeErrorSchema.safeParse(message.args[0]);
         settleReady(Result.err(error.success ? error.data : createProblem('mobile.start-failed')));
      }
   });
   void ready.finally(() => {
      void Result.tryPromise(() => readyHandle.remove());
   });

   await Nodejs.addListener('message', (message) => {
      if (message.eventName === 'encore:response') {
         const response = responseSchema.safeParse(message.args[0]);
         if (!response.success) return;
         const { id, error, value } = response.data;
         pending.resolve(id, error ? Result.err(error) : Result.ok(value));
      }
      if (message.eventName === 'encore:event') {
         const event = eventSchema.safeParse(message.args[0]);
         if (!event.success) return;
         for (const listener of subscriptions.get(event.data.channel) ?? []) listener(event.data.payload);
      }
      if (message.eventName === 'encore:native') {
         const request = webNativeRequestSchema.safeParse(message.args[0]);
         if (request.success) {
            void handleNativeRequest(request.data);
            return;
         }
         const fallback = jsNativeRequestHeaderSchema.safeParse(message.args[0]);
         if (fallback.success) {
            void Result.tryPromise(() =>
               Nodejs.send({
                  eventName: 'encore:native-response',
                  args: [{ id: fallback.data.id, error: { code: 'mobile.native-failed', detail: 'invalid native request' } }]
               })
            );
         }
      }
   });

   async function invoke(channel: string, ...args: IpcTransportValue[]) {
      const id = crypto.randomUUID();
      const result = pending.track(id, 300_000, () => createProblem('mobile.request-timeout'));
      const sent = await Result.tryPromise({
         try: () => Nodejs.send({ eventName: 'encore:invoke', args: [messageArgSchema.parse(JSON.parse(JSON.stringify({ id, channel, args })))] }),
         catch: (cause) => createProblem('mobile.send-failed', { cause: causeMessage(cause) })
      });
      if (Result.isError(sent)) {
         pending.cancel(id);
         throw new IpcInvokeError(sent.error);
      }
      const response = await result;
      if (Result.isError(response)) throw new IpcInvokeError(response.error);
      return response.value;
   }

   window.encore = createEncoreApi(
      platform === 'android' ? 'android' : 'darwin',
      invoke,
      (channel, listener) => {
         const listeners = subscriptions.get(channel) ?? new Set<(payload: IpcTransportValue) => void>();
         listeners.add(listener);
         subscriptions.set(channel, listeners);
         return () => {
            listeners.delete(listener);
            if (listeners.size === 0) subscriptions.delete(channel);
         };
      },
      'mobile'
   );
   if (platform === 'android') {
      window.encore.scanPairingQr = EncoreDevice.scanPairingQr;
   }

   const started = await Result.tryPromise({
      try: async () => {
         if ((await Nodejs.isReady()).ready) {
            await Nodejs.send({ eventName: 'encore:attach' });
            return;
         }
         await Nodejs.start({ script: platform === 'ios' ? 'remote.cjs' : 'quest.cjs' });
      },
      catch: (cause) => createProblem('mobile.start-failed', { cause: causeMessage(cause) })
   });
   if (Result.isError(started)) {
      settleReady(started);
      return started;
   }
   return ready;
}

async function handleNativeRequest(request: WebNativeRequest) {
   const response = await Result.tryPromise({
      try: async () => {
         switch (request.method) {
            case 'chooseFile':
               return EncoreDevice.chooseFile(request.args);
            case 'copyText':
               await EncoreDevice.copyText(request.args);
               return null;
            case 'openLink':
               return EncoreDevice.openLink(request.args);
            case 'setDaemonEnabled':
               await EncoreDevice.setDaemonEnabled(request.args);
               return null;
         }
      },
      catch: (cause) => ({ code: causeCode(cause), detail: causeMessage(cause) })
   });
   await Result.tryPromise(() =>
      Nodejs.send({
         eventName: 'encore:native-response',
         args: [Result.isOk(response) ? { id: request.id, value: response.value } : { id: request.id, error: response.error }]
      })
   );
}
