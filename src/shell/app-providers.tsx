import type { QueryClient } from '@tanstack/react-query';

import { TooltipProvider } from '@/components/ui/tooltip';

import { LocaleProvider } from '@/i18n/locale-provider';
import { SettingsProvider } from '@/modules/settings/settings-provider';
import { QueryProvider } from '@/shared/query/query-provider';
import { ThemeProvider } from '@/shared/ui-adjacent/theme-provider';

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
   return (
      <SettingsProvider>
         <LocaleProvider>
            <ThemeProvider>
               <TooltipProvider>
                  <QueryProvider queryClient={queryClient}>{children}</QueryProvider>
               </TooltipProvider>
            </ThemeProvider>
         </LocaleProvider>
      </SettingsProvider>
   );
}
