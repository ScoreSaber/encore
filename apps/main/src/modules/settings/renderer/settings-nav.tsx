import type { LinkProps } from '@tanstack/react-router';
import { ArrowLeft, Blocks, Cable, HardDrive, Link2, Palette, Settings2, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { AppLink } from '@/components/app-link';
import { QuestIcon } from '@/components/headset-icons';
import { cn } from '@/components/utils';

import { runsOnSteamFrame, type Target } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type SettingsPage = {
   to: LinkProps['to'];
   page: 'general' | 'appearance' | 'library' | 'mods' | 'links' | 'quest' | 'remote';
   icon: LucideIcon | typeof QuestIcon;
   visible?: (targets: Target[]) => boolean;
};

const desktop = window.encore.runtime === 'desktop';
const localBeatSaber = desktop && (window.encore.platform === 'win32' || window.encore.platform === 'linux');

export const settingsPages: SettingsPage[] = [
   { to: '/settings/general', page: 'general', icon: Settings2 },
   { to: '/settings/appearance', page: 'appearance', icon: Palette },
   { to: '/settings/library', page: 'library', icon: HardDrive, visible: () => localBeatSaber },
   {
      to: '/settings/mods',
      page: 'mods',
      icon: Blocks,
      visible: (targets) => targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-mods'))
   },
   { to: '/settings/links', page: 'links', icon: Link2, visible: () => desktop },
   {
      to: '/settings/quest',
      page: 'quest',
      icon: QuestIcon,
      visible: (targets) => desktop && !runsOnSteamFrame(targets)
   },
   { to: '/settings/remote', page: 'remote', icon: Cable }
];

export function SettingsNav({ pathname, itemClassName, onBack }: { pathname: string; itemClassName: string; onBack: () => void }) {
   const t = useTranslations('settings');
   const { targets } = useTargets();

   return (
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label={t('pageTitle')}>
         <button type="button" className={cn(itemClassName, 'mb-3')} onClick={onBack}>
            <ArrowLeft className="size-4 shrink-0" />
            <span className="hidden truncate sm:block">{t('back')}</span>
         </button>
         {settingsPages
            .filter((page) => page.visible?.(targets) ?? true)
            .map(({ to, page, icon: Icon }) => {
               const active = pathname === to;

               return (
                  <AppLink
                     key={page}
                     to={to}
                     aria-current={active ? 'page' : undefined}
                     className={cn(itemClassName, active && 'bg-accent text-accent-foreground')}
                  >
                     <Icon className="size-4 shrink-0" />
                     <span className="hidden truncate sm:block">{t(`pages.${page}`)}</span>
                  </AppLink>
               );
            })}
      </nav>
   );
}
