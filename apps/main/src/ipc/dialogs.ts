import { BrowserWindow, dialog, shell, type FileFilter, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from 'electron';

import type { FileExportChoice, FileImportChoice, OpenFolderResult } from '@/ipc/core';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

export function showOpenDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
   const window = BrowserWindow.fromWebContents(event.sender);

   return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

export function showSaveDialog(event: IpcMainInvokeEvent, options: SaveDialogOptions) {
   const window = BrowserWindow.fromWebContents(event.sender);

   return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

export async function openLocalPath(
   targetId: TargetId,
   resolvePath: () => Promise<string | null>,
   mode: 'open' | 'reveal' = 'open'
): Promise<OpenFolderResult> {
   if (targetId !== localTargetId) return { status: 'unsupported' };

   const targetPath = await resolvePath();
   if (!targetPath) return { status: 'failed' };

   if (mode === 'reveal') {
      shell.showItemInFolder(targetPath);
      return { status: 'opened' };
   }

   return { status: (await shell.openPath(targetPath)) ? 'failed' : 'opened' };
}

export async function chooseLocalImport(targetId: TargetId, event: IpcMainInvokeEvent, filters: FileFilter[]): Promise<FileImportChoice> {
   if (targetId !== localTargetId) return { status: 'unsupported' };

   const picked = await showOpenDialog(event, {
      properties: ['openFile', 'multiSelections'],
      filters
   });

   if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled' };

   return { status: 'selected', paths: picked.filePaths };
}

export async function chooseLocalExport(
   targetId: TargetId,
   count: number,
   event: IpcMainInvokeEvent,
   options: { defaultPath: string; filters: FileFilter[] }
): Promise<FileExportChoice> {
   if (targetId !== localTargetId) return { status: 'unsupported' };
   if (count === 0) return { status: 'cancelled' };

   const chosen = await showSaveDialog(event, options);

   if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };

   return { status: 'selected', path: chosen.filePath };
}
