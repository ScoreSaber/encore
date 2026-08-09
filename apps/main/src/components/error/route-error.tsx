import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link, useRouter } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ErrorCard } from '@/components/error/error-card';
import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';

export function RouteError({ reset }: ErrorComponentProps) {
   const router = useRouter();
   const t = useTranslations('error');
   const common = useTranslations('common');

   function handleRetry() {
      reset();
      void router.invalidate();
   }

   return (
      <ErrorCard
         icon={AlertCircle}
         title={t('somethingWentWrong')}
         description={t('unexpectedError')}
         actions={
            <>
               <Button asChild size="sm" variant="secondary">
                  <Link to="/">{common('goHome')}</Link>
               </Button>
               <RefreshButton label={common('retry')} variant="default" onClick={handleRetry} />
            </>
         }
      />
   );
}
