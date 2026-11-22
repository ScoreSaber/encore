import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';

import type { InstallProblem, InstallSummary } from '@/modules/installs/contract';

export function InstallStatusBadge({ install }: { install: InstallSummary }) {
   const t = useTranslations('installs');

   if (install.status === 'ready') return null;

   return <Badge variant={install.status === 'missing' ? 'destructive' : 'secondary'}>{t(`status.${install.status}`)}</Badge>;
}

export function InstallProblemRow({ problem }: { problem: InstallProblem }) {
   return <WarningLine className="min-w-0 rounded-md border px-3 py-2">{problem.message}</WarningLine>;
}
