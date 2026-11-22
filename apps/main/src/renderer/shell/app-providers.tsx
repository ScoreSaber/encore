import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

import { TooltipProvider } from '@/components/ui/tooltip';

import { LocaleProvider } from '@/renderer/i18n/locale-provider';
import { QuerySync } from '@/renderer/shell/query-sync';
import { ThemeEffects } from '@/renderer/theme/theme';

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
   return (
      <QueryClientProvider client={queryClient}>
         <LocaleProvider>
            <TooltipProvider>
               <QuerySync />
               <ThemeEffects />
               {children}
            </TooltipProvider>
         </LocaleProvider>
      </QueryClientProvider>
   );
}
