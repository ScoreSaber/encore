import type { InstallDetailRequest } from '@/modules/installs/contract';
import type { LaunchEnvironment } from '@/modules/launch/contract';
import { parseLaunchLink, type LaunchLinkEvent } from '@/modules/shortcuts/contract';

export async function resolveLaunchLink(
   link: string,
   getInstall: (request: InstallDetailRequest) => Promise<{ name: string } | null>,
   getLaunchEnvironment: (request: InstallDetailRequest) => Promise<LaunchEnvironment>
): Promise<LaunchLinkEvent> {
   const parsed = parseLaunchLink(link);
   if (parsed.status === 'invalid') return { status: 'rejected', issue: parsed.issue };

   const request = {
      targetId: parsed.request.targetId,
      installId: parsed.request.installId
   };
   const [install, environment] = await Promise.all([getInstall(request), getLaunchEnvironment(request)]);
   if (!install)
      return {
         status: 'rejected',
         issue: 'unknown-install',
         detail: parsed.request.installId
      };

   return {
      status: 'ready',
      request: {
         ...parsed.request,
         options: { ...parsed.request.options, environment }
      },
      installName: install.name
   };
}
