import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { RouterContext } from '@/renderer/router';
import { AppProviders } from '@/renderer/shell/app-providers';
import { AppShell } from '@/renderer/shell/app-shell';

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
