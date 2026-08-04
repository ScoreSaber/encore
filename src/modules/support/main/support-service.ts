import type { ApiModule, TargetDispatcher } from '@/lib/api';
import type { AppInfo } from '@/modules/app/contract';
import { supportApi } from '@/modules/support/api';
import {
   unavailableSupportLogExcerpt,
   type SupportDiagnosticsBundle,
   type SupportLogExcerpt,
   type SupportInstallLogGroup,
   type SupportLogReadRequest,
   type SupportLogsSnapshot
} from '@/modules/support/contract';
import { redactSupportText } from '@/modules/support/main/log-redaction';
import type { SupportLogService } from '@/modules/support/main/support-logs';
import type { TargetId, TargetRequest } from '@/modules/targets/contract';

export type SupportService = ReturnType<typeof createSupportService>;

type SupportTargetInput = { targetId: TargetId };
type SupportReadInput = TargetRequest<SupportLogReadRequest>;

export function createSupportService(options: {
   logs: SupportLogService;
   installLogs: ApiModule<typeof supportApi>;
   callTarget: TargetDispatcher;
   homePath: string;
   getAppInfo: () => AppInfo;
}) {
   async function getInstallLogs(request: SupportTargetInput): Promise<SupportInstallLogGroup> {
      const installResult = await options.callTarget(options.installLogs, 'listInstallLogs', request.targetId, {});

      if (installResult.status === 'ok') return installResult.value;

      return {
         source: 'install',
         status: 'unsupported',
         rootPath: null,
         files: [],
         ...(installResult.status === 'unavailable' ? { detail: installResult.error.message } : {})
      };
   }

   async function getLogs(request: SupportTargetInput): Promise<SupportLogsSnapshot> {
      const [app, install] = await Promise.all([options.logs.listAppLogs(), getInstallLogs(request)]);

      return {
         targetId: request.targetId,
         scannedAt: new Date().toISOString(),
         groups: [install, app]
      };
   }

   async function readLog(request: SupportReadInput): Promise<SupportLogExcerpt> {
      if (request.source === 'app') return options.logs.readLog(request);

      const result = await options.callTarget(options.installLogs, 'readInstallLog', request.targetId, {
         installId: request.installId,
         fileId: request.fileId
      });

      return result.status === 'ok'
         ? result.value
         : unavailableSupportLogExcerpt(
              result.status === 'unsupported' ? 'unsupported-target' : 'unreadable',
              result.status === 'unavailable' ? result.error.message : undefined
           );
   }

   async function buildDiagnostics(request: SupportTargetInput): Promise<SupportDiagnosticsBundle> {
      const generatedAt = new Date().toISOString();
      const info = options.getAppInfo();
      const logs: SupportDiagnosticsBundle['logs'] = [];
      const sections = [describeApp(generatedAt, info), '## Beat Saber logs'];
      const gameLogs = await getInstallLogs(request);
      const files = gameLogs.status === 'ready' ? gameLogs.files.slice(0, 3) : [];

      if (files.length === 0) sections.push('No Beat Saber logs found');

      for (const file of files) {
         const name = `${file.installName} / ${file.id}`;
         const excerpt = await readLog({ source: 'install', fileId: file.id, targetId: request.targetId, installId: file.installId });

         if (excerpt.status !== 'ready') {
            logs.push({ fileId: name, included: false, issue: excerpt.issue });
            sections.push(`### ${name}\n\nUnavailable: ${excerpt.issue}`);
            continue;
         }

         logs.push({ fileId: name, included: true });
         sections.push(formatLog(name, excerpt.text));
      }

      const text = `${redactSupportText(sections.join('\n\n'), { homePath: options.homePath })}\n`;

      return {
         fileName: `encore-diagnostics-${generatedAt.replaceAll(':', '-').slice(0, 19)}.md`,
         text,
         sizeBytes: Buffer.byteLength(text, 'utf8'),
         logs
      };
   }

   return {
      getLogs,
      readLog,
      resolveLocalLogPath: options.logs.resolveLogPath,
      buildDiagnostics
   };
}

function describeApp(generatedAt: string, info: AppInfo) {
   return [
      '# Encore diagnostics',
      `generated: ${generatedAt}`,
      `app: ${info.name} ${info.version} (${info.release.label})`,
      `platform: ${info.platform} ${info.arch}`,
      `electron: ${info.electron}, node: ${info.node}`
   ].join('\n');
}

function formatLog(fileId: string, contents: string) {
   const longestFence = Math.max(2, ...[...contents.matchAll(/`+/g)].map(([match]) => match.length));
   const fence = '`'.repeat(longestFence + 1);

   return `### ${fileId}\n\n${fence}text\n${contents.trimEnd()}\n${fence}`;
}
