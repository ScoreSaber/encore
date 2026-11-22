import type { IpcFailureResult } from '@/ipc/core';
import { createProblem } from '@/lib/errors';
import type { TargetId } from '@/modules/targets/contract';

export function unsupportedTarget(request: { targetId: TargetId; installId?: string; rootPath?: string }): IpcFailureResult {
   const { targetId, installId, rootPath } = request;
   return { ok: false, error: createProblem('targets.unsupported', { targetId, installId, rootPath }) };
}
