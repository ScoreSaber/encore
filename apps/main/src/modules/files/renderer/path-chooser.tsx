import { useCallback, useEffect, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';
import { CornerLeftUp, File, Folder } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/components/utils';

import type { FileEntry } from '@/modules/files/contract';
import { localTargetId, type TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { targetKey } from '@/renderer/query/api-query';

type PathRequest = { targetId: TargetId; kind: 'folder' | 'file'; title?: string; defaultPath?: string; extensions?: string[] };
type OpenRequest = PathRequest & { resolve: (path: string | null) => void };
type SelectionState = { kind: 'browsing' } | { kind: 'typed'; value: string } | { kind: 'picked'; path: string };

export function usePathChooser() {
   const [request, setRequest] = useState<OpenRequest | null>(null);
   const activeRequestRef = useRef<OpenRequest | null>(null);

   useEffect(
      () => () => {
         activeRequestRef.current?.resolve(null);
         activeRequestRef.current = null;
      },
      []
   );

   const choose = useCallback(async (next: PathRequest) => {
      if (next.targetId === localTargetId && window.encore.runtime === 'desktop') {
         const picked = await Result.tryPromise(() =>
            window.encore.app.choosePath({ kind: next.kind, title: next.title, defaultPath: next.defaultPath, extensions: next.extensions })
         );
         return Result.isOk(picked) && picked.value.status === 'selected' ? picked.value.path : null;
      }

      return new Promise<string | null>((resolve) => {
         activeRequestRef.current?.resolve(null);
         const opened: OpenRequest = { ...next, resolve };
         activeRequestRef.current = opened;
         setRequest(opened);
      });
   }, []);

   const finish = useCallback((path: string | null) => {
      const current = activeRequestRef.current;
      activeRequestRef.current = null;
      current?.resolve(path);
      setRequest(null);
   }, []);

   return { choose, dialog: request ? <FileBrowserDialog request={request} onFinish={finish} /> : null };
}

function FileBrowserDialog({ request, onFinish }: { request: OpenRequest; onFinish: (path: string | null) => void }) {
   const t = useTranslations('files');
   const common = useTranslations('common');
   const { targets } = useTargets();
   const [path, setPath] = useState<string | null>(request.defaultPath ?? null);
   const [selection, setSelection] = useState<SelectionState>({ kind: 'browsing' });
   const listing = useQuery({
      queryKey: [...targetKey('files', request.targetId, 'list'), path],
      queryFn: () => window.encore.files.list({ targetId: request.targetId, path })
   });
   const device = targets.find((target) => target.id === request.targetId)?.name ?? request.targetId;
   const answer = listing.data;
   const folder = answer?.status === 'ok' ? answer.value : null;
   const shownPath = selection.kind === 'typed' ? selection.value : (folder?.path ?? path ?? '');
   const files = request.kind === 'file';
   const extensions = request.extensions?.map((extension) => `.${extension.toLowerCase()}`);
   const entries =
      folder?.status === 'ok'
         ? folder.entries.filter(
              (entry) =>
                 entry.kind === 'directory' || !files || !extensions || extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))
           )
         : [];

   const navigate = (next: string) => {
      setPath(next);
      setSelection({ kind: 'browsing' });
   };

   const unavailable = listing.isError || (answer !== undefined && answer.status !== 'ok');
   const choosable =
      listing.isPending || unavailable
         ? null
         : files
           ? selection.kind === 'picked'
              ? selection.path
              : selection.kind === 'typed'
                ? selection.value.trim() || null
                : null
           : folder?.status === 'unreadable' && selection.kind !== 'typed'
             ? null
             : shownPath.trim() || null;

   return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onFinish(null))}>
         <DialogContent className="sm:max-w-md">
            <DialogHeader>
               <DialogTitle>{request.title ?? t(files ? 'chooseFile' : 'chooseFolder')}</DialogTitle>
               <DialogDescription variant="muted">{t('on', { device })}</DialogDescription>
            </DialogHeader>

            <Input
               value={shownPath}
               aria-label={t('path')}
               spellCheck={false}
               className="font-mono text-xs"
               onChange={(event) => setSelection({ kind: 'typed', value: event.target.value })}
               onKeyDown={(event) => {
                  if (event.key === 'Enter' && selection.kind === 'typed' && selection.value.trim()) navigate(selection.value.trim());
               }}
            />

            <div className="h-80 overflow-y-auto rounded-lg border">
               {listing.isError ? (
                  <p className="text-muted-foreground p-3 text-sm">{t('unavailable', { device })}</p>
               ) : answer && answer.status !== 'ok' ? (
                  <p className="text-muted-foreground p-3 text-sm">
                     {t(answer.status === 'unsupported' ? 'unsupported' : 'unavailable', { device })}
                  </p>
               ) : (
                  <Table>
                     <TableBody>
                        {folder && folder.parent !== null ? (
                           <BrowserRow icon={<CornerLeftUp />} name=".." onClick={() => navigate(folder.parent ?? '')} />
                        ) : null}
                        {entries.map((entry) => (
                           <EntryRow
                              key={entry.path}
                              entry={entry}
                              selectable={files}
                              selected={selection.kind === 'picked' && selection.path === entry.path}
                              onOpen={() => navigate(entry.path)}
                              onPick={() => setSelection({ kind: 'picked', path: entry.path })}
                              onChoose={() => onFinish(entry.path)}
                           />
                        ))}
                     </TableBody>
                  </Table>
               )}
               {folder?.status === 'unreadable' ? <p className="text-muted-foreground p-3 text-sm">{t('unreadable')}</p> : null}
               {folder?.status === 'ok' && entries.length === 0 ? <p className="text-muted-foreground p-3 text-sm">{t('empty')}</p> : null}
               {listing.isPending ? <p className="text-muted-foreground p-3 text-sm">{common('loading')}</p> : null}
            </div>
            {folder?.status === 'ok' && folder.truncated ? (
               <p className="text-muted-foreground text-xs">{t('truncated', { count: folder.entries.length })}</p>
            ) : null}

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" onClick={() => onFinish(null)}>
                  {common('cancel')}
               </Button>
               <Button type="button" size="sm" disabled={!choosable} onClick={() => onFinish(choosable)}>
                  {t(files ? 'selectFile' : 'selectFolder')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function EntryRow({
   entry,
   selectable,
   selected,
   onOpen,
   onPick,
   onChoose
}: {
   entry: FileEntry;
   selectable: boolean;
   selected: boolean;
   onOpen: () => void;
   onPick: () => void;
   onChoose: () => void;
}) {
   if (entry.kind === 'directory') return <BrowserRow icon={<Folder />} name={entry.name} onClick={onOpen} />;

   return (
      <BrowserRow
         icon={<File />}
         name={entry.name}
         muted={!selectable}
         selected={selected}
         onClick={selectable ? onPick : undefined}
         onDoubleClick={selectable ? onChoose : undefined}
      />
   );
}

function BrowserRow({
   icon,
   name,
   muted = false,
   selected = false,
   onClick,
   onDoubleClick
}: {
   icon: React.ReactNode;
   name: string;
   muted?: boolean;
   selected?: boolean;
   onClick?: () => void;
   onDoubleClick?: () => void;
}) {
   return (
      <TableRow
         data-state={selected ? 'selected' : undefined}
         className={cn(onClick ? 'cursor-pointer' : 'hover:bg-transparent', muted && 'text-muted-foreground')}
         onClick={onClick}
         onDoubleClick={onDoubleClick}
      >
         <TableCell className="py-1.5">
            <span className="flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-70">
               {icon}
               <span className="truncate">{name}</span>
            </span>
         </TableCell>
      </TableRow>
   );
}
