import { broadcastIpcEvent } from '@/ipc/main';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import type { ModRepositoryLinkEvent } from '@/modules/mods/contract';
import { modsIpc } from '@/modules/mods/ipc';

const links = createPendingIpcEvent<ModRepositoryLinkEvent>((event) => broadcastIpcEvent(modsIpc.onRepositoryLinkOpened, event));

export function queueRepositoryLink(event: ModRepositoryLinkEvent) {
   links.publish(event);
}

export function takePendingRepositoryLink() {
   return links.take();
}
