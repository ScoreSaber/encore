import { useCallback, useRef, useState } from 'react';

import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { createLatestGuard } from '@/lib/state/machine';
import { usePathChooser } from '@/modules/files/renderer/path-chooser';
import type { InstallDetail, InstallImportPreview } from '@/modules/installs/contract';
import { localTargetId, type TargetId } from '@/modules/targets/contract';
import { inlineIpcResult, unwrapTarget } from '@/renderer/ipc-result';

type InvalidPreview = Extract<InstallImportPreview, { status: 'invalid' }>;
type ReadyPreview = Extract<InstallImportPreview, { status: 'ok' }>;

type InstallImportState =
   | { status: 'idle' }
   | { status: 'choosing'; targetId: TargetId }
   | { status: 'previewing'; targetId: TargetId }
   | { status: 'invalid'; targetId: TargetId; preview: InvalidPreview }
   | { status: 'ready'; targetId: TargetId; preview: ReadyPreview }
   | { status: 'registering'; targetId: TargetId; preview: ReadyPreview }
   | { status: 'registered'; targetId: TargetId; preview: ReadyPreview; install: InstallDetail }
   | { status: 'failed'; targetId: TargetId; error: Problem };

export type InstallImporter = ReturnType<typeof useInstallImport>;

export function useInstallImport() {
   const installs = window.encore.installs;
   const chooser = usePathChooser();
   const [state, setState] = useState<InstallImportState>({ status: 'idle' });
   const guard = useRef(createLatestGuard());
   const targetId = state.status === 'idle' ? localTargetId : state.targetId;

   const choose = useCallback(
      async (destination: TargetId) => {
         const token = guard.current.next();
         setState({ status: 'choosing', targetId: destination });
         const sourcePath = await chooser.choose({ targetId: destination, kind: 'folder' });
         if (!guard.current.isCurrent(token)) return;
         if (!sourcePath) {
            setState({ status: 'idle' });
            return;
         }

         setState({ status: 'previewing', targetId: destination });
         const previewed = await Result.tryPromise({
            try: async () => unwrapTarget(await installs.previewImport({ targetId: destination, sourcePath })),
            catch: (cause) => createProblem('installs.import.choose-failed', { cause })
         });
         if (!guard.current.isCurrent(token)) return;
         if (Result.isError(previewed)) {
            setState({ status: 'failed', targetId: destination, error: previewed.error });
            return;
         }

         const preview = previewed.value;
         setState(
            preview.status === 'ok' ? { status: 'ready', targetId: destination, preview } : { status: 'invalid', targetId: destination, preview }
         );
      },
      [chooser, installs]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const token = guard.current.next();
      const { targetId: destination, preview } = state;
      setState({ status: 'registering', targetId: destination, preview });

      const registered = await inlineIpcResult(
         () => installs.importFolder({ targetId: destination, sourcePath: preview.sourcePath }),
         createProblem('installs.import.register-failed')
      );
      if (!guard.current.isCurrent(token)) return;

      setState(
         registered.ok
            ? { status: 'registered', targetId: destination, preview, install: registered.value }
            : { status: 'failed', targetId: destination, error: registered.error }
      );
   }, [installs, state]);

   const dismiss = useCallback(() => {
      guard.current.invalidate();
      setState({ status: 'idle' });
   }, []);

   return { state, targetId, choose, confirm, dismiss, dialog: chooser.dialog };
}
