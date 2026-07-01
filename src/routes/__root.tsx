import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { RouterContext } from '@/router';
import { AppProviders } from '@/shell/app-providers';
import { AppShell } from '@/shell/app-shell';

export const Route = createRootRouteWithContext<RouterContext>()({
   component: RootRoute
});

function RootRoute() {
   const { queryClient } = Route.useRouteContext();

   return (
      <AppProviders queryClient={queryClient}>
         <AppShell>
            <Outlet />
         </AppShell>
      </AppProviders>
   );
}
