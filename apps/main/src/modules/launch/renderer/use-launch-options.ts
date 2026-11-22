import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { InstallActionRequest } from '@/modules/installs/contract';
import { createDefaultLaunchOptions, formatLaunchArgs, parseLaunchArgs, type LaunchFlag, type LaunchOptions } from '@/modules/launch/contract';
import { launchOptionsQueryOptions } from '@/modules/launch/renderer/launch-queries';
import { unwrapIpc, unwrapTarget } from '@/renderer/ipc-result';
import { useOptimisticMutation } from '@/renderer/query/api-query';

function formatEnvironment(environment: LaunchOptions['environment']) {
   return formatLaunchArgs(Object.entries(environment).map(([name, value]) => `${name}=${value}`));
}

function parseEnvironment(input: string) {
   return Object.fromEntries(
      parseLaunchArgs(input).map((assignment) => {
         const separator = assignment.indexOf('=');
         return separator === -1 ? [assignment, ''] : [assignment.slice(0, separator), assignment.slice(separator + 1)];
      })
   );
}

export function useLaunchOptions(request: InstallActionRequest, legacyOptions: LaunchOptions | null) {
   const stored = useQuery(launchOptionsQueryOptions(request));
   const requestKey = `${request.targetId}\0${request.installId}`;
   const [typedState, setTypedState] = useState<{ requestKey: string; args?: string; environment?: string }>({ requestKey });
   const save = useOptimisticMutation({
      queryKey: launchOptionsQueryOptions(request).queryKey,
      run: async (options: LaunchOptions) => unwrapIpc(unwrapTarget(await window.encore.launch.updateOptions({ ...request, options }))),
      preview: (_current, options) => options
   });
   const typed = typedState.requestKey === requestKey ? typedState : { requestKey };
   const options = stored.data ?? legacyOptions ?? createDefaultLaunchOptions();

   const update = (next: LaunchOptions) =>
      save.mutate(next, {
         onError: () => {
            setTypedState({ requestKey });
         }
      });

   return {
      options,
      ready: !stored.isPending,
      failure: save.error?.message ?? null,
      argsInput: typed.args ?? formatLaunchArgs(options.args),
      environmentInput: typed.environment ?? formatEnvironment(options.environment),
      setArgsInput: (args: string) => {
         setTypedState({ ...typed, args });
         update({ ...options, args: parseLaunchArgs(args) });
      },
      setEnvironmentInput: (environment: string) => {
         setTypedState({ ...typed, environment });
         update({ ...options, environment: parseEnvironment(environment) });
      },
      setRunAsAdmin: (runAsAdmin: boolean) => update({ ...options, runAsAdmin }),
      setCloseEncore: (closeEncore: boolean) => update({ ...options, closeEncore }),
      toggleFlag: (flag: LaunchFlag, enabled: boolean) =>
         update({ ...options, flags: enabled ? [...new Set([...options.flags, flag])] : options.flags.filter((candidate) => candidate !== flag) })
   };
}
