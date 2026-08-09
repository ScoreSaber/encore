import { Result } from 'better-result';

import { setTimeout as delay } from 'node:timers/promises';

export async function abortableSleep(durationMs: number, signal: AbortSignal) {
   if (durationMs <= 0 || signal.aborted) return;

   await Result.tryPromise({
      try: () => delay(durationMs, undefined, { signal }),
      catch: () => null
   });
}
