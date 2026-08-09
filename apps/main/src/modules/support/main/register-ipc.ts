import { Result } from 'better-result';
import { clipboard, dialog, shell, type FileFilter } from 'electron';

import { openExternalUrl } from '@/external-navigation';
import { defineIpcHandlers } from '@/ipc/main';
import { causeMessage } from '@/lib/errors';
import { supportLinkUrls, type SupportExportResult, type SupportLinkResult, type SupportLogOpenResult } from '@/modules/support/contract';
import { supportIpc } from '@/modules/support/ipc';
import type { SupportService } from '@/modules/support/main/support-service';
import { localTargetId } from '@/modules/targets/contract';

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

export function createSupportIpcModule(support: SupportService) {
   return defineIpcHandlers(supportIpc, {
      openLink: async (_event, request): Promise<SupportLinkResult> => {
         const decision = await openExternalUrl(supportLinkUrls[request.id], (url) => shell.openExternal(url));

         return decision.allowed ? { id: request.id, status: 'opened' } : { id: request.id, status: 'blocked', reason: decision.reason };
      },
      getLogs: (_event, request) => support.getLogs(request),
      readLog: (_event, request) => support.readLog(request),
      openLog: async (_event, request) => {
         if (request.source === 'app' || request.targetId === localTargetId) {
            const path = await support.resolveLocalLogPath(request);
            if (Result.isError(path)) return { status: 'failed', message: path.error.detail ?? path.error.issue };

            return openPath(path.value);
         }

         const excerpt = await support.readLog(request);
         if (excerpt.status !== 'ready') return { status: 'failed', message: excerpt.issue };

         const written = await Result.tryPromise({
            try: async () => {
               const folder = await mkdtemp(join(tmpdir(), 'encore-log-'));
               const path = join(folder, posix.basename(request.fileId));
               await writeFile(path, excerpt.text, 'utf8');
               return path;
            },
            catch: causeMessage
         });
         if (Result.isError(written)) return { status: 'failed', message: written.error };

         return openPath(written.value);
      },
      copyLog: async (_event, request): Promise<SupportExportResult> => {
         const excerpt = await support.readLog(request);
         if (excerpt.status !== 'ready') return { status: 'failed', message: excerpt.issue };

         clipboard.writeText(excerpt.text);
         return { status: 'copied' };
      },
      saveLog: async (_event, request): Promise<SupportExportResult> => {
         const excerpt = await support.readLog(request);
         if (excerpt.status !== 'ready') return { status: 'failed', message: excerpt.issue };

         return saveTextFile(posix.basename(request.fileId), excerpt.text, [{ name: 'Log files', extensions: ['log', 'txt'] }]);
      },
      previewDiagnostics: (_event, request) => support.buildDiagnostics(request),
      exportDiagnostics: async (_event, request): Promise<SupportExportResult> => {
         if (request.destination === 'clipboard') {
            clipboard.writeText(request.text);
            return { status: 'copied' };
         }

         return saveTextFile(posix.basename(request.fileName), request.text, [{ name: 'Markdown', extensions: ['md'] }]);
      }
   });
}

async function openPath(path: string): Promise<SupportLogOpenResult> {
   const failed = await shell.openPath(path);
   return failed ? { status: 'failed', message: failed } : { status: 'opened' };
}

async function saveTextFile(defaultPath: string, text: string, filters: FileFilter[]): Promise<SupportExportResult> {
   const chosen = await dialog.showSaveDialog({ defaultPath, filters });
   if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };

   const written = await Result.tryPromise({
      try: async () => {
         await mkdir(dirname(chosen.filePath), { recursive: true });
         await writeFile(chosen.filePath, text, 'utf8');
      },
      catch: causeMessage
   });

   return Result.isError(written) ? { status: 'failed', message: written.error } : { status: 'saved', path: chosen.filePath };
}
