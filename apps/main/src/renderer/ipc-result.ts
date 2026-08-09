import { matchError, Result, TaggedError } from 'better-result';

import type { IpcError, IpcResult, IpcSerializable } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import { causeMessage } from '@/lib/errors';

class IpcTransportError extends TaggedError('IpcTransportError')<{
   message: string;
}>() {}

class IpcHandlerError extends TaggedError('IpcHandlerError')<{
   code: string;
   message: string;
   details?: IpcSerializable;
}>() {}

type IpcFailure = IpcHandlerError | IpcTransportError;

export async function ipcResult<Value>(call: () => Promise<IpcResult<Value>>) {
   const answered = await Result.tryPromise({
      try: call,
      catch: (cause) => new IpcTransportError({ message: causeMessage(cause) })
   });

   if (Result.isError(answered)) return Result.err<Value, IpcFailure>(answered.error);
   if (!answered.value.ok) {
      return Result.err<Value, IpcFailure>(
         new IpcHandlerError({
            code: answered.value.error.code,
            message: answered.value.error.message,
            details: answered.value.error.details
         })
      );
   }

   return Result.ok<Value, IpcFailure>(answered.value.value);
}

export async function queryIpcData<Value>(call: () => Promise<IpcResult<Value>>) {
   const result = await ipcResult(call);
   if (Result.isError(result)) throw result.error;

   return result.value;
}

export async function inlineIpcResult<Value>(call: () => Promise<IpcResult<Value>>, fallback: IpcError): Promise<IpcResult<Value>> {
   const result = await ipcResult(call);
   if (Result.isOk(result)) return { ok: true, value: result.value };

   return {
      ok: false,
      error: matchError(result.error, {
         IpcHandlerError: (failure): IpcError => ({ code: failure.code, message: failure.message, details: failure.details }),
         IpcTransportError: () => fallback
      })
   };
}

export async function inlineTargetIpcResult<Value>(
   call: () => Promise<TargetCallResult<IpcResult<Value>>>,
   fallback: IpcError
): Promise<IpcResult<Value>> {
   const response = await Result.tryPromise({ try: call, catch: () => fallback });
   if (Result.isError(response)) return { ok: false, error: response.error };
   const targetResult = response.value;
   if (targetResult.status === 'unavailable') return { ok: false, error: targetResult.error };
   if (targetResult.status === 'unsupported') return { ok: false, error: fallback };

   return inlineIpcResult(() => Promise.resolve(targetResult.value), fallback);
}
