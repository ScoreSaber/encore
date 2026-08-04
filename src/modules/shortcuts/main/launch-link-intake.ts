import type { InstallDetailRequest } from '@/modules/installs/contract';
import { parseLaunchLink, type LaunchLinkEvent } from '@/modules/shortcuts/contract';

export async function resolveLaunchLink(
   link: string,
   getInstall: (request: InstallDetailRequest) => Promise<{ name: string } | null>
): Promise<LaunchLinkEvent> {
   const parsed = parseLaunchLink(link);
   if (parsed.status === 'invalid') return { status: 'rejected', issue: parsed.issue };

   const install = await getInstall({
      targetId: parsed.request.targetId,
      installId: parsed.request.installId
   });
   if (!install)
      return {
         status: 'rejected',
         issue: 'unknown-install',
         detail: parsed.request.installId
      };

   return {
      status: 'ready',
      request: parsed.request,
      installName: install.name
   };
}
