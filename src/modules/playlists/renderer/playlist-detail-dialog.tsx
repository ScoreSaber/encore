import { useRef } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import type { PlaylistId, PlaylistSongRef } from '@/modules/playlists/contract';
import { playlistDetailQueryOptions } from '@/modules/playlists/renderer/playlist-queries';

export function PlaylistDetailDialog({
   request,
   playlistId,
   onOpenChange,
   onInstallMissing
}: {
   request: TargetPlaylistCollectionRequest;
   playlistId: PlaylistId | null;
   onOpenChange: (open: boolean) => void;
   onInstallMissing: (playlistId: PlaylistId) => void;
}) {
   if (playlistId === null) return null;

   return <OpenPlaylistDetailDialog request={request} playlistId={playlistId} onOpenChange={onOpenChange} onInstallMissing={onInstallMissing} />;
}

function OpenPlaylistDetailDialog({
   request,
   playlistId,
   onOpenChange,
   onInstallMissing
}: {
   request: TargetPlaylistCollectionRequest;
   playlistId: PlaylistId;
   onOpenChange: (open: boolean) => void;
   onInstallMissing: (playlistId: PlaylistId) => void;
}) {
   const t = useTranslations('playlists.detail');
   const common = useTranslations('common');
   const { targetId, installId } = request;
   const detailQuery = useQuery(playlistDetailQueryOptions({ targetId, installId, playlistId }));
   const detail = detailQuery.data?.status === 'ok' ? detailQuery.data.value : undefined;
   const status = detailQuery.isError || detail === null ? 'error' : detailQuery.isPending || detail === undefined ? 'loading' : 'ready';

   return (
      <Dialog open onOpenChange={onOpenChange}>
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <DialogTitle>{detail?.title || t('title')}</DialogTitle>
               <DialogDescription>{detail ? t('by', { author: detail.author || t('unknownAuthor') }) : t('description')}</DialogDescription>
            </DialogHeader>

            <div className="flex max-h-96 min-h-0 flex-col gap-2">
               {status === 'loading' ? <LoadingPanel rows={2} /> : null}
               {status === 'error' ? <ErrorPanel message={t('loadError')} onRetry={() => void detailQuery.refetch()} /> : null}

               {detail ? (
                  <>
                     {detail.description ? <p className="text-muted-foreground text-sm break-words">{detail.description}</p> : null}
                     {detail.problem ? <p className="text-sm break-words">{detail.problem.message}</p> : null}

                     <p className="text-muted-foreground text-sm">{t('summary', { count: detail.songCount, missing: detail.missingCount })}</p>

                     <VirtualSongList songs={detail.songs} />
                  </>
               ) : null}
            </div>

            <DialogFooter>
               {detail && detail.missingCount > 0 ? (
                  <Button type="button" size="sm" className="mr-auto" onClick={() => onInstallMissing(detail.id)}>
                     <Download data-icon="inline-start" />
                     {t('installMissing', { count: detail.missingCount })}
                  </Button>
               ) : null}

               <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                  {common('close')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function VirtualSongList({ songs }: { songs: PlaylistSongRef[] }) {
   const scrollRef = useRef<HTMLDivElement>(null);
   const virtualizer = useVirtualizer({
      count: songs.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => 58,
      getItemKey: (index) => `${songs[index]?.hash ?? songs[index]?.key ?? 'song'}-${index}`,
      overscan: 8
   });

   return (
      <div ref={scrollRef} className="max-h-72 min-h-0 overflow-y-auto">
         <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
               const song = songs[item.index];
               if (!song) return null;

               return (
                  <div
                     key={item.key}
                     ref={virtualizer.measureElement}
                     data-index={item.index}
                     className="absolute top-0 left-0 w-full pb-2"
                     style={{ transform: `translateY(${item.start}px)` }}
                  >
                     <SongRow song={song} />
                  </div>
               );
            })}
         </div>
      </div>
   );
}

function SongRow({ song }: { song: PlaylistSongRef }) {
   const t = useTranslations('playlists.detail');

   return (
      <div className="flex items-center gap-3 rounded-md border p-2">
         <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
               <span className="font-medium">{song.songName || song.key || song.hash || t('unknownSong')}</span>
               {song.installed ? null : <span className="text-status-warning text-xs">{t('missing')}</span>}
               {!song.installed && !song.hash ? <span className="text-muted-foreground text-xs">{t('noHash')}</span> : null}
            </div>
            <div className="text-muted-foreground truncate text-xs">
               {song.levelAuthorName || t('unknownMapper')}
               {song.difficulties.length > 0 ? ` - ${t('difficulties', { count: song.difficulties.length })}` : ''}
            </div>
         </div>
      </div>
   );
}
