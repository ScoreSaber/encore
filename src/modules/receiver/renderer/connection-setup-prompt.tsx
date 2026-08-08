import { Link } from '@tanstack/react-router';
import { Cable, Settings } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';

export function ConnectionSetupPrompt({
   context,
   hasSavedPC = false,
   canShareThisComputer = true,
   disabled = false,
   onSetup
}: {
   context: 'home' | 'settings';
   hasSavedPC?: boolean;
   canShareThisComputer?: boolean;
   disabled?: boolean;
   onSetup: () => void;
}) {
   const home = useTranslations('home.connection');
   const settings = useTranslations('settings');

   if (context === 'settings') {
      return (
         <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <p className="text-muted-foreground min-w-0 flex-1 text-sm">
               {settings(canShareThisComputer ? 'remote.overview.offDescription' : 'remote.overview.manageDescription')}
            </p>
            <Button type="button" size="sm" className="shrink-0" disabled={disabled} onClick={onSetup}>
               <Cable data-icon="inline-start" />
               {settings('remote.setUp')}
            </Button>
         </div>
      );
   }

   const title = home(hasSavedPC ? 'offlineTitle' : 'title');
   const description = home(hasSavedPC ? 'offlineDescription' : 'description');

   return (
      <section className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
         <Cable className="text-primary size-5 shrink-0" />
         <div className="min-w-0 flex-1">
            <h2 className="font-medium">{title}</h2>
            <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
         </div>
         <ButtonGroup className="shrink-0" aria-label={title}>
            {hasSavedPC ? (
               <Button asChild type="button" variant="outline" size="sm">
                  <Link to="/settings">
                     <Settings data-icon="inline-start" />
                     {home('settings')}
                  </Link>
               </Button>
            ) : null}
            <Button type="button" size="sm" disabled={disabled} onClick={onSetup}>
               <Cable data-icon="inline-start" />
               {home(hasSavedPC ? 'connectAnother' : 'connect')}
            </Button>
         </ButtonGroup>
      </section>
   );
}
