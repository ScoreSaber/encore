declare module 'bridge' {
   export const app: { datadir(): string };
   export const channel: {
      on(eventName: string, listener: (...args: unknown[]) => void): void;
      post(eventName: string, ...args: unknown[]): void;
   };
}
