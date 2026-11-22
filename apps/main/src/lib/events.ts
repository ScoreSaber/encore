export function createContentEvents<Snapshot>() {
   const listeners = new Set<(snapshot: Snapshot) => void>();

   function subscribe(listener: (snapshot: Snapshot) => void) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   function publish(snapshot: Snapshot) {
      for (const listener of listeners) {
         listener(snapshot);
      }

      return snapshot;
   }

   function dispose() {
      listeners.clear();
   }

   return { subscribe, publish, dispose };
}
