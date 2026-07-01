import { createHashHistory } from '@tanstack/history';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

import { RouteNotFound } from '@/shared/components/error/not-found-card';
import { RouteError } from '@/shared/components/error/route-error';
import { createQueryClient } from '@/shared/query/query-client';

export interface RouterContext {
   queryClient: QueryClient;
}

export function getRouter() {
   const queryClient = createQueryClient();
   const router = createRouter({
      routeTree,
      history: window.location.protocol === 'file:' ? createHashHistory() : undefined,
      context: { queryClient },
      defaultPreload: false,
      defaultViewTransition: false,
      defaultNotFoundComponent: RouteNotFound,
      defaultErrorComponent: RouteError,
      scrollRestoration: true
   });

   return router;
}

declare module '@tanstack/react-router' {
   interface Register {
      router: ReturnType<typeof getRouter>;
   }
}
