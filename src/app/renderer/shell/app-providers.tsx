import type { QueryClient } from '@tanstack/react-query';

import { TooltipProvider } from '@/components/ui/tooltip';

import { LocaleProvider } from '@/app/renderer/i18n/locale-provider';
import { QueryProvider } from '@/app/renderer/query/query-provider';
import { QuerySync } from '@/app/renderer/shell/query-sync';
import { ThemeProvider } from '@/app/renderer/theme/theme-provider';
import { SettingsProvider } from '@/modules/settings/renderer/settings-provider';

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
