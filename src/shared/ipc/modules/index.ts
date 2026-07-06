import { appIpcModule } from '@/shared/ipc/modules/app';
import { operationsIpcModule } from '@/shared/ipc/modules/operations';
import { receiverIpcModule } from '@/shared/ipc/modules/receiver';
import { settingsIpcModule } from '@/shared/ipc/modules/settings';
import { targetsIpcModule } from '@/shared/ipc/modules/targets';
import { updateIpcModule } from '@/shared/ipc/modules/update';

export * from '@/shared/ipc/modules/app';
export * from '@/shared/ipc/modules/operations';
export * from '@/shared/ipc/modules/receiver';
export * from '@/shared/ipc/modules/settings';
export * from '@/shared/ipc/modules/targets';
export * from '@/shared/ipc/modules/update';

export const ipcModules = [appIpcModule, settingsIpcModule, targetsIpcModule, updateIpcModule, operationsIpcModule, receiverIpcModule] as const;
