import { EyeOff, FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import type { InstallDetail } from '@/modules/installs/contract';
import type { InstallActions } from '@/modules/installs/renderer/use-install-actions';
import type { InstallEditor } from '@/modules/installs/renderer/use-install-editor';
import { CreateShortcutSubmenu, ShortcutDialog } from '@/modules/shortcuts/renderer/create-shortcut-menu';
import type { InstallShortcuts } from '@/modules/shortcuts/renderer/use-install-shortcuts';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

export function InstallActionsMenu({
   detail,
   targetId,
   supportsManagement,
   editor,
   actions,
   shortcuts,
   onOpenFolder
}: {
   detail: InstallDetail;
   targetId: TargetId;
   supportsManagement: boolean;
   editor: InstallEditor;
   actions: InstallActions;
   shortcuts: InstallShortcuts;
   onOpenFolder: () => void;
}) {
   const t = useTranslations('installs');
   const common = useTranslations('common');
   const busy = actions.state.status !== 'idle' || editor.state.status !== 'closed';
   const local = targetId === localTargetId;
   const canManageFiles = supportsManagement && detail.source !== 'store';

   return (
      <>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button type="button" variant="outline" size="icon-sm" aria-label={common('more')}>
                  <MoreHorizontal />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
               {supportsManagement ? (
                  <ActionItem icon={Pencil} label={t('manage.edit.action')} disabled={busy} onSelect={() => editor.open(detail)} />
               ) : null}
               {local ? <ActionItem icon={FolderOpen} label={common('openFolder.action')} onSelect={onOpenFolder} /> : null}
               <CreateShortcutSubmenu shortcuts={shortcuts} />

               {canManageFiles ? (
                  <>
                     <DropdownMenuSeparator />
                     <ActionItem
                        icon={Trash2}
                        destructive
                        label={t('manage.delete.action')}
                        disabled={busy}
                        onSelect={() => void actions.preview('delete')}
                     />
                     <ActionItem
                        icon={EyeOff}
                        destructive
                        label={t('manage.forget.action')}
                        disabled={busy}
                        onSelect={() => void actions.preview('forget')}
                     />
                  </>
               ) : null}
            </DropdownMenuContent>
         </DropdownMenu>

         <ShortcutDialog shortcuts={shortcuts} />
      </>
   );
}

function ActionItem({
   icon: Icon,
   label,
   destructive,
   disabled,
   onSelect
}: {
   icon: typeof Pencil;
   label: string;
   destructive?: boolean;
   disabled?: boolean;
   onSelect: () => void;
}) {
   return (
      <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} disabled={disabled} onSelect={onSelect}>
         <Icon />
         {label}
      </DropdownMenuItem>
   );
}
