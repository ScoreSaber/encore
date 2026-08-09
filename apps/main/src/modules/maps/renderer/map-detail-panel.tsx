import { lazy, Suspense, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FolderOpen, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { LocalMapSummary } from '@/modules/maps/contract';
import { MapCoverImage } from '@/modules/maps/renderer/map-cover-image';
import { mapMetadataQueryOptions } from '@/modules/maps/renderer/map-queries';

const MarkdownContent = lazy(() => import('@/components/ui/markdown').then((module) => ({ default: module.MarkdownContent })));

export function MapDetailPanel({
   request,
   map,
   disabled,
   folderResult,
   onDelete,
   onOpenFolder
}: {
   request: TargetMapCollectionRequest;
   map: LocalMapSummary | null;
   disabled: boolean;
   folderResult: 'failed' | 'unsupported' | null;
   onDelete: (mapId: string) => void;
   onOpenFolder?: (mapId: string) => void;
}) {
   const t = useTranslations('maps.detail');

   if (!map) {
      return (
         <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm">
            <div className="text-foreground font-medium">{t('empty.title')}</div>
            <p>{t('empty.description')}</p>
         </div>
      );
   }

   return <MapDetail request={request} map={map} disabled={disabled} folderResult={folderResult} onDelete={onDelete} onOpenFolder={onOpenFolder} />;
}

function MapDetail({
   request,
   map,
   disabled,
   folderResult,
   onDelete,
   onOpenFolder
}: {
   request: TargetMapCollectionRequest;
   map: LocalMapSummary;
   disabled: boolean;
   folderResult: 'failed' | 'unsupported' | null;
   onDelete: (mapId: string) => void;
   onOpenFolder?: (mapId: string) => void;
}) {
   const t = useTranslations('maps.detail');
   const common = useTranslations('common');
   const [linkBlocked, setLinkBlocked] = useState(false);
   const metadata = useQuery(mapMetadataQueryOptions(map.hash));
   const artist = map.artist || t('unknownArtist');
   const mapper = map.mappers.join(', ') || t('unknownMapper');

   const openLink = (url: string) => {
      void window.encore.app.openLink({ url }).then(
         (opened) => setLinkBlocked(opened.status === 'blocked'),
         () => setLinkBlocked(true)
      );
   };

   return (
      <div className="flex min-w-0 flex-col gap-5 p-5 pr-7">
         <div className="flex min-w-0 items-start gap-4">
            <MapCoverImage request={request} map={map} className="size-28 rounded-md border" />
            <div className="min-w-0 flex-1 overflow-hidden pt-1">
               <h3 className="min-w-0 truncate text-lg leading-tight font-semibold">
                  {map.title} <span className="text-muted-foreground font-normal">{t('byArtist', { artist })}</span>
               </h3>
               <p className="text-muted-foreground mt-1 truncate text-sm">{t('mappedBy', { mappers: mapper })}</p>
               <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ButtonGroup aria-label={t('actions')}>
                     {onOpenFolder ? (
                        <Tooltip>
                           <CopyPathContextMenu pathType="path" value={map.path}>
                              <TooltipTrigger asChild>
                                 <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={common('openFolder.action')}
                                    onClick={() => onOpenFolder(map.id)}
                                 >
                                    <FolderOpen />
                                 </Button>
                              </TooltipTrigger>
                           </CopyPathContextMenu>
                           <TooltipContent>{common('openFolder.action')}</TooltipContent>
                        </Tooltip>
                     ) : null}
                     <Tooltip>
                        <TooltipTrigger asChild>
                           <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              disabled={disabled}
                              aria-label={t('delete')}
                              onClick={() => onDelete(map.id)}
                           >
                              <Trash2 />
                           </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('delete')}</TooltipContent>
                     </Tooltip>
                  </ButtonGroup>
                  {metadata.data?.beatSaver ? (
                     <ExternalMapLink label={t('beatSaver.open')} url={metadata.data.beatSaver.url} onOpen={openLink} />
                  ) : null}
                  {metadata.data?.scoreSaberUrl ? (
                     <ExternalMapLink label={t('scoreSaber.open')} url={metadata.data.scoreSaberUrl} onOpen={openLink} />
                  ) : null}
               </div>
            </div>
         </div>

         {folderResult ? <p className="text-muted-foreground text-xs">{common(`openFolder.${folderResult}`)}</p> : null}
         {linkBlocked ? <p className="text-muted-foreground text-xs">{t('linkBlocked')}</p> : null}

         {metadata.data?.beatSaver?.description.trim() ? (
            <>
               <Separator />
               <Suspense fallback={<Skeleton className="h-32 w-full" />}>
                  <MarkdownContent content={metadata.data.beatSaver.description} onLinkClick={openLink} />
               </Suspense>
            </>
         ) : null}
      </div>
   );
}

function ExternalMapLink({ label, url, onOpen }: { label: string; url: string; onOpen: (url: string) => void }) {
   return (
      <CopyPathContextMenu pathType="url" value={url}>
         <Button type="button" variant="link" size="sm" className="text-muted-foreground cursor-pointer" onClick={() => onOpen(url)}>
            {label}
            <ExternalLink className="size-3" />
         </Button>
      </CopyPathContextMenu>
   );
}
