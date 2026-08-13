import type { IpcFailureResult } from '@/ipc/core';
import type { TargetId } from '@/modules/targets/contract';

type UnsupportedTargetDetails = {
   targetId: TargetId;
   installId?: string;
   rootPath?: string;
};

export function unsupportedTarget(
   domain: string,
   action: string,
   request: { targetId: TargetId; installId?: string; rootPath?: string }
): IpcFailureResult {
   const details: UnsupportedTargetDetails = { targetId: request.targetId };
   if (request.installId) details.installId = request.installId;
   if (request.rootPath) details.rootPath = request.rootPath;

   return {
      ok: false,
      error: {
         code: `${domain}.unsupported-target`,
         message: `this target cannot ${action}`,
         details
      }
   };
}
