import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';

import type { MessageKey } from '@/app/renderer/i18n/keys';
import type { InstallProblem, InstallProblemCode, InstallSummary } from '@/modules/installs/contract';

const problemMessageKeys: Record<InstallProblemCode, MessageKey<'installs'>> = {
   'install.path.unreadable': 'problems.pathUnreadable',
   'install.registry.write-failed': 'problems.registryWriteFailed',
   'install.version.unknown': 'problems.versionUnknown'
};

export function InstallStatusBadge({ install }: { install: InstallSummary }) {
   const t = useTranslations('installs');

   if (install.status === 'ready') return null;

   return <Badge variant={install.status === 'missing' ? 'destructive' : 'secondary'}>{t(`status.${install.status}`)}</Badge>;
}

export function useInstallSecondaryLabel(install: InstallSummary) {
   const targets = useTranslations('targets');

   if (install.version && install.version !== install.name) return install.version;

   return install.store ? targets(`store.${install.store}`) : null;
}

export function InstallProblemRow({ problem }: { problem: InstallProblem }) {
   const t = useTranslations('installs');

   return (
      <WarningLine className="min-w-0 rounded-md border px-3 py-2">{t(problemMessageKeys[problem.code], { path: problem.path ?? '' })}</WarningLine>
   );
}
