import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';

import { createEncoreApi } from '@/ipc/api';
import { IpcInvokeError, ipcTransportValueSchema, type IpcTransportValue } from '@/ipc/core';

const responseSchema = z.discriminatedUnion('ok', [
   z.object({ ok: z.literal(true), value: ipcTransportValueSchema }),
   z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) })
]);

contextBridge.exposeInMainWorld(
   'encore',
   createEncoreApi(
      process.platform,
      async (channel, ...args) => {
         const response = responseSchema.parse(await ipcRenderer.invoke(channel, ...args));
         if (!response.ok) throw new IpcInvokeError(response.error);
         return response.value;
      },
      (channel, listener) => {
         const handler = (_event: Electron.IpcRendererEvent, payload: IpcTransportValue) => listener(ipcTransportValueSchema.parse(payload));
         ipcRenderer.on(channel, handler);
         return () => ipcRenderer.removeListener(channel, handler);
      }
   )
);
