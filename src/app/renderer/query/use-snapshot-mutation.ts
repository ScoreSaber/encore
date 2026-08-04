import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

type SnapshotMutationOptions<Result, Variables, Snapshot> = {
   queryKey: QueryKey;
   run: (variables: Variables) => Promise<Result>;
   snapshot?: (result: Result) => Snapshot | undefined;
};

export function useSnapshotMutation<Result, Variables = void, Snapshot = Result>({
   queryKey,
   run,
   snapshot
}: SnapshotMutationOptions<Result, Variables, Snapshot>) {
   const queryClient = useQueryClient();

   return useMutation({
      mutationFn: run,
      onSuccess: (result) => {
         // a mutation response is newer than the cached snapshot
         const next = snapshot ? snapshot(result) : result;
         if (next === undefined) {
            void queryClient.invalidateQueries({ queryKey });
            return;
         }

         queryClient.setQueryData(queryKey, next);
      },
      onError: () => {
         void queryClient.invalidateQueries({ queryKey });
      }
   });
}
