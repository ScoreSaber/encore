import { appIpcModule } from '@/shared/ipc/modules/app';
import { updateIpcModule } from '@/shared/ipc/modules/update';

export * from '@/shared/ipc/modules/app';
export * from '@/shared/ipc/modules/update';

export const ipcModules = [appIpcModule, updateIpcModule] as const;
