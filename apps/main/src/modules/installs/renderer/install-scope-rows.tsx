import { useTranslations } from 'use-intl';

import type { InstallDetailRequest } from '@/modules/installs/contract';
import { useInstallDetail } from '@/modules/installs/renderer/use-install-detail';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { useTargets } from '@/modules/targets/renderer/use-targets';

export function InstallScopeRows({
   request,
   showPath = true,
   compact = false
}: {
   request: InstallDetailRequest;
   showPath?: boolean;
   compact?: boolean;
}) {
   const t = useTranslations('common.scope');
   const { detail } = useInstallDetail(request);
   const { targets } = useTargets();
   const target = targets.find((candidate) => candidate.id === request.targetId) ?? null;
   const install = detail?.name ?? t('unknownInstall');
   const device = target?.name ?? t('unknownDevice');

   if (compact) return <p className="text-muted-foreground">{t('summary', { install, device })}</p>;

   return (
      <>
         <PreviewRow label={t('install')} value={install} />
         {showPath ? <PreviewRow label={t('path')} value={detail?.path ?? t('unknownPath')} /> : null}
         <PreviewRow label={t('device')} value={device} />
      </>
   );
}
