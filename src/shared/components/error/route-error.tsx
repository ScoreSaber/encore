import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link, useRouter } from '@tanstack/react-router';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

import { ErrorCard } from '@/shared/components/error/error-card';

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
               <Button asChild size="sm" variant="secondary" className="cursor-pointer">
                  <Link to="/">{common('goHome')}</Link>
               </Button>
               <Button size="sm" variant="default" onClick={handleRetry} className="cursor-pointer">
                  <RefreshCw data-icon="inline-start" />
                  {common('retry')}
               </Button>
            </>
         }
      />
   );
}
