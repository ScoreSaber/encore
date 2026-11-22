import { Result, type Err } from 'better-result';

import { setTimeout as delay } from 'node:timers/promises';

export async function abortableSleep(durationMs: number, signal?: AbortSignal) {
   if (durationMs <= 0 || signal?.aborted) return;

   await Result.tryPromise(() => delay(durationMs, undefined, { signal }));
}

export function abortedBy<Failure>(signal: AbortSignal | undefined, failure: () => Failure) {
   let release = () => {};
   const result = new Promise<Err<never, Failure>>((resolve) => {
      if (!signal) return;
      const cancel = () => resolve(Result.err(failure()));
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      release = () => signal.removeEventListener('abort', cancel);
   });
   return { result, release: () => release() };
}
