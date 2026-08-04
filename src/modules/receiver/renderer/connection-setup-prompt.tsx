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
   const isHome = context === 'home';
   const title = isHome ? home(hasSavedPC ? 'offlineTitle' : 'title') : settings('remote.overview.offTitle');
   const description = isHome
      ? home(hasSavedPC ? 'offlineDescription' : 'description')
      : settings(canShareThisComputer ? 'remote.overview.offDescription' : 'remote.overview.manageDescription');
   const setupLabel = isHome ? home(hasSavedPC ? 'connectAnother' : 'connect') : settings('remote.setUp');
   const Heading = isHome ? 'h2' : 'h3';

   return (
      <section className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
         <Cable className="text-primary size-5 shrink-0" />
         <div className="min-w-0 flex-1">
            <Heading className="font-medium">{title}</Heading>
            <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
         </div>
         <ButtonGroup className="shrink-0" aria-label={title}>
            {isHome && hasSavedPC ? (
               <Button asChild type="button" variant="outline" size="sm">
                  <Link to="/settings">
                     <Settings data-icon="inline-start" />
                     {home('settings')}
                  </Link>
               </Button>
            ) : null}
            <Button type="button" size="sm" disabled={disabled} onClick={onSetup}>
               <Cable data-icon="inline-start" />
               {setupLabel}
            </Button>
         </ButtonGroup>
      </section>
   );
}
