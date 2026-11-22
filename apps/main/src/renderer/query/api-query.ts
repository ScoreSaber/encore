import { CancelledError, hashKey, QueryClient, useMutation, useQueryClient, type DataTag, type QueryKey } from '@tanstack/react-query';

import type { EncoreApi } from '@/ipc/api';
import type { TargetCallResult } from '@/lib/api';
import type { InstallId } from '@/modules/installs/contract';
import type { TargetId } from '@/modules/targets/contract';
import { TargetCallError, unwrapTarget } from '@/renderer/ipc-result';

type ApiDomain = Exclude<keyof EncoreApi, 'platform' | 'runtime'>;
type ApiMethod<Domain extends ApiDomain> = keyof EncoreApi[Domain] & string;
type KeyPart = string | number | null;
type InstallScope = { targetId: TargetId; installId: InstallId };

export const snapshotGcTime = 2 * 60 * 1000;

export function createQueryClient() {
   return new QueryClient({
      defaultOptions: {
         queries: {
            staleTime: 60 * 1000,
            gcTime: snapshotGcTime,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: false
         }
      }
   });
}

export function apiKey<Domain extends ApiDomain>(domain: Domain, method: ApiMethod<Domain>, ...args: KeyPart[]) {
   return [domain, method, ...args];
}

export function targetKey<Domain extends ApiDomain>(
   domain: Domain,
   targetId: TargetId,
   ...path: [] | [method: ApiMethod<Domain>, ...args: KeyPart[]]
) {
   return [domain, targetId, ...path];
}

export function installKey<Domain extends ApiDomain>(
   domain: Domain,
   { targetId, installId }: InstallScope,
   ...path: [] | [method: ApiMethod<Domain>, ...args: KeyPart[]]
) {
   return [domain, targetId, installId, ...path];
}

export async function abortable<Value>(signal: AbortSignal, run: () => Promise<Value>) {
   const value = await run();
   if (signal.aborted) throw new CancelledError({ silent: true });

   return value;
}

export function targetQuery<Value>(queryKey: QueryKey, call: () => Promise<TargetCallResult<Value>>) {
   return {
      queryKey,
      queryFn: ({ signal }: { signal: AbortSignal }) => abortable(signal, async () => unwrapTarget(await call()))
   };
}

export function queryStatus(query: { isPending: boolean; error: Error | null }) {
   if (query.error) return TargetCallError.is(query.error) && query.error.status === 'unsupported' ? 'unsupported' : 'error';

   return query.isPending ? 'loading' : 'ready';
}

export type QueryStatus = ReturnType<typeof queryStatus>;

export function useSnapshotMutation<Data, Variables = void>(queryKey: DataTag<QueryKey, Data, Error>, run: (variables: Variables) => Promise<Data>) {
   const queryClient = useQueryClient();

   return useMutation({
      mutationFn: run,
      onSuccess: (data) => queryClient.setQueryData(queryKey, data),
      onError: () => queryClient.invalidateQueries({ queryKey })
   });
}

export function useOptimisticMutation<Data, Variables>({
   queryKey,
   run,
   preview
}: {
   queryKey: DataTag<QueryKey, Data, Error>;
   run: (variables: Variables) => Promise<Data>;
   preview: (current: Data | undefined, variables: Variables) => Data | undefined;
}) {
   const queryClient = useQueryClient();

   return useMutation({
      mutationKey: queryKey,
      scope: { id: hashKey(queryKey) },
      mutationFn: run,
      onMutate: async (variables) => {
         await queryClient.cancelQueries({ queryKey });
         queryClient.setQueryData(queryKey, (current) => preview(current, variables));
      },
      onSuccess: (data) => {
         if (queryClient.isMutating({ mutationKey: queryKey }) === 1) queryClient.setQueryData(queryKey, data);
      },
      onError: () => queryClient.invalidateQueries({ queryKey })
   });
}
