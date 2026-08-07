import { useRef, type ComponentProps, type KeyboardEvent } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/components/utils';

function MasterDetail({ className, ...props }: ComponentProps<'div'>) {
   return (
      <div
         data-slot="master-detail"
         className={cn(
            'grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(18rem,0.92fr)_minmax(20rem,1.08fr)] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-lg border',
            className
         )}
         {...props}
      />
   );
}

type MasterDetailListProps = Omit<ComponentProps<typeof ScrollArea>, 'onSelect'> & {
   itemIds: string[];
   selectedId: string | null;
   onSelect: (id: string) => void;
};

function MasterDetailList({ className, itemIds, selectedId, onSelect, children, ...props }: MasterDetailListProps) {
   const listRef = useRef<HTMLDivElement>(null);

   const move = (event: KeyboardEvent<HTMLDivElement>, step: number) => {
      if (itemIds.length === 0) return;

      event.preventDefault();
      const current = selectedId === null ? -1 : itemIds.indexOf(selectedId);
      const next = itemIds[Math.min(Math.max(current + step, 0), itemIds.length - 1)];
      if (next === undefined) return;

      onSelect(next);
      listRef.current?.querySelector(`[data-item-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
   };

   return (
      <ScrollArea
         ref={listRef}
         data-slot="master-detail-list"
         role="listbox"
         tabIndex={0}
         aria-activedescendant={selectedId === null ? undefined : `master-detail-row-${selectedId}`}
         className={cn(
            'min-h-0 min-w-0 border-r outline-none [&>[data-slot=scroll-area-scrollbar]]:z-20 [&>[data-slot=scroll-area-scrollbar]]:w-2 [&>[data-slot=scroll-area-scrollbar]]:border-l-0 [&>[data-slot=scroll-area-scrollbar]]:bg-transparent [&>[data-slot=scroll-area-scrollbar]]:p-0.5',
            className
         )}
         onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(event, 1);
            if (event.key === 'ArrowUp') move(event, -1);
         }}
         {...props}
      >
         {children}
      </ScrollArea>
   );
}

function MasterDetailRow({ id, className, 'aria-selected': selected, ...props }: ComponentProps<'div'> & { id: string; 'aria-selected': boolean }) {
   return (
      <div
         data-slot="master-detail-row"
         data-item-id={id}
         id={`master-detail-row-${id}`}
         role="option"
         aria-selected={selected}
         className={cn(
            'flex min-h-10 min-w-0 items-center gap-3 border-b px-3 py-2 text-sm',
            'aria-selected:bg-accent aria-selected:text-accent-foreground hover:bg-accent/50 cursor-default',
            className
         )}
         {...props}
      />
   );
}

function MasterDetailPane({ className, ...props }: ComponentProps<'div'>) {
   return (
      <ScrollArea
         data-slot="master-detail-pane"
         className={cn(
            'bg-card min-h-0 min-w-0 [&>[data-slot=scroll-area-viewport]>div]:h-full [&>[data-slot=scroll-area-scrollbar]]:w-2 [&>[data-slot=scroll-area-scrollbar]]:border-l-0 [&>[data-slot=scroll-area-scrollbar]]:bg-transparent [&>[data-slot=scroll-area-scrollbar]]:p-0.5',
            className
         )}
      >
         <div className="flex h-full min-w-0 flex-col" {...props} />
      </ScrollArea>
   );
}

export { MasterDetail, MasterDetailList, MasterDetailPane, MasterDetailRow };
