import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createQueryClient() {
   return new QueryClient({
      defaultOptions: {
         queries: {
            staleTime: 60 * 1000,
            gcTime: 2 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: false
         }
      }
   });
}

export function QueryProvider({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
   return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
