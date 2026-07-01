import type { NotFoundRouteProps } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ErrorCard } from '@/shared/components/error/error-card';

export function RouteNotFound(_props: NotFoundRouteProps) {
   const t = useTranslations('error');

   return <ErrorCard icon={AlertCircle} title={t('pageNotFound')} description={t('pageNotFoundDesc')} />;
}
