import { Link2, Link2Off, Wrench } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import type { SharedFolderLinkState, SharedFolderStatus } from '@/modules/shared-content/contract';
import type { SharedContentActions } from '@/modules/shared-content/renderer/use-shared-content-actions';

const linkedStates = new Set<SharedFolderLinkState>(['broken', 'foreign', 'linked']);
const repairStates = new Set<SharedFolderLinkState>(['broken', 'foreign']);

export function LinkStateIcon({ linked, tone, label }: { linked: boolean; tone: 'good' | 'warning' | 'bad' | 'muted'; label: string }) {
   const Icon = linked ? Link2 : Link2Off;

   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <span role="img" aria-label={label} className="pointer-events-auto inline-flex shrink-0">
               <Icon
                  className={cn(
                     'size-4',
                     tone === 'good' && 'text-status-success',
                     tone === 'warning' && 'text-status-warning',
                     tone === 'bad' && 'text-destructive',
                     tone === 'muted' && 'text-muted-foreground/60'
                  )}
               />
            </span>
         </TooltipTrigger>
         <TooltipContent>{label}</TooltipContent>
      </Tooltip>
   );
}

export function SharedFolderStateIcon({ state }: { state: SharedFolderLinkState }) {
   const t = useTranslations('sharedContent');

   return (
      <LinkStateIcon
         linked={state === 'linked' || state === 'foreign'}
         tone={state === 'linked' ? 'good' : state === 'foreign' ? 'warning' : state === 'broken' || state === 'blocked' ? 'bad' : 'muted'}
         label={t(`states.${state}`)}
      />
   );
}

export function SharedFolderStateBadge({ state }: { state: SharedFolderLinkState }) {
   const t = useTranslations('sharedContent');

   return (
      <Badge size="sm" variant={state === 'linked' ? 'default' : state === 'broken' || state === 'blocked' ? 'destructive' : 'outline'}>
         {t(`states.${state}`)}
      </Badge>
   );
}

export function SharedFolderActionButtons({
   folder,
   actions,
   disabled,
   linkable
}: {
   folder: SharedFolderStatus;
   actions: SharedContentActions;
   disabled: boolean;
   linkable: boolean;
}) {
   const t = useTranslations('sharedContent.actions');
   const linked = linkedStates.has(folder.state);

   return (
      <div className="flex flex-wrap gap-2">
         {linked ? null : (
            <Button
               type="button"
               variant="outline"
               size="sm"
               disabled={disabled || !linkable || folder.state === 'blocked'}
               onClick={() => void actions.open('link', folder.id)}
            >
               <Link2 data-icon="inline-start" />
               {t('link.action')}
            </Button>
         )}

         {repairStates.has(folder.state) ? (
            <Button type="button" variant="outline" size="sm" disabled={disabled || !linkable} onClick={() => void actions.open('repair', folder.id)}>
               <Wrench data-icon="inline-start" />
               {t('repair.action')}
            </Button>
         ) : null}

         {linked ? (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void actions.open('unlink', folder.id)}>
               <Link2Off data-icon="inline-start" />
               {t('unlink.action')}
            </Button>
         ) : null}
      </div>
   );
}
