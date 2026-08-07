import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';

import type { MessageKey } from '@/app/renderer/i18n/keys';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import type { SharedFolderId, SharedFolderLinkState } from '@/modules/shared-content/contract';
import { useInstallSharedContent } from '@/modules/shared-content/renderer/use-install-shared-content';

const noticeKeys: Record<SharedFolderLinkState, MessageKey<'sharedContent'> | null> = {
   absent: null,
   blocked: 'sharedFolder.blocked',
   broken: 'sharedFolder.broken',
   foreign: 'sharedFolder.foreign',
   linked: null,
   unlinked: null
};

export type SharedFolder = ReturnType<typeof useSharedFolder>;

export function useSharedFolder(request: TargetSharedContentRequest, folderId: SharedFolderId | null) {
   const sharedContent = useInstallSharedContent(request);
   const folder = folderId ? (sharedContent.snapshot.folders.find((entry) => entry.id === folderId) ?? null) : null;

   return { folder, failed: sharedContent.status === 'error' };
}

export function SharedFolderNotice({ shared }: { shared: SharedFolder }) {
   const t = useTranslations('sharedContent');
   const state = shared.folder?.state;
   const notice = state ? noticeKeys[state] : null;

   if (shared.failed) return <WarningLine>{t('loadError')}</WarningLine>;

   if (!notice) return null;

   return <WarningLine className="text-destructive">{t(notice)}</WarningLine>;
}
