import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { InstallActionRequest } from '@/modules/installs/contract';
import { createDefaultLaunchOptions, formatLaunchArgs, parseLaunchArgs, type LaunchFlag, type LaunchOptions } from '@/modules/launch/contract';
import { launchOptionsQueryOptions } from '@/modules/launch/renderer/launch-queries';
import { unwrapIpc, unwrapTarget } from '@/renderer/ipc-result';
import { useOptimisticMutation } from '@/renderer/query/api-query';

const gameToken = '%command%';

function formatLaunchLine({ environment, wrapper, args }: LaunchOptions) {
   const prefix = [...Object.entries(environment).map(([name, value]) => `${name}=${value}`), ...wrapper];
   return formatLaunchArgs(prefix.length > 0 ? [...prefix, gameToken, ...args] : args);
}

function parseLaunchLine(input: string) {
   const tokens = parseLaunchArgs(input);
   const gameIndex = tokens.indexOf(gameToken);
   if (gameIndex === -1) return { environment: {}, wrapper: [], args: tokens };

   const prefix = tokens.slice(0, gameIndex);
   const wrapperIndex = prefix.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
   const environmentEnd = wrapperIndex === -1 ? prefix.length : wrapperIndex;
   return {
      environment: Object.fromEntries(
         prefix.slice(0, environmentEnd).map((assignment) => {
            const separator = assignment.indexOf('=');
            return [assignment.slice(0, separator), assignment.slice(separator + 1)];
         })
      ),
      wrapper: prefix.slice(environmentEnd),
      args: tokens.slice(gameIndex + 1)
   };
}

export function useLaunchOptions(request: InstallActionRequest, legacyOptions: LaunchOptions | null) {
   const stored = useQuery(launchOptionsQueryOptions(request));
   const requestKey = `${request.targetId}\0${request.installId}`;
   const [typedState, setTypedState] = useState<{ requestKey: string; line?: string }>({ requestKey });
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
      launchLine: typed.line ?? formatLaunchLine(options),
      setLaunchLine: (line: string) => {
         setTypedState({ requestKey, line });
         update({ ...options, ...parseLaunchLine(line) });
      },
      setRunAsAdmin: (runAsAdmin: boolean) => update({ ...options, runAsAdmin }),
      setCloseEncore: (closeEncore: boolean) => update({ ...options, closeEncore }),
      toggleFlag: (flag: LaunchFlag, enabled: boolean) =>
         update({ ...options, flags: enabled ? [...new Set([...options.flags, flag])] : options.flags.filter((candidate) => candidate !== flag) })
   };
}
