import { useTranslations } from 'use-intl';

import { isBuiltInSharedFolderId, type SharedFolderId } from '@/modules/shared-content/contract';

export function useSharedFolderLabel() {
   const t = useTranslations('sharedContent.folders');

   return (folderId: SharedFolderId, relativePath: string) => (isBuiltInSharedFolderId(folderId) ? t(folderId) : relativePath);
}
