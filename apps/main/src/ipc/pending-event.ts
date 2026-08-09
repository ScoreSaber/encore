export function createPendingIpcEvent<Payload>(send: (payload: Payload) => void) {
   let pending: Payload | null = null;

   return {
      publish(payload: Payload) {
         pending = payload;
         send(payload);
      },
      take() {
         const payload = pending;
         pending = null;
         return payload;
      }
   };
}
