import type { QueryClient } from '@tanstack/react-query';

import { TooltipProvider } from '@/components/ui/tooltip';

import { SettingsProvider } from '@/modules/settings/renderer/settings-provider';
import { LocaleProvider } from '@/renderer/i18n/locale-provider';
import { QueryProvider } from '@/renderer/query/query-provider';
import { QuerySync } from '@/renderer/shell/query-sync';
import { ThemeProvider } from '@/renderer/theme/theme-provider';

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
   return (
      <QueryProvider queryClient={queryClient}>
         <SettingsProvider>
            <LocaleProvider>
               <ThemeProvider>
                  <TooltipProvider>
                     <QuerySync />
                     {children}
                  </TooltipProvider>
               </ThemeProvider>
            </LocaleProvider>
         </SettingsProvider>
      </QueryProvider>
   );
}
