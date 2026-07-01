import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { AppProviders } from '@/renderer/providers/app-providers';
import { AppShell } from '@/renderer/shell/app-shell';
import type { RouterContext } from '@/router';

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
