import { useEffect, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { FolderSymlink, Home, Plus, Settings } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { AppLink } from '@/components/app-link';
import { EncoreMark } from '@/components/encore-mark';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/components/utils';

import { AlphaWarningDialog } from '@/modules/app/renderer/alpha-warning-dialog';
import { appInfoQueryOptions } from '@/modules/app/renderer/app-queries';
import { Onboarding } from '@/modules/app/renderer/onboarding';
import { AddInstallDialog } from '@/modules/downloads/renderer/add-install-dialog';
import { useVersionDownload, type VersionDownloader } from '@/modules/downloads/renderer/use-version-download';
import { ImportInstallDialog } from '@/modules/installs/renderer/import-install-dialog';
import { useInstallImport, type InstallImporter } from '@/modules/installs/renderer/use-install-import';
import { MapLinkDialog } from '@/modules/maps/renderer/map-link-dialog';
import { ModelLinkDialog } from '@/modules/models/renderer/model-link-dialog';
import { ModRepositoryLinkDialog } from '@/modules/mods/renderer/mod-repository-link-dialog';
import { useRepositorySync } from '@/modules/mods/renderer/use-repository-sync';
import { PlaylistLinkDialog } from '@/modules/playlists/renderer/playlist-link-dialog';
import { QuestSetupDialog } from '@/modules/quest/renderer/quest-setup';
import { SettingsNav } from '@/modules/settings/renderer/settings-nav';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { DeepLinkLaunchDialog } from '@/modules/shortcuts/renderer/deep-link-launch-dialog';
import { runsOnSteamFrame } from '@/modules/targets/contract';
import { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';
import { SidebarUpdateButton } from '@/modules/updates/renderer/update-controls';
import { sidebarItemClassName, SidebarTargets } from '@/renderer/shell/sidebar-targets';

const activeSidebarItemClassName = 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground';

export function AppShell({ children }: { children: React.ReactNode }) {
   const t = useTranslations('nav');
   const app = useTranslations('app');
   const common = useTranslations('common');
   const appInfo = useQuery(appInfoQueryOptions);
   const targetList = useSelectedTarget();
   useRepositorySync();
   const usesCustomTitleBar = window.encore.runtime === 'desktop' && window.encore.platform === 'win32';
   const supportsLocalBeatSaber = window.encore.platform === 'win32' || window.encore.platform === 'linux';
   const showSharedContent = supportsLocalBeatSaber || targetList.targets.some((target) => target.capabilities.includes('share-content'));
   const downloader = useVersionDownload();
   const importer = useInstallImport();
   const [questSetupOpen, setQuestSetupOpen] = useState(false);
   const settings = useSettings();
   const desktop = window.encore.runtime === 'desktop';
   const onboarding = desktop && settings.snapshot?.app.setup === null;
   const location = useRouterState({ select: (state) => state.location });
   const pathname = location.pathname;
   const settingsIsActive = pathname.startsWith('/settings');
   const appHref = useRef('/');
   const navigate = useNavigate();

   useEffect(() => {
      if (!settingsIsActive) appHref.current = location.href;
   }, [location.href, settingsIsActive]);

   return (
      <>
         {onboarding ? <Onboarding importer={importer} downloader={downloader} /> : null}
         {onboarding || (desktop && settings.loadStatus === 'loading') ? null : (
            <div
               className={cn(
                  'bg-background text-foreground h-dvh',
                  window.encore.runtime === 'mobile' && 'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
                  usesCustomTitleBar
                     ? 'grid grid-cols-[4.5rem_minmax(0,1fr)] grid-rows-[2rem_minmax(0,1fr)] sm:grid-cols-[15rem_minmax(0,1fr)]'
                     : 'flex flex-col'
               )}
            >
               {window.encore.runtime === 'desktop' && !runsOnSteamFrame(targetList.targets) ? (
                  <div className={cn(usesCustomTitleBar && 'col-start-2 row-start-1 border-b-[0.5px]')}>
                     <header className="window-title-bar bg-background h-8 shrink-0" />
                  </div>
               ) : null}
               <div
                  className={cn(
                     usesCustomTitleBar
                        ? 'contents'
                        : 'grid min-h-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)] border-t-[0.5px] sm:grid-cols-[15rem_minmax(0,1fr)]'
                  )}
               >
                  <aside
                     className={cn(
                        'bg-card/70 relative col-start-1 flex min-h-0 flex-col border-r px-2 py-5 sm:px-4',
                        usesCustomTitleBar ? 'row-span-2 row-start-1' : 'h-full'
                     )}
                  >
                     {usesCustomTitleBar ? <div aria-hidden="true" className="window-title-bar absolute inset-x-0 top-0 h-5" /> : null}
                     <div className={cn('flex items-center justify-center gap-3 sm:justify-start', usesCustomTitleBar && 'window-title-bar')}>
                        <EncoreMark className="text-primary size-11 shrink-0" />
                        <div className="hidden min-w-0 sm:block">
                           <div className="truncate text-sm font-semibold">{app('name')}</div>
                           <div className="flex min-w-0 items-center gap-1.5">
                              <div className="text-muted-foreground min-w-0 truncate text-xs">{appInfo.data?.release.label ?? common('loading')}</div>
                              {window.encore.runtime === 'desktop' ? <SidebarUpdateButton /> : null}
                           </div>
                        </div>
                     </div>

                     <Separator className="my-5" />

                     {settingsIsActive ? (
                        <SettingsNav
                           pathname={pathname}
                           itemClassName={sidebarItemClassName}
                           onBack={() => void navigate({ href: appHref.current })}
                        />
                     ) : (
                        <nav className="flex min-h-0 flex-1 flex-col" aria-label={t('label')}>
                           <div className="flex flex-col gap-1">
                              <SidebarLink to="/" isActive={pathname === '/'}>
                                 <Home className="size-4 shrink-0" />
                                 <span className="hidden truncate sm:block">{t('home')}</span>
                              </SidebarLink>
                              {showSharedContent ? (
                                 <SidebarLink to="/shared" isActive={pathname === '/shared'}>
                                    <FolderSymlink className="size-4 shrink-0" />
                                    <span className="hidden truncate sm:block">{t('shared')}</span>
                                 </SidebarLink>
                              ) : null}
                           </div>

                           <Separator className="my-4" />

                           <div className="min-h-0 flex-1 overflow-y-auto">
                              <SidebarTargets targetList={targetList} />
                           </div>

                           <div className="shrink-0">
                              <Separator className="mb-3" />
                              <button
                                 type="button"
                                 className={cn(sidebarItemClassName, 'mb-1 w-full')}
                                 disabled={downloader.step.status !== 'closed' || importer.state.status !== 'idle'}
                                 onClick={downloader.openWhere}
                              >
                                 <Plus className="size-4 shrink-0" />
                                 <span className="hidden truncate sm:block">{t('add')}</span>
                              </button>
                              <SidebarLink to="/settings">
                                 <Settings className="size-4 shrink-0" />
                                 <span className="hidden truncate sm:block">{t('settings')}</span>
                              </SidebarLink>
                           </div>
                        </nav>
                     )}
                  </aside>

                  <main className={cn('col-start-2 flex min-w-0 flex-col overflow-hidden', usesCustomTitleBar && 'row-start-2')}>{children}</main>
               </div>
            </div>
         )}
         <GlobalDialogs importer={importer} downloader={downloader} onQuest={() => setQuestSetupOpen(true)} />
         <QuestSetupDialog open={questSetupOpen} onOpenChange={setQuestSetupOpen} />
         <Toaster richColors closeButton />
      </>
   );
}

function SidebarLink({ to, isActive, children }: { to: '/' | '/shared' | '/settings'; isActive?: boolean; children: React.ReactNode }) {
   return (
      <AppLink to={to} aria-current={isActive ? 'page' : undefined} className={cn(sidebarItemClassName, isActive && activeSidebarItemClassName)}>
         {children}
      </AppLink>
   );
}

function GlobalDialogs({ importer, downloader, onQuest }: { importer: InstallImporter; downloader: VersionDownloader; onQuest: () => void }) {
   return (
      <>
         <DeepLinkLaunchDialog />
         <MapLinkDialog />
         <ModelLinkDialog />
         <ModRepositoryLinkDialog />
         <PlaylistLinkDialog />
         <AlphaWarningDialog />
         <ImportInstallDialog importer={importer} />
         {importer.dialog}
         <AddInstallDialog downloader={downloader} importer={importer} onQuest={onQuest} />
      </>
   );
}
