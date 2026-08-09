import type { InstallId } from '@/modules/installs/contract';
import type { SharedFolderId, SharedFolderLinkState } from '@/modules/shared-content/contract';
import type { TargetId } from '@/modules/targets/contract';

export type ContentLinkDestination = {
   installId: InstallId;
   name: string;
   key: string;
   targetId: TargetId;
   targetName: string;
   installIds: InstallId[];
   sharedRootPath: string | null;
};

export type ContentLinkSharedState = {
   targetId: TargetId;
   installId: InstallId;
   folders: { id: SharedFolderId; state: SharedFolderLinkState; rootPath: string | null }[];
};

export function contentLinkDestinationKey(targetId: TargetId, installId: InstallId) {
   return `${targetId}\0${installId}`;
}

export function findContentLinkDestination(destinations: ContentLinkDestination[], targetId: TargetId, installId: InstallId) {
   return destinations.find((destination) => destination.targetId === targetId && destination.installIds.includes(installId)) ?? null;
}

export function createContentLinkDestinations(
   installs: { installId: InstallId; name: string; targetId: TargetId; targetName: string }[],
   sharedStates: ContentLinkSharedState[],
   sharedFolderIds: readonly SharedFolderId[]
) {
   const destinations = new Map<string, ContentLinkDestination>();

   for (const install of installs) {
      const sharedRootPath = findSharedRoot(install, sharedStates, sharedFolderIds);
      const key = sharedRootPath ? `${install.targetId}\0library\0${sharedRootPath}` : contentLinkDestinationKey(install.targetId, install.installId);
      const existing = destinations.get(key);

      destinations.set(
         key,
         existing
            ? { ...existing, installIds: [...existing.installIds, install.installId] }
            : {
                 ...install,
                 key,
                 installIds: [install.installId],
                 sharedRootPath
              }
      );
   }

   return [...destinations.values()];
}

export function contentLinkDestinationName(destination: ContentLinkDestination, defaultSharedContentName: string) {
   if (!destination.sharedRootPath) return destination.name;

   const segments = destination.sharedRootPath.split(/[\\/]/).filter(Boolean);
   const name = segments.at(-1) ?? destination.sharedRootPath;

   return name === 'SharedContent' ? defaultSharedContentName : name;
}

function findSharedRoot(
   install: { installId: InstallId; targetId: TargetId },
   sharedStates: ContentLinkSharedState[],
   sharedFolderIds: readonly SharedFolderId[]
) {
   if (sharedFolderIds.length === 0) return null;

   const shared = sharedStates.find((state) => state.targetId === install.targetId && state.installId === install.installId);
   const folders = sharedFolderIds.map((folderId) => shared?.folders.find((folder) => folder.id === folderId));
   const rootPath = folders[0]?.rootPath ?? null;

   return rootPath && folders.every((folder) => folder?.state === 'linked' && folder.rootPath === rootPath) ? rootPath : null;
}
