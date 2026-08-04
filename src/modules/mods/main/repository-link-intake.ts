import { broadcastIpcEvent } from '@/app/ipc/main';
import type { ModRepositoryLinkEvent } from '@/modules/mods/contract';
import { modsIpc } from '@/modules/mods/ipc';

let pendingLink: ModRepositoryLinkEvent | null = null;

export function queueRepositoryLink(event: ModRepositoryLinkEvent) {
   pendingLink = event;

   broadcastIpcEvent(modsIpc.onRepositoryLinkOpened, event);
}

export function takePendingRepositoryLink() {
   const event = pendingLink;
   pendingLink = null;
   return event;
}
