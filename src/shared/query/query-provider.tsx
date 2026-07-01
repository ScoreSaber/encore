import { useRef } from 'react';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

import { createQueryClient } from './query-client';

export function QueryProvider({ queryClient: providedQueryClient, children }: { queryClient?: QueryClient; children: React.ReactNode }) {
   const fallbackQueryClient = useRef<QueryClient | null>(null);
   const queryClient = providedQueryClient ?? (fallbackQueryClient.current ??= createQueryClient());

   return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
