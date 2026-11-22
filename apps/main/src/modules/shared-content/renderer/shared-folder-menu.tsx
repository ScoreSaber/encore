import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';

import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import type { SharedFolderId } from '@/modules/shared-content/contract';
import { useInstallSharedContent } from '@/modules/shared-content/renderer/use-install-shared-content';

type SharedFolder = ReturnType<typeof useSharedFolder>;

export function useSharedFolder(request: TargetSharedContentRequest, folderId: SharedFolderId | null) {
   const sharedContent = useInstallSharedContent(request);
   const folder = folderId ? (sharedContent.snapshot.folders.find((entry) => entry.id === folderId) ?? null) : null;

   return { folder, failed: sharedContent.status === 'error' };
}

export function SharedFolderNotice({ shared }: { shared: SharedFolder }) {
   const t = useTranslations('sharedContent');
   const state = shared.folder?.state;

   if (shared.failed) return <WarningLine>{t('loadError')}</WarningLine>;

   if (state !== 'blocked' && state !== 'broken' && state !== 'foreign') return null;

   return <WarningLine className="text-destructive">{t(`sharedFolder.${state}`)}</WarningLine>;
}
