import type { ReactElement } from 'react';

import { ClipboardCopy } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { useTranslations } from 'use-intl';

type PathType = 'path' | 'url';
type CopyPathContextMenuProps = {
   children: ReactElement;
   pathType: PathType;
} & ({ value: string; onCopy?: never } | { value?: never; onCopy: () => void | Promise<void> });

export function CopyPathContextMenu({ children, pathType, value, onCopy }: CopyPathContextMenuProps) {
   const t = useTranslations('common');
   const copy = () => (value === undefined ? onCopy() : window.encore.app.copyText({ text: value }));

   return (
      <ContextMenu.Root>
         <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
         <ContextMenu.Portal>
            <ContextMenu.Content className="bg-popover text-popover-foreground z-50 min-w-32 rounded-md border p-1 shadow-md">
               <ContextMenu.Item
                  className="focus:bg-accent focus:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none"
                  onSelect={() => void copy()}
               >
                  <ClipboardCopy className="size-4 shrink-0" />
                  {t(pathType === 'path' ? 'copyPath' : 'copyUrl')}
               </ContextMenu.Item>
            </ContextMenu.Content>
         </ContextMenu.Portal>
      </ContextMenu.Root>
   );
}
