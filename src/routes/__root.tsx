import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { RouterContext } from '@/app/renderer/router';
import { AppProviders } from '@/app/renderer/shell/app-providers';
import { AppShell } from '@/app/renderer/shell/app-shell';

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
