const maxPendingEvents = 32;

export function createPendingIpcEvent<Payload>(send: (payload: Payload) => void) {
   const pending: Payload[] = [];

   return {
      publish(payload: Payload) {
         if (pending.length >= maxPendingEvents) pending.shift();
         pending.push(payload);
         send(payload);
      },
      take() {
         return pending.shift() ?? null;
      }
   };
}
