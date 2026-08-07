import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { InstallModelsPanel } from '@/modules/models/renderer/install-models-panel';
import { useInstallModels } from '@/modules/models/renderer/use-install-models';

export function InstallModelsTab({ request, active }: { request: TargetModelCollectionRequest; active: boolean }) {
   const models = useInstallModels(request);

   return active ? <InstallModelsPanel request={request} models={models} /> : null;
}
