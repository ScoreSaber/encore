import { Result, TaggedError } from 'better-result';

import type { IpcResult } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import { createProblem, type Problem } from '@/lib/errors';

export class TargetCallError extends TaggedError('TargetCallError')<{
   status: 'unsupported' | 'unavailable';
   message: string;
}>() {}

class IpcHandlerError extends TaggedError('IpcHandlerError')<{
   code: string;
   message: string;
   detail?: string;
}>() {}

export function unwrapTarget<Value>(response: TargetCallResult<Value>) {
   if (response.status === 'ok') return response.value;
   if (response.status === 'unsupported') {
      throw new TargetCallError({ status: 'unsupported', message: createProblem('ipc.unsupported').message });
   }

   throw new TargetCallError({ status: 'unavailable', message: response.error.message });
}

export function unwrapIpc<Value>(result: IpcResult<Value>) {
   if (!result.ok) throw new IpcHandlerError(result.error);

   return result.value;
}

export async function inlineIpcResult<Value>(
   call: () => Promise<IpcResult<Value> | TargetCallResult<IpcResult<Value>>>,
   fallback: Problem
): Promise<IpcResult<Value>> {
   const answered = await Result.tryPromise({ try: call, catch: () => fallback });
   if (Result.isError(answered)) return { ok: false, error: answered.error };

   const response = answered.value;
   if ('ok' in response) return response;
   if (response.status === 'ok') return response.value;

   return { ok: false, error: response.status === 'unavailable' ? response.error : fallback };
}
