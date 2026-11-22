import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcTransportValue } from '@/ipc/core';
import type { Problem } from '@/lib/errors';

export const nativeFileChoiceSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('selected'), path: z.string(), fileName: z.string() }),
   z.object({ status: z.literal('cancelled') })
]);

export type NativeFileChoice = z.infer<typeof nativeFileChoiceSchema>;
export type ScanPairingQr = (options: { hint: string; cancel: string }) => Promise<{ text: string | null }>;

export const webNativeRequestSchema = z.discriminatedUnion('method', [
   z.object({ id: z.string(), method: z.literal('chooseFile'), args: z.object({ extensions: z.array(z.string()) }) }),
   z.object({ id: z.string(), method: z.literal('copyText'), args: z.object({ text: z.string() }) }),
   z.object({ id: z.string(), method: z.literal('openLink'), args: z.object({ url: z.string() }) }),
   z.object({ id: z.string(), method: z.literal('setDaemonEnabled'), args: z.object({ enabled: z.boolean() }) })
]);

export type WebNativeRequest = z.infer<typeof webNativeRequestSchema>;

type PendingCall = {
   complete: (value: Result<IpcTransportValue, Problem>) => void;
   timeout: ReturnType<typeof setTimeout>;
};

export function createPendingCalls() {
   const pending = new Map<string, PendingCall>();

   function track(id: string, timeoutMs: number, onTimeout: () => Problem) {
      return new Promise<Result<IpcTransportValue, Problem>>((complete) => {
         const timeout = setTimeout(() => {
            pending.delete(id);
            complete(Result.err(onTimeout()));
         }, timeoutMs);
         pending.set(id, { complete, timeout });
      });
   }

   function resolve(id: string, outcome: Result<IpcTransportValue, Problem>) {
      const call = pending.get(id);
      if (!call) return false;
      clearTimeout(call.timeout);
      pending.delete(id);
      call.complete(outcome);
      return true;
   }

   function cancel(id: string) {
      const call = pending.get(id);
      if (!call) return;
      clearTimeout(call.timeout);
      pending.delete(id);
   }

   return { track, resolve, cancel };
}
