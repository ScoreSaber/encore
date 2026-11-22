import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { AppLink } from '@/components/app-link';
import { ErrorCard } from '@/components/error/error-card';
import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';

export function RouteError({ reset }: ErrorComponentProps) {
   const router = useRouter();
   const t = useTranslations('error');
   const common = useTranslations('common');

   return (
      <ErrorCard
         icon={AlertCircle}
         title={t('somethingWentWrong')}
         description={t('unexpectedError')}
         actions={
            <>
               <Button asChild size="sm" variant="secondary">
                  <AppLink to="/">{common('goHome')}</AppLink>
               </Button>
               <RefreshButton
                  label={common('retry')}
                  variant="default"
                  onClick={() => {
                     reset();
                     return router.invalidate();
                  }}
               />
            </>
         }
      />
   );
}
