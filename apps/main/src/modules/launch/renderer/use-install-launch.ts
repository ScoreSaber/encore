import { useMutation, useQuery } from '@tanstack/react-query';

import { createProblem } from '@/lib/errors';
import type { InstallActionRequest } from '@/modules/installs/contract';
import type { LaunchPreview, ReadyLaunchPreview } from '@/modules/launch/contract';
import { launchPreviewQueryOptions, launchStateQueryOptions } from '@/modules/launch/renderer/launch-queries';
import { useLaunchOptions } from '@/modules/launch/renderer/use-launch-options';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import { localTargetId } from '@/modules/targets/contract';
import { unwrapIpc, unwrapTarget } from '@/renderer/ipc-result';

export type InstallLaunch = ReturnType<typeof useInstallLaunch>;

export function useInstallLaunch(request: InstallActionRequest) {
   const launchState = useQuery(launchStateQueryOptions(request.targetId));
   const record = launchState.data?.lastLaunch ?? null;
   const launchOptions = useLaunchOptions(request, record?.installId === request.installId ? record.options : null);
   const { options } = launchOptions;
   const preview = useQuery({ ...launchPreviewQueryOptions(request, options), enabled: launchOptions.ready });
   const flow = useOperationFlow<{ kind: 'launch'; preview: ReadyLaunchPreview }>(request.targetId);
   const { refetch } = launchState;
   const stop = useMutation({
      mutationFn: async () => {
         const stopped = unwrapIpc(unwrapTarget(await window.encore.quest.stopGame({ targetId: request.targetId })));
         if (stopped.status === 'failed') throw new Error((stopped.error ?? createProblem('launch.stop-failed')).message);
      },
      onSuccess: () => refetch()
   });
   const gameRunning = launchState.data?.gameRunning ?? false;
   const previewData: LaunchPreview | undefined = preview.isPlaceholderData ? undefined : preview.data;
   const ready = previewData && previewData.status === 'ok' ? previewData : null;
   const unavailable = previewData && previewData.status === 'unavailable' ? previewData : null;
   const launchFailure =
      flow.state.status === 'failed'
         ? flow.state.error.message
         : flow.operation?.status === 'failed'
           ? (flow.operation.error?.message ?? null)
           : null;

   return {
      ...launchOptions,
      preview: ready,
      unavailable,
      previewFailure: preview.error?.message ?? null,
      launching: flow.busy,
      starting: flow.state.status === 'starting',
      canLaunch: ready !== null && !flow.busy && !gameRunning,
      operation: flow.operation,
      platform: launchState.data?.platform ?? 'other',
      steamFrame: launchState.data?.steamFrame ?? false,
      targetId: request.targetId,
      localTarget: request.targetId === localTargetId,
      gameRunning,
      stopping: stop.isPending,
      optionsFailure: launchOptions.failure,
      failure: stop.error?.message ?? launchFailure,
      recheck: () => void preview.refetch(),
      launch: () => {
         if (ready && !gameRunning) {
            stop.reset();
            void flow.start(
               { kind: 'launch', preview: ready },
               () => window.encore.launch.start({ ...request, options }),
               createProblem('launch.start-failed')
            );
         }
      },
      stop: () => stop.mutate(),
      cancel: flow.cancel
   };
}
