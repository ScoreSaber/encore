import { Link, useRouterState } from '@tanstack/react-router';
import { Home, Monitor, Plus, RefreshCw, Settings, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useTargets, type TargetListEntry } from '@/modules/targets/use-targets';
import { useAppInfo } from '@/renderer/electron/use-app-info';
import { useAppUpdate } from '@/renderer/electron/use-app-update';
import { cn } from '@/shared/format/helpers';

const sidebarItemClassName =
   'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 cursor-default items-center justify-center gap-3 rounded-md px-0 text-sm font-medium transition-colors sm:justify-start sm:px-3';
const activeSidebarItemClassName = 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground';

export function AppShell({ children }: { children: React.ReactNode }) {
   const t = useTranslations('nav');
   const app = useTranslations('app');
   const common = useTranslations('common');
   const updates = useTranslations('updates');
   const appInfo = useAppInfo();
   const appUpdate = useAppUpdate();
   const pathname = useRouterState({ select: (state) => state.location.pathname });
   const settingsIsActive = pathname === '/settings';
   const update = appUpdate.update;

   return (
      <>
         <div className="bg-background text-foreground grid min-h-screen grid-cols-[4.5rem_minmax(0,1fr)] sm:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="bg-card/70 sticky top-0 flex h-screen flex-col border-r px-2 py-5 sm:px-4">
               <div className="flex items-center justify-center gap-3 sm:justify-start">
                  <div className="bg-primary text-primary-foreground font-pixel flex size-11 shrink-0 items-center justify-center rounded-md text-xl">
                     E
                  </div>
                  <div className="hidden min-w-0 sm:block">
                     <div className="truncate text-sm font-semibold">{app('name')}</div>
                     <div className="flex min-w-0 items-center gap-1.5">
                        <div className="text-muted-foreground min-w-0 truncate text-xs">{appInfo.data?.release.label ?? common('loading')}</div>
                        {update.status === 'downloaded' ? <UpdateButton label={updates('downloaded')} onClick={appUpdate.installUpdate} /> : null}
                     </div>
                  </div>
               </div>

               <Separator className="my-5" />

               <nav className="flex flex-1 flex-col">
                  <div className="flex flex-col gap-1">
                     <SidebarLink to="/" isActive={pathname === '/'}>
                        <Home className="size-4 shrink-0" />
                        <span className="hidden truncate sm:block">{t('home')}</span>
                     </SidebarLink>
                  </div>

                  <Separator className="my-4" />

                  <SidebarTargets />

                  <div className="mt-auto">
                     <Separator className="mb-3" />
                     <SidebarButton className="mb-1 w-full">
                        <Plus className="size-4 shrink-0" />
                        <span className="hidden truncate sm:block">{t('addVersion')}</span>
                     </SidebarButton>
                     <SidebarLink to="/settings" isActive={settingsIsActive}>
                        <Settings className="size-4 shrink-0" />
                        <span className="hidden truncate sm:block">{t('settings')}</span>
                     </SidebarLink>
                  </div>
               </nav>
            </aside>

            <main className="min-w-0">
               <div className="flex w-full flex-col px-8 py-8">{children}</div>
            </main>
         </div>
         <Toaster richColors closeButton />
      </>
   );
}

function SidebarTargets() {
   const t = useTranslations('targets');
   const common = useTranslations('common');
   const { status, entries, reload } = useTargets();

   if (status === 'loading') {
      return (
         <div className="flex flex-col gap-1">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
         </div>
      );
   }

   if (status === 'error') {
      return (
         <div className="flex flex-col items-stretch gap-2 sm:px-3">
            <span className="hidden text-xs sm:block">{t('loadError')}</span>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
               <RefreshCw data-icon="inline-start" />
               <span className="hidden sm:block">{common('retry')}</span>
            </Button>
         </div>
      );
   }

   if (entries.length === 0) {
      return <div className="text-muted-foreground hidden px-3 text-xs sm:block">{t('empty')}</div>;
   }

   return (
      <div className="flex flex-col gap-3">
         {entries.map((entry) => (
            <SidebarTargetSection key={entry.target.id} entry={entry} />
         ))}
      </div>
   );
}

function SidebarTargetSection({ entry }: { entry: TargetListEntry }) {
   const t = useTranslations('targets');
   const target = entry.target;
   const TargetIcon = target.kind === 'remote' ? Wifi : Monitor;

   if (target.status !== 'ready') {
      return (
         <div
            className="text-muted-foreground flex h-10 items-center justify-center gap-3 rounded-md px-0 text-sm font-medium sm:justify-start sm:px-3"
            title={target.name}
         >
            <TargetIcon className="size-4 shrink-0" />
            <span className="hidden min-w-0 flex-1 truncate sm:block">{target.name}</span>
            <span className="hidden shrink-0 text-xs sm:block">{t(`status.${target.status}`)}</span>
         </div>
      );
   }

   return (
      <div className="flex flex-col gap-1">
         <div className="text-muted-foreground hidden items-center px-3 text-xs font-medium sm:flex" title={target.name}>
            <span className="min-w-0 truncate">{target.name}</span>
         </div>
         {entry.installs.map((install) => (
            <SidebarButton key={install.id}>
               <TargetIcon className="size-4 shrink-0" />
               <span className="hidden min-w-0 flex-1 truncate sm:block">
                  {install.source === 'store' && install.store
                     ? t('officialInstall', { store: t(`store.${install.store}`) })
                     : (install.name ?? install.version)}
               </span>
            </SidebarButton>
         ))}
         {entry.installs.length === 0 ? <div className="text-muted-foreground hidden px-3 text-xs sm:block">{t('noVersions')}</div> : null}
      </div>
   );
}

function SidebarLink({ isActive, className, ...props }: React.ComponentProps<typeof Link> & { isActive?: boolean }) {
   return <Link className={cn(sidebarItemClassName, isActive && activeSidebarItemClassName, className)} {...props} />;
}

function SidebarButton({ className, type = 'button', ...props }: React.ComponentProps<'button'>) {
   return <button type={type} className={cn(sidebarItemClassName, 'text-left', className)} {...props} />;
}

function UpdateButton({ label, onClick }: { label: string; onClick: () => void }) {
   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <Button
               type="button"
               size="icon-xs"
               variant="secondary"
               className="size-5 cursor-pointer rounded-full p-0"
               aria-label={label}
               onClick={onClick}
            >
               <RefreshCw className="size-2.5" />
            </Button>
         </TooltipTrigger>
         <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
   );
}
