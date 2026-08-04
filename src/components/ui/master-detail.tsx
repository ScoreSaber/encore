import { useRef, type ComponentProps, type KeyboardEvent } from 'react';

import { cn } from '@/components/utils';

function MasterDetail({ className, ...props }: ComponentProps<'div'>) {
   return (
      <div
         data-slot="master-detail"
         className={cn('grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(14rem,2fr)_minmax(18rem,3fr)] grid-rows-[minmax(0,1fr)] gap-4', className)}
         {...props}
      />
   );
}

type MasterDetailListProps = Omit<ComponentProps<'div'>, 'onSelect'> & {
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
      <div
         ref={listRef}
         data-slot="master-detail-list"
         role="listbox"
         tabIndex={0}
         aria-activedescendant={selectedId === null ? undefined : `master-detail-row-${selectedId}`}
         className={cn('min-h-0 min-w-0 overflow-y-auto rounded-md border outline-none', className)}
         onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(event, 1);
            if (event.key === 'ArrowUp') move(event, -1);
         }}
         {...props}
      >
         {children}
      </div>
   );
}

function MasterDetailRow({ id, className, ...props }: ComponentProps<'div'> & { id: string; 'aria-selected': boolean }) {
   return (
      <div
         data-slot="master-detail-row"
         data-item-id={id}
         id={`master-detail-row-${id}`}
         role="option"
         className={cn(
            'flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm',
            'aria-selected:bg-accent aria-selected:text-accent-foreground hover:bg-accent/50 cursor-default',
            className
         )}
         {...props}
      />
   );
}

function MasterDetailPane({ className, ...props }: ComponentProps<'div'>) {
   return (
      <div data-slot="master-detail-pane" className={cn('flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-md border', className)} {...props} />
   );
}

export { MasterDetail, MasterDetailList, MasterDetailPane, MasterDetailRow };
