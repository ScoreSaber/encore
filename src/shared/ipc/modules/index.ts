import { appIpcModule } from '@/shared/ipc/modules/app';
import { operationsIpcModule } from '@/shared/ipc/modules/operations';
import { updateIpcModule } from '@/shared/ipc/modules/update';

export * from '@/shared/ipc/modules/app';
export * from '@/shared/ipc/modules/operations';
export * from '@/shared/ipc/modules/update';

export const ipcModules = [appIpcModule, updateIpcModule, operationsIpcModule] as const;
