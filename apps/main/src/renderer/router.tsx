import { createHashHistory } from '@tanstack/history';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ErrorCard } from '@/components/error/error-card';
import { RouteError } from '@/components/error/route-error';

import { createQueryClient } from '@/renderer/query/query-provider';
import { routeTree } from '@/routeTree.gen';

export interface RouterContext {
   queryClient: QueryClient;
}

function RouteNotFound() {
   const t = useTranslations('error');

   return <ErrorCard icon={AlertCircle} title={t('pageNotFound')} description={t('pageNotFoundDesc')} />;
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
