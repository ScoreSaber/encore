import { CancelledError, type QueryClient, type QueryKey } from '@tanstack/react-query';

// keep inactive snapshots warm for quick tab changes without retaining every visited install
export const snapshotQueryGcTime = 2 * 60 * 1000;

export function ipcQueryKey(definition: { channel: string }, ...scope: readonly (string | number)[]) {
   return [definition.channel, ...scope];
}

export type IpcQueryKey = ReturnType<typeof ipcQueryKey>;

export async function abortable<Value>(signal: AbortSignal, run: () => Promise<Value>) {
   const value = await run();
   if (signal.aborted) throw new CancelledError({ silent: true });

   return value;
}

export function setExistingQueryData<T>(queryClient: QueryClient, queryKey: QueryKey, updater: T | ((current: T | undefined) => T | undefined)) {
   if (queryClient.getQueryState(queryKey) === undefined) return;

   queryClient.setQueryData<T>(queryKey, updater);
}
