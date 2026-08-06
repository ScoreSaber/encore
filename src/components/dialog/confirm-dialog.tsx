import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ConfirmDialog({
   open,
   title,
   description,
   confirmLabel,
   busy = false,
   children,
   onConfirm,
   onOpenChange
}: {
   open: boolean;
   title: string;
   description: string;
   confirmLabel: string;
   busy?: boolean;
   children?: React.ReactNode;
   onConfirm: () => void;
   onOpenChange: (open: boolean) => void;
}) {
   const common = useTranslations('common');

   return (
      <Dialog
         open={open}
         onOpenChange={(nextOpen) => {
            if (nextOpen || busy) return;

            onOpenChange(false);
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{title}</DialogTitle>
               <DialogDescription>{description}</DialogDescription>
            </DialogHeader>

            {children ? <div className="flex min-w-0 flex-col gap-3 text-sm">{children}</div> : null}

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
                  {common('cancel')}
               </Button>
               <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
                  {confirmLabel}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
