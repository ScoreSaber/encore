import { redactSupportText } from '@/modules/support/main/log-redaction';

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type AppLogLevel = 'error' | 'info' | 'warn';

export type AppLogWriter = ReturnType<typeof createAppLogWriter>;

export function createAppLogWriter(options: { logsPath: string; homePath?: string; now?: () => Date }) {
   const now = options.now ?? (() => new Date());
   let queue: Promise<void> = Promise.resolve();

   function record(level: AppLogLevel, message: string) {
      const timestamp = now();
      const line = `${timestamp.toISOString()} ${level.toUpperCase()} ${redactSupportText(message, { homePath: options.homePath })}\n`;

      queue = queue.then(async () => {
         await mkdir(options.logsPath, { recursive: true });
         await appendFile(join(options.logsPath, `encore-${timestamp.toISOString().slice(0, 10)}.log`), line, 'utf8');
      });
      queue = queue.catch(() => undefined);

      return queue;
   }

   return {
      logsPath: options.logsPath,
      info: (message: string) => record('info', message),
      warn: (message: string) => record('warn', message),
      error: (message: string) => record('error', message)
   };
}
