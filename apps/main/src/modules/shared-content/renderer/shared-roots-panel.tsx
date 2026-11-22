import { Check, ChevronDown, FolderOpen, FolderPlus, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import type { SharedRootCandidate, SharedRootOverview } from '@/modules/shared-content/contract';
import { useSharedFolderLabel } from '@/modules/shared-content/renderer/shared-folder-label';
import type { SharedRoots } from '@/modules/shared-content/renderer/use-shared-roots';

export function SharedRootsPanel({
   roots,
   manager,
   selectedRootPath,
   onSelectRoot,
   isLocal,
   bsmanagerSharedPath
}: {
   roots: SharedRootOverview[];
   manager: SharedRoots;
   selectedRootPath: string | null;
   onSelectRoot: (path: string) => void;
   isLocal: boolean;
   bsmanagerSharedPath: string | null;
}) {
   const t = useTranslations('sharedContent.roots');
   const busy = manager.state.status === 'saving-root' || manager.state.status === 'saving-action' || manager.state.status === 'choosing';
   const selectedRoot = roots.find((root) => root.path === selectedRootPath) ?? null;
   const bsmanagerNudgePath = bsmanagerSharedPath && !roots.some((root) => root.path === bsmanagerSharedPath) ? bsmanagerSharedPath : null;

   return (
      <section className="flex flex-col gap-3">
         <h2 className="font-semibold">{t('title')}</h2>

         <div className="flex w-full gap-2">
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="h-auto min-w-0 flex-1 justify-between py-2 text-left" disabled={busy}>
                     {selectedRoot ? <LibraryLabel root={selectedRoot} /> : <span className="text-muted-foreground">{t('select')}</span>}
                     <ChevronDown className="text-muted-foreground" />
                  </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)" align="start">
                  {roots.map((root) => (
                     <DropdownMenuItem key={root.path} className="items-start py-2" onSelect={() => onSelectRoot(root.path)}>
                        <LibraryLabel root={root} />
                        {root.path === selectedRootPath ? <Check className="mt-1 ml-auto" /> : null}
                     </DropdownMenuItem>
                  ))}

                  {bsmanagerNudgePath ? (
                     <DropdownMenuItem className="items-start py-2" disabled={busy} onSelect={() => void manager.add(bsmanagerNudgePath, false)}>
                        <div className="min-w-0 flex-1">
                           <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium break-all">{rootBasename(bsmanagerNudgePath)}</span>
                              <Badge variant="secondary">{t('bsmanager')}</Badge>
                           </div>
                           <div className="text-muted-foreground text-xs break-all">{bsmanagerNudgePath}</div>
                        </div>
                     </DropdownMenuItem>
                  ) : null}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="justify-center" aria-label={t('add')} disabled={busy} onSelect={() => void manager.choose()}>
                     <Plus />
                     <span className="sr-only">{t('add')}</span>
                  </DropdownMenuItem>
               </DropdownMenuContent>
            </DropdownMenu>

            {selectedRoot && (isLocal || !selectedRoot.active) ? (
               <LibraryActions root={selectedRoot} manager={manager} isLocal={isLocal} busy={busy} />
            ) : null}
         </div>

         {manager.state.status === 'invalid' ? (
            <WarningLine className="text-sm">
               {t(`issues.${manager.state.issue}`)}
               {manager.state.detail ? ` (${manager.state.detail})` : ''}
            </WarningLine>
         ) : null}

         <AddRootDialog manager={manager} />
         {manager.dialog}
      </section>
   );
}

function LibraryLabel({ root }: { root: SharedRootOverview }) {
   const t = useTranslations('sharedContent.roots');
   const basename = rootBasename(root.path);

   return (
      <div className="min-w-0 flex-1">
         <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium break-all">{basename === 'SharedContent' ? t('sharedContentName') : basename}</span>
            {root.active ? <Badge size="sm">{t('active')}</Badge> : null}
            {!root.exists ? <Badge variant="destructive">{t('missing')}</Badge> : null}
         </div>
         <div className="text-muted-foreground text-xs break-all">{root.path}</div>
      </div>
   );
}

function LibraryActions({ root, manager, isLocal, busy }: { root: SharedRootOverview; manager: SharedRoots; isLocal: boolean; busy: boolean }) {
   const t = useTranslations('sharedContent.roots');
   const common = useTranslations('common');

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-auto w-9 self-stretch" aria-label={common('more')} disabled={busy}>
               <MoreHorizontal />
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end">
            {!root.active ? (
               <DropdownMenuItem onSelect={() => void manager.activate(root.path)}>
                  <Star data-icon="inline-start" />
                  {t('setActive')}
               </DropdownMenuItem>
            ) : null}
            {isLocal ? (
               <DropdownMenuItem onSelect={() => void manager.openRoot(root.path)}>
                  <FolderOpen data-icon="inline-start" />
                  {common('openFolder.action')}
               </DropdownMenuItem>
            ) : null}
            {!root.active ? (
               <DropdownMenuItem variant="destructive" onSelect={() => void manager.forget(root.path)}>
                  <Trash2 data-icon="inline-start" />
                  {t('forget')}
               </DropdownMenuItem>
            ) : null}
         </DropdownMenuContent>
      </DropdownMenu>
   );
}

function AddRootDialog({ manager }: { manager: SharedRoots }) {
   const { state } = manager;
   if (state.status !== 'confirming' && state.status !== 'saving-root') return null;

   return <OpenAddRootDialog manager={manager} candidate={state.candidate} saving={state.status === 'saving-root'} />;
}

function OpenAddRootDialog({ manager, candidate, saving }: { manager: SharedRoots; candidate: SharedRootCandidate; saving: boolean }) {
   const t = useTranslations('sharedContent.roots');
   const common = useTranslations('common');
   const folderLabel = useSharedFolderLabel();

   return (
      <Dialog
         open
         onOpenChange={(nextOpen) => {
            if (nextOpen || saving) return;

            manager.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('addTitle')}</DialogTitle>
               <DialogDescription>{t('addDescription')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 text-sm">
               <div className="break-all">{candidate.path}</div>
               {candidate.alreadyKnown ? <p className="text-muted-foreground text-xs">{t('alreadyKnown')}</p> : null}
               {!candidate.exists ? <p className="text-muted-foreground text-xs">{t('willCreate')}</p> : null}
               {candidate.foldersFound.length > 0 ? (
                  <p className="text-muted-foreground text-xs">
                     {t('foundFolders', {
                        folders: candidate.foldersFound.map((folder) => folderLabel(folder.id, folder.relativePath)).join(', ')
                     })}
                  </p>
               ) : null}
            </div>

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" disabled={saving} onClick={manager.dismiss}>
                  {common('cancel')}
               </Button>
               <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || candidate.alreadyKnown}
                  onClick={() => void manager.add(candidate.path, false)}
               >
                  <FolderPlus data-icon="inline-start" />
                  {t('addAction')}
               </Button>
               <Button type="button" size="sm" disabled={saving} onClick={() => void manager.add(candidate.path, true)}>
                  <Check data-icon="inline-start" />
                  {t('addAndActivate')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function rootBasename(path: string) {
   const segments = path.split(/[\\/]/).filter(Boolean);

   return segments.at(-1) ?? path;
}
