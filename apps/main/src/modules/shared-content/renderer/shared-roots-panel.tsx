import { useState } from 'react';

import { Check, ChevronDown, FolderOpen, FolderPlus, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';

import type { SharedRootOverview } from '@/modules/shared-content/contract';
import type { SharedRoots } from '@/modules/shared-content/renderer/use-shared-roots';

export function SharedRootsPanel({
   roots,
   manager,
   selectedRootPath,
   onSelectRoot,
   canManage,
   isLocal,
   bsmanagerSharedPath
}: {
   roots: SharedRootOverview[];
   manager: SharedRoots;
   selectedRootPath: string | null;
   onSelectRoot: (path: string) => void;
   canManage: boolean;
   isLocal: boolean;
   bsmanagerSharedPath: string | null;
}) {
   const t = useTranslations('sharedContent.roots');
   const busy = manager.state.status === 'saving' || manager.state.status === 'choosing';
   const selectedRoot = roots.find((root) => root.path === selectedRootPath) ?? null;
   const bsmanagerNudgePath = bsmanagerSharedPath && !roots.some((root) => root.path === bsmanagerSharedPath) ? bsmanagerSharedPath : null;

   return (
      <section className="flex flex-col gap-3">
         <h2 className="font-semibold">{t('title')}</h2>

         <ButtonGroup className="w-full" aria-label={t('title')}>
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

                  {bsmanagerNudgePath && canManage ? (
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

                  {canManage ? (
                     <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                           className="justify-center"
                           aria-label={t('add')}
                           disabled={busy}
                           onSelect={() => (isLocal ? void manager.choose() : manager.enter())}
                        >
                           <Plus />
                           <span className="sr-only">{t('add')}</span>
                        </DropdownMenuItem>
                     </>
                  ) : null}
               </DropdownMenuContent>
            </DropdownMenu>

            {selectedRoot && canManage && (isLocal || !selectedRoot.active) ? (
               <LibraryActions root={selectedRoot} manager={manager} isLocal={isLocal} busy={busy} />
            ) : null}
         </ButtonGroup>

         {manager.state.status === 'invalid' ? (
            <WarningLine className="text-sm">
               {t(`issues.${manager.state.issue}`)}
               {manager.state.detail ? ` (${manager.state.detail})` : ''}
            </WarningLine>
         ) : null}

         <AddRootDialog manager={manager} />
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
            {root.active ? <Badge className="px-1.5 py-0 text-[10px] leading-4">{t('active')}</Badge> : null}
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
   const candidate = state.status === 'confirming' ? state.candidate : state.status === 'saving' ? state.candidate : null;
   const open = state.status === 'entering' || candidate !== null;

   return open ? <OpenAddRootDialog manager={manager} /> : null;
}

function OpenAddRootDialog({ manager }: { manager: SharedRoots }) {
   const t = useTranslations('sharedContent.roots');
   const shared = useTranslations('sharedContent');
   const common = useTranslations('common');
   const [path, setPath] = useState('');
   const { state } = manager;
   const candidate = state.status === 'confirming' ? state.candidate : state.status === 'saving' ? state.candidate : null;
   const saving = state.status === 'saving';
   const entering = state.status === 'entering';
   const checking = state.status === 'entering' && state.checking === true;

   return (
      <Dialog
         open
         onOpenChange={(nextOpen) => {
            if (nextOpen || saving || checking) return;

            manager.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('addTitle')}</DialogTitle>
               <DialogDescription>{entering ? t('enterDescription') : t('addDescription')}</DialogDescription>
            </DialogHeader>

            {entering ? (
               <div className="flex flex-col gap-2 text-sm">
                  <InputGroup>
                     <InputGroupInput
                        value={path}
                        placeholder={t('enterPlaceholder')}
                        disabled={checking}
                        onChange={(event) => setPath(event.target.value)}
                        onKeyDown={(event) => {
                           if (event.key === 'Enter' && path.trim() && !checking) void manager.describe(path.trim());
                        }}
                     />
                     <InputGroupAddon align="inline-end">
                        <InputGroupButton size="sm" disabled={checking || !path.trim()} onClick={() => void manager.describe(path.trim())}>
                           <Check data-icon="inline-start" />
                           {t('check')}
                        </InputGroupButton>
                     </InputGroupAddon>
                  </InputGroup>
                  {state.status === 'entering' && state.failed ? <p className="text-destructive text-xs">{t('checkFailed')}</p> : null}
               </div>
            ) : candidate ? (
               <div className="flex flex-col gap-2 text-sm">
                  <div className="break-all">{candidate.path}</div>
                  {candidate.alreadyKnown ? <p className="text-muted-foreground text-xs">{t('alreadyKnown')}</p> : null}
                  {!candidate.exists ? <p className="text-muted-foreground text-xs">{t('willCreate')}</p> : null}
                  {candidate.foldersFound.length > 0 ? (
                     <p className="text-muted-foreground text-xs">
                        {t('foundFolders', { folders: candidate.foldersFound.map((id) => shared(`folders.${id}`)).join(', ') })}
                     </p>
                  ) : null}
               </div>
            ) : null}

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" disabled={saving || checking} onClick={manager.dismiss}>
                  {common('cancel')}
               </Button>
               {candidate ? (
                  <>
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
                  </>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function rootBasename(path: string) {
   const segments = path.split(/[\\/]/).filter(Boolean);

   return segments.at(-1) ?? path;
}
