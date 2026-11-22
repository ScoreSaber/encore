import { useEffect, useEffectEvent } from 'react';

import { Result } from 'better-result';

import { causeMessage, type Problem } from '@/lib/errors';

type PendingLinkClient<Event> = {
   onLinkOpened: (listener: () => void) => () => void;
   takePendingLink: () => Promise<Event | null>;
};

export function usePendingLinkEvent<Event>(
   client: PendingLinkClient<Event>,
   onEvent: (event: Event) => void,
   onError: (error: Problem) => void,
   failure: Problem
) {
   const opened = useEffectEvent(onEvent);
   const failed = useEffectEvent(onError);
   const readFailure = useEffectEvent(() => failure);

   useEffect(() => {
      let active = true;
      let draining = false;
      let queued = false;

      async function drainPending() {
         if (draining) {
            queued = true;
            return;
         }

         draining = true;
         try {
            while (active) {
               queued = false;
               const pending = await Result.tryPromise({
                  try: () => client.takePendingLink(),
                  catch: (cause): Problem => ({ ...readFailure(), detail: causeMessage(cause) })
               });
               if (Result.isError(pending)) {
                  if (active) failed(pending.error);
                  break;
               }

               if (!pending.value) {
                  if (!queued) break;
                  continue;
               }

               if (active) opened(pending.value);
            }
         } finally {
            draining = false;
         }
      }

      const unsubscribe = client.onLinkOpened(() => void drainPending());
      void drainPending();

      return () => {
         active = false;
         unsubscribe();
      };
   }, [client]);
}
