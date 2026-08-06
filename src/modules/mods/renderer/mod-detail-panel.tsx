import { lazy, Suspense } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Heart, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { RefreshButton } from '@/components/refresh-button';
import { WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { RemoteImage } from '@/components/ui/remote-image';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { ExternalMod, ModSummary } from '@/modules/mods/contract';
import { githubRepositoryFromUrl } from '@/modules/mods/contract';
import { modFundingQueryOptions } from '@/modules/mods/renderer/mod-queries';
import type { InstallMods } from '@/modules/mods/renderer/use-install-mods';

const MarkdownContent = lazy(() => import('@/components/ui/markdown').then((module) => ({ default: module.MarkdownContent })));

export function ModDetailPanel({ mods, mod, external }: { mods: InstallMods; mod: ModSummary | null; external: ExternalMod | null }) {
   const t = useTranslations('mods');
   const common = useTranslations('common');

   if (mods.status === 'loading') {
      return (
         <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
         </div>
      );
   }

   if (mods.status === 'error') {
      return (
         <div className="flex flex-col items-start gap-3 p-4 text-sm">
            <p>{t('detail.error')}</p>
            <RefreshButton label={common('retry')} onClick={mods.reload} />
         </div>
      );
   }

   if (!mod) {
      if (external) {
         return (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm">
               <div className="text-foreground font-medium">{t('detail.external.title', { name: external.name })}</div>
               <p>{t('detail.external.description')}</p>
            </div>
         );
      }

      return (
         <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm">
            <div className="text-foreground font-medium">{t('detail.empty.title')}</div>
            <p>{t('detail.empty.description')}</p>
         </div>
      );
   }

   return <ModDetail mods={mods} mod={mod} />;
}

function ModDetail({ mods, mod }: { mods: InstallMods; mod: ModSummary }) {
   const t = useTranslations('mods');
   const format = useFormatters();
   const busy = mods.state.status !== 'idle';
   const sourceLink = mod.links.find((link) => link.kind === 'source');
   const githubSource = sourceLink ? githubRepositoryFromUrl(sourceLink.url) : null;
   const funding = useQuery({
      ...modFundingQueryOptions(sourceLink?.url ?? ''),
      enabled: githubSource !== null
   });
   const fundingUrl = funding.data?.status === 'available' ? funding.data.url : null;

   return (
      <div className="flex min-w-0 flex-col gap-4 p-4">
         <div className="flex min-w-0 items-start gap-3">
            {mod.iconUrl ? (
               <RemoteImage
                  src={mod.iconUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="bg-muted size-10 shrink-0 rounded-md border object-cover"
               />
            ) : null}
            <div className="min-w-0 flex-1">
               <h3 className="flex min-w-0 items-baseline gap-2 text-base font-medium">
                  <span className="truncate">{mod.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs font-normal">
                     {mod.state === 'update-available' && mod.installedVersion
                        ? t('detail.versionPair', { installed: mod.installedVersion, latest: mod.latestVersion })
                        : t('detail.version', { version: mod.installedVersion ?? mod.latestVersion })}
                  </span>
               </h3>
               <p className="text-muted-foreground text-xs">
                  {t.rich('detail.meta', {
                     author: mod.author || t('unknownAuthor'),
                     sourceLabel: t(`detail.source.${mod.sourceKind}`),
                     source: mod.sourceName,
                     size: mod.sizeBytes === null ? t('unknownSize') : format.bytes(mod.sizeBytes),
                     accent: (chunks) => <span className={mod.sourceKind === 'unofficial' ? 'text-primary' : undefined}>{chunks}</span>
                  })}
               </p>
            </div>
         </div>

         <div className="flex flex-wrap items-center gap-2">
            {mod.state === 'available' ? (
               <Button type="button" size="sm" disabled={busy} onClick={() => void mods.previewInstall([mod.modId])}>
                  <Download data-icon="inline-start" />
                  {t('detail.install')}
               </Button>
            ) : null}
            {mod.state === 'update-available' ? (
               <Button type="button" size="sm" disabled={busy} onClick={() => void mods.previewInstall([mod.modId])}>
                  <RefreshCw data-icon="inline-start" />
                  {t('detail.update')}
               </Button>
            ) : null}
            {fundingUrl ? (
               <CopyPathContextMenu pathType="url" value={fundingUrl}>
                  <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={() => mods.openLink(fundingUrl)}>
                     <Heart />
                     {t('detail.sponsor')}
                  </Button>
               </CopyPathContextMenu>
            ) : null}
            {mod.state === 'available' ? null : (
               <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mods.previewUninstall('selection', [mod.modId])}>
                  <Trash2 data-icon="inline-start" />
                  {t('detail.uninstall')}
               </Button>
            )}
            {mod.links.map((link) => {
               const githubLink = link.kind === 'source' && githubRepositoryFromUrl(link.url) !== null;

               return (
                  <CopyPathContextMenu key={link.kind} pathType="url" value={link.url}>
                     <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="text-muted-foreground cursor-pointer"
                        onClick={() => mods.openLink(link.url)}
                     >
                        {githubLink ? <GitHubLogo /> : null}
                        {t(`detail.links.${link.kind}`)}
                        {githubLink ? null : <ExternalLink className="size-3" />}
                     </Button>
                  </CopyPathContextMenu>
               );
            })}
         </div>

         {mods.linkBlocked ? <p className="text-muted-foreground text-xs">{t('detail.linkBlocked')}</p> : null}

         {mod.claimedIdentity ? (
            <WarningLine>{t('detail.claimedIdentity', { source: mod.sourceName, identity: mod.claimedIdentity })}</WarningLine>
         ) : null}

         <Separator />

         {mod.description.trim() === '' ? (
            <p className="text-muted-foreground text-sm">{mod.summary || t('detail.noDescription')}</p>
         ) : (
            <Suspense fallback={<Skeleton className="h-32 w-full" />}>
               <MarkdownContent content={mod.description} onLinkClick={mods.openLink} />
            </Suspense>
         )}
      </div>
   );
}

function GitHubLogo() {
   return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-current">
         <path d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.4 3.5 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.9 0C16.1 5 17.1 5.3 17.1 5.3c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.5 5.7.5.4.9 1.2.9 2.3v3.1c0 .3.2.6.8.5A11.5 11.5 0 0 0 12 .7Z" />
      </svg>
   );
}
