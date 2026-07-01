import { Link, useRouterState } from '@tanstack/react-router';
import { Home, Monitor, Plus, RefreshCw, Settings, Wifi } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';

import { useAppInfo } from '@/renderer/electron/use-app-info';
import { useAppUpdate } from '@/renderer/electron/use-app-update';
import { cn } from '@/shared/format/helpers';

const beatSaberVersions = [
   { id: 'local-1-40-8', label: '1.40.8', remote: false },
   { id: 'remote-1-39-1', label: '1.39.1', remote: true }
] as const;

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
                     <div className="text-muted-foreground truncate text-xs">{appInfo.data?.release.label ?? common('loading')}</div>
                  </div>
               </div>
               {update.status === 'downloaded' ? (
                  <Button type="button" size="xs" variant="secondary" className="mt-3 w-full" onClick={appUpdate.installUpdate}>
                     <RefreshCw className="size-3" />
                     <span className="truncate">{updates('downloaded')}</span>
                  </Button>
               ) : null}

               <Separator className="my-5" />

               <nav className="flex flex-1 flex-col">
                  <div className="flex flex-col gap-1">
                     <Link
                        to="/"
                        className={cn(
                           'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                           pathname === '/' && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                        )}
                     >
                        <Home className="size-4 shrink-0" />
                        <span className="truncate">{t('home')}</span>
                     </Link>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex flex-col gap-1">
                     {beatSaberVersions.map((version) => (
                        <button
                           key={version.id}
                           type="button"
                           className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors"
                        >
                           {version.remote ? <Wifi className="size-4 shrink-0" /> : <Monitor className="size-4 shrink-0" />}
                           <span className="min-w-0 flex-1 truncate">{version.label}</span>
                        </button>
                     ))}
                  </div>

                  <div className="mt-auto">
                     <Separator className="mb-3" />
                     <button
                        type="button"
                        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground mb-1 flex h-10 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors"
                     >
                        <Plus className="size-4 shrink-0" />
                        <span className="truncate">{t('addVersion')}</span>
                     </button>
                     <Link
                        to="/settings"
                        className={cn(
                           'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                           settingsIsActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                        )}
                     >
                        <Settings className="size-4 shrink-0" />
                        <span className="truncate">{t('settings')}</span>
                     </Link>
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
