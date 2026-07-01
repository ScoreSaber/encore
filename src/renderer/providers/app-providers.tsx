import type { QueryClient } from '@tanstack/react-query';

import { LocaleProvider } from '@/i18n/locale-provider';
import { QueryProvider } from '@/shared/query/query-provider';
import { ThemeProvider } from '@/shared/ui-adjacent/theme-provider';

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
   return (
      <LocaleProvider>
         <ThemeProvider>
            <QueryProvider queryClient={queryClient}>{children}</QueryProvider>
         </ThemeProvider>
      </LocaleProvider>
   );
}
