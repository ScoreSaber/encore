import { Link2, Link2Off, Wrench } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';

import type { SharedContentIssue, SharedFolderLinkState, SharedFolderStatus } from '@/modules/shared-content/contract';
import { useSharedFolderLabel } from '@/modules/shared-content/renderer/shared-folder-label';
import type { SharedContentActions } from '@/modules/shared-content/renderer/use-shared-content-actions';
import type { MessageKey } from '@/renderer/i18n/keys';

const linkedStates = new Set<SharedFolderLinkState>(['broken', 'foreign', 'linked']);
const repairStates = new Set<SharedFolderLinkState>(['broken', 'foreign']);

export const sharedContentIssueKeys: Record<SharedContentIssue, MessageKey<'sharedContent.issues'>> = {
   'already-linked': 'alreadyLinked',
   'inspect-failed': 'inspectFailed',
   'install-not-found': 'installNotFound',
   'link-unsupported': 'linkUnsupported',
   'not-linked': 'notLinked',
   'nothing-to-connect': 'nothingToConnect',
   'path-blocked': 'pathBlocked',
   'shared-root-unavailable': 'sharedRootUnavailable',
   'unknown-folder': 'unknownFolder',
   'unknown-root': 'unknownRoot',
   'unsupported-target': 'unsupportedTarget'
};

export function SharedFolderStateBadge({ state }: { state: SharedFolderLinkState }) {
   const t = useTranslations('sharedContent');

   return (
      <Badge
         className="px-1.5 py-0 text-[10px] leading-4"
         variant={state === 'linked' ? 'default' : state === 'broken' || state === 'blocked' ? 'destructive' : 'outline'}
      >
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
   const folderLabel = useSharedFolderLabel();
   const linked = linkedStates.has(folder.state);

   return (
      <ButtonGroup aria-label={folderLabel(folder.id, folder.relativePath)}>
         {linked ? null : (
            <Button
               type="button"
               variant="outline"
               size="sm"
               disabled={disabled || !linkable || folder.state === 'blocked'}
               onClick={() => void actions.preview('link', folder.id)}
            >
               <Link2 data-icon="inline-start" />
               {t('link.action')}
            </Button>
         )}

         {repairStates.has(folder.state) ? (
            <Button
               type="button"
               variant="outline"
               size="sm"
               disabled={disabled || !linkable}
               onClick={() => void actions.preview('repair', folder.id)}
            >
               <Wrench data-icon="inline-start" />
               {t('repair.action')}
            </Button>
         ) : null}

         {linked ? (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void actions.preview('unlink', folder.id)}>
               <Link2Off data-icon="inline-start" />
               {t('unlink.action')}
            </Button>
         ) : null}
      </ButtonGroup>
   );
}
