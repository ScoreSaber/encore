import { Link, useRouterState } from '@tanstack/react-router';
import { Home, Monitor, Plus, RefreshCw, Settings, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useAppInfo } from '@/renderer/electron/use-app-info';
import { useAppUpdate } from '@/renderer/electron/use-app-update';
import { cn } from '@/shared/format/helpers';

const beatSaberVersions = [
   { id: 'local-1-40-8', label: '1.40.8', remote: false },
   { id: 'remote-1-39-1', label: '1.39.1', remote: true }
] as const;

const sidebarItemClassName =
   'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 cursor-default items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors';
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
         <div className="bg-background text-foreground grid min-h-screen grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="bg-card/70 sticky top-0 flex h-screen flex-col border-r px-4 py-5">
               <div className="flex items-center gap-3">
                  <div className="bg-primary text-primary-foreground font-pixel flex size-11 shrink-0 items-center justify-center rounded-md text-xl">
                     E
                  </div>
                  <div className="min-w-0">
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
                        <span className="truncate">{t('home')}</span>
                     </SidebarLink>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex flex-col gap-1">
                     {beatSaberVersions.map((version) => (
                        <SidebarButton key={version.id}>
                           {version.remote ? <Wifi className="size-4 shrink-0" /> : <Monitor className="size-4 shrink-0" />}
                           <span className="min-w-0 flex-1 truncate">{version.label}</span>
                        </SidebarButton>
                     ))}
                  </div>

                  <div className="mt-auto">
                     <Separator className="mb-3" />
                     <SidebarButton className="mb-1 w-full">
                        <Plus className="size-4 shrink-0" />
                        <span className="truncate">{t('addVersion')}</span>
                     </SidebarButton>
                     <SidebarLink to="/settings" isActive={settingsIsActive}>
                        <Settings className="size-4 shrink-0" />
                        <span className="truncate">{t('settings')}</span>
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
