import { useEffect } from 'react';

import { Result } from 'better-result';

import type { IpcError } from '@/ipc/core';
import { causeFailure } from '@/lib/errors';

type PendingLinkClient<Event> = {
   onLinkOpened: (listener: () => void) => () => void;
   takePendingLink: () => Promise<Event | null>;
};

export function usePendingLinkEvent<Event>(
   client: PendingLinkClient<Event>,
   onEvent: (event: Event) => void,
   onError: (error: IpcError) => void,
   failure: IpcError
) {
   useEffect(() => {
      let active = true;

      async function openPending() {
         const pending = await Result.tryPromise({
            try: () => client.takePendingLink(),
            catch: (cause): IpcError => ({
               ...failure,
               message: causeFailure(failure.message, cause)
            })
         });
         if (Result.isError(pending)) {
            if (active) onError(pending.error);
            return;
         }

         if (active && pending.value) onEvent(pending.value);
      }

      const unsubscribe = client.onLinkOpened(() => void openPending());
      void openPending();

      return () => {
         active = false;
         unsubscribe();
      };
   }, [client, failure, onError, onEvent]);
}
