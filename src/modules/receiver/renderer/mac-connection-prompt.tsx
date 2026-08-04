import { useState } from 'react';

import { ConnectionSetupPrompt } from '@/modules/receiver/renderer/connection-setup-prompt';
import { RemoteSetupDialog } from '@/modules/receiver/renderer/remote-setup-dialog';
import { useReceiver } from '@/modules/receiver/renderer/use-receiver';
import type { ReceiverSettings } from '@/modules/settings/contract';
import type { Target, TargetId } from '@/modules/targets/contract';

export function MacConnectionPrompt({
   receiverSettings,
   remoteTargets,
   onRemotePaired
}: {
   receiverSettings: ReceiverSettings;
   remoteTargets: Target[];
   onRemotePaired: (targetId: TargetId) => void;
}) {
   const receiver = useReceiver();
   const [setupOpen, setSetupOpen] = useState(false);
   const hasConnectedPC = remoteTargets.some((target) => target.status === 'ready' && target.capabilities.includes('list-installs'));
   const hasSavedPC = remoteTargets.length > 0;

   return (
      <>
         {hasConnectedPC ? null : <ConnectionSetupPrompt context="home" hasSavedPC={hasSavedPC} onSetup={() => setSetupOpen(true)} />}

         <RemoteSetupDialog
            open={setupOpen}
            receiver={receiver}
            receiverSettings={receiverSettings}
            startWithConnection
            onOpenChange={setSetupOpen}
            onRemotePaired={onRemotePaired}
         />
      </>
   );
}
