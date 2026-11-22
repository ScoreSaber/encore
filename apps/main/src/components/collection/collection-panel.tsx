import type { ReactNode } from 'react';

import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type CollectionStatus = 'error' | 'loading' | 'ready' | 'unsupported';
type SnapshotStatus = 'missing' | 'ready' | 'scanning' | 'unsupported';

type CollectionView = 'loading' | 'unsupported' | 'error' | 'missing' | 'empty' | 'no-matches' | 'scanning' | 'ready';

function resolveCollectionView(status: CollectionStatus, snapshotStatus: SnapshotStatus, total: number, visible: number): CollectionView {
   if (status === 'loading' && total === 0) return 'loading';
   if (status === 'unsupported' || snapshotStatus === 'unsupported') return 'unsupported';
   if (status === 'error') return 'error';
   if (snapshotStatus === 'missing') return 'missing';
   if (total === 0) return snapshotStatus === 'scanning' || status === 'loading' ? 'scanning' : 'empty';
   if (visible === 0) return 'no-matches';
   return 'ready';
}

export function CollectionPanel({
   status,
   snapshotStatus,
   total,
   visible,
   query,
   onQueryChange,
   onRescan,
   labels,
   header,
   leading,
   action,
   menu,
   selection,
   notices,
   problems,
   children,
   dialogs
}: {
   status: CollectionStatus;
   snapshotStatus: SnapshotStatus;
   total: number;
   visible: number;
   query: string;
   onQueryChange: (query: string) => void;
   onRescan: () => void;
   header?: ReactNode;
   labels: { unsupported: string; missing: string; empty: string; noMatches: string; loadError: string; note: string | null };
   leading?: ReactNode;
   action?: ReactNode;
   menu?: { label: string; icon: ReactNode; disabled?: boolean; onSelect: () => void } | null;
   selection?: { count: number; exportLabel: string; deleteLabel: string; onExport: (() => void) | null; onDelete: () => void } | null;
   notices?: ReactNode;
   problems: { key: string; message: string }[];
   children: ReactNode;
   dialogs: ReactNode;
}) {
   const common = useTranslations('common');
   const busy = status === 'loading' || snapshotStatus === 'scanning';
   const view = resolveCollectionView(status, snapshotStatus, total, visible);

   if (view === 'loading') {
      return (
         <>
            <LoadingPanel />
            {dialogs}
         </>
      );
   }

   if (view === 'unsupported') {
      return (
         <>
            <EmptyPanel description={labels.unsupported} />
            {dialogs}
         </>
      );
   }

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
         {header}

         <CollectionToolbar
            leading={leading}
            filter={{ value: query, label: common('search'), onChange: onQueryChange }}
            note={labels.note}
            rescan={{ label: common('rescan'), busy, onClick: onRescan }}
            menu={
               menu ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={common('more')}>
                           <MoreHorizontal />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={menu.disabled} onSelect={menu.onSelect}>
                           {menu.icon}
                           {menu.label}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : undefined
            }
            action={action}
         >
            {selection && selection.count > 0 ? (
               <div className="flex gap-2">
                  {selection.onExport ? (
                     <Button type="button" variant="outline" size="sm" disabled={busy} onClick={selection.onExport}>
                        <Download data-icon="inline-start" />
                        {selection.exportLabel}
                     </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={selection.onDelete}>
                     <Trash2 data-icon="inline-start" />
                     {selection.deleteLabel}
                  </Button>
               </div>
            ) : null}
         </CollectionToolbar>

         {notices}

         {problems.map((problem) => (
            <WarningLine key={problem.key}>{problem.message}</WarningLine>
         ))}

         {view === 'error' ? <ErrorPanel message={labels.loadError} onRetry={onRescan} /> : null}
         {view === 'missing' ? <EmptyPanel description={labels.missing} /> : null}
         {view === 'empty' ? <EmptyPanel description={labels.empty} /> : null}
         {view === 'ready' ? children : null}
         {view === 'no-matches' ? <EmptyPanel description={labels.noMatches} /> : null}

         {dialogs}
      </div>
   );
}
