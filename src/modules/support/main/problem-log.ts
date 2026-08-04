import type { AppLogWriter } from '@/modules/support/main/app-log';

type RecoveredProblem = {
   code: string;
   message: string;
   path?: string;
   detail?: string;
};

let writer: AppLogWriter | null = null;

export function setProblemLogWriter(next: AppLogWriter | null) {
   writer = next;
}

export function logRecoveredProblem(scope: string, problem: RecoveredProblem) {
   const parts = [`${scope}: ${problem.code} ${problem.message}`];
   if (problem.path) parts.push(`path=${problem.path}`);
   if (problem.detail) parts.push(`detail=${problem.detail}`);

   void writer?.warn(parts.join(' '));
}
