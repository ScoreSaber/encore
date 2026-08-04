import type { IpcFailureResult } from '@/app/ipc/core';
import type { TargetId } from '@/modules/targets/contract';

export function unsupportedTarget(
   domain: string,
   action: string,
   request: { targetId: TargetId; installId?: string; rootPath?: string }
): IpcFailureResult {
   return {
      ok: false,
      error: {
         code: `${domain}.unsupported-target`,
         message: `this target cannot ${action}`,
         details: {
            targetId: request.targetId,
            ...(request.installId ? { installId: request.installId } : {}),
            ...(request.rootPath ? { rootPath: request.rootPath } : {})
         }
      }
   };
}
