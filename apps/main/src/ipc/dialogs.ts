import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from 'electron';

export function showOpenDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
   const window = BrowserWindow.fromWebContents(event.sender);

   return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

export function showSaveDialog(event: IpcMainInvokeEvent, options: SaveDialogOptions) {
   const window = BrowserWindow.fromWebContents(event.sender);

   return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}
