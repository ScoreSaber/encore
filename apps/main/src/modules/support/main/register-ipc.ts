import { Result } from 'better-result';
import { clipboard, shell, type FileFilter, type IpcMainInvokeEvent } from 'electron';

import { openExternalUrl } from '@/external-navigation';
import { showSaveDialog } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/host';
import { causeMessage } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { supportLinkUrls, type SupportExportResult, type SupportLinkResult, type SupportLogOpenResult } from '@/modules/support/contract';
import { supportIpc } from '@/modules/support/ipc';
import { textLogFileName } from '@/modules/support/main/support-logs';
import type { SupportService } from '@/modules/support/main/support-service';
import { localTargetId } from '@/modules/targets/contract';

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

export function createSupportIpcModule(support: SupportService) {
   return defineIpcHandlers<typeof supportIpc, IpcMainInvokeEvent>(supportIpc, {
      openLink: async (request): Promise<SupportLinkResult> => {
         const decision = await openExternalUrl(supportLinkUrls[request.id], (url) => shell.openExternal(url));

         return decision.allowed ? { id: request.id, status: 'opened' } : { id: request.id, status: 'blocked', reason: decision.reason };
      },
      getLogs: (request) => support.getLogs(request),
      readLog: (request) => support.readLog(request),
      openLog: async (request) => {
         if (request.source === 'app' || request.targetId === localTargetId) {
            const path = await support.resolveLocalLogPath(request);
            if (Result.isError(path)) return { status: 'failed', detail: path.error.detail ?? path.error.issue };

            return openPath(path.value);
         }

         const excerpt = await support.readLog(request);
         if (excerpt.status !== 'ready') return { status: 'failed', detail: excerpt.issue };

         const written = await Result.tryPromise({
            try: async () => {
               const folder = await mkdtemp(join(tmpdir(), 'encore-log-'));
               const path = join(folder, textLogFileName(request.fileId));
               await writeFile(path, excerpt.text, 'utf8');
               return path;
            },
            catch: causeMessage
         });
         if (Result.isError(written)) return { status: 'failed', detail: written.error };

         return openPath(written.value);
      },
      copyLog: async (request): Promise<SupportExportResult> => {
         const excerpt = await support.readLog(request);
         if (excerpt.status !== 'ready') return { status: 'failed', detail: excerpt.issue };

         clipboard.writeText(excerpt.text);
         return { status: 'copied' };
      },
      saveLog: async (request, event): Promise<SupportExportResult> => {
         const excerpt = await support.readLog(request);
         if (excerpt.status !== 'ready') return { status: 'failed', detail: excerpt.issue };

         return saveTextFile(event, textLogFileName(request.fileId), excerpt.text, [
            { name: translate('home.logs.fileFilter'), extensions: ['log', 'txt'] }
         ]);
      },
      previewDiagnostics: (request) => support.buildDiagnostics(request),
      exportDiagnostics: async (request, event): Promise<SupportExportResult> => {
         if (request.destination === 'clipboard') {
            clipboard.writeText(request.text);
            return { status: 'copied' };
         }

         return saveTextFile(event, posix.basename(request.fileName), request.text, [
            { name: translate('home.diagnostics.fileFilter'), extensions: ['md'] }
         ]);
      }
   });
}

async function openPath(path: string): Promise<SupportLogOpenResult> {
   const failed = await shell.openPath(path);
   return failed ? { status: 'failed', detail: failed } : { status: 'opened' };
}

async function saveTextFile(event: IpcMainInvokeEvent, defaultPath: string, text: string, filters: FileFilter[]): Promise<SupportExportResult> {
   const chosen = await showSaveDialog(event, { defaultPath, filters });
   if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };

   const written = await Result.tryPromise({
      try: async () => {
         await mkdir(dirname(chosen.filePath), { recursive: true });
         await writeFile(chosen.filePath, text, 'utf8');
      },
      catch: causeMessage
   });

   return Result.isError(written) ? { status: 'failed', detail: written.error } : { status: 'saved', path: chosen.filePath };
}
