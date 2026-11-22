export function createSerialQueue() {
   let tail: Promise<void> = Promise.resolve();

   function run<Value>(task: () => Promise<Value> | Value): Promise<Value> {
      const next = tail.then(task, task);
      tail = next.then(
         () => undefined,
         () => undefined
      );
      return next;
   }

   function idle(): Promise<void> {
      return tail;
   }

   return { run, idle };
}

export function createLatestGuard() {
   let current = 0;

   return {
      next() {
         current += 1;
         return current;
      },
      isCurrent(token: number) {
         return token === current;
      },
      invalidate() {
         current += 1;
      }
   };
}
