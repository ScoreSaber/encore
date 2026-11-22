import { defineIpc, request, type OpenFolderResult } from '@/ipc/core';
import { targetInstallRequestSchema } from '@/modules/targets/contract';

export const installsIpc = defineIpc('installs', {
   openFolder: request(targetInstallRequestSchema).returns<OpenFolderResult>()
});
